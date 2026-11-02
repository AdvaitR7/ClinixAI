"use client";

import Link from "next/link";
import { useState } from "react";
import { useApiData, useMe } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { StatusBadge } from "@/components/status-badge";
import { clinicDate, clinicTime, pickPractice, rememberPractice, useApiWrite, type StaffDashboard } from "@/lib/staff";

const card = "rounded-[18px] border border-copper bg-graphite p-4";
const label = "text-[9px] uppercase text-copper";

const ROLE_LABEL = { RECEPTION: "Receptionist", ASSISTANT: "Clinical assistant", OWNER: "Owner", DOCTOR: "Doctor" } as const;

/** Pages 23 / 23a — practice-scoped operations dashboard for receptionists and clinical assistants. */
export default function StaffDashboardPage() {
  const me = useMe();
  const memberships = me.status === "ready" ? (me.me.memberships ?? []).filter((m) => m.role === "RECEPTION" || m.role === "ASSISTANT") : [];
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const activePractice = pickPractice(practiceId, memberships.map((m) => m.practice_id));
  const dashboard = useApiData<StaffDashboard>(activePractice ? `/staff/dashboard?practice_id=${activePractice}` : null);
  const write = useApiWrite();
  const [error, setError] = useState<string | null>(null);

  /** Records arrival or waiting, then refreshes the schedule. */
  async function mark(appointmentId: string, action: "arrive" | "waiting" | "confirm") {
    setError(null);
    try {
      await write(`/staff/appointments/${appointmentId}/${action}?practice_id=${activePractice}`, "POST");
      await dashboard.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the appointment.");
    }
  }

  const data = dashboard.status === "ready" ? dashboard.data : null;
  const role = data && (data.role === "RECEPTION" || data.role === "ASSISTANT") ? data.role : null;
  const staffRole = role ?? (memberships[0]?.role as "RECEPTION" | "ASSISTANT" | undefined) ?? null;

  return (
    <StaffShell role={staffRole} active="home" title="Staff dashboard">
      {me.status === "ready" && memberships.length === 0 && (
        <section className={card} role="status">
          <p className={label}>No membership</p>
          <p className="mt-2 text-sm font-semibold">You have no active practice</p>
          <p className="mt-1 text-xs text-surface/80">Staff access starts only when a practice invites you and you accept. Patient or doctor access on this account is not affected.</p>
        </section>
      )}
      {memberships.length > 0 && (
        <section>
          <p className={label}>Active practice</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            {memberships.length > 1 ? (
              <select aria-label="Active practice" value={activePractice ?? ""} onChange={(e) => { setPracticeId(e.target.value); rememberPractice(e.target.value); }} className="min-h-11 w-full rounded-2xl border border-copper bg-graphite px-3 text-sm">
                {memberships.map((m) => <option key={m.member_id} value={m.practice_id}>{m.practice_name}</option>)}
              </select>
            ) : (
              <p className="text-sm font-semibold">{memberships[0]!.practice_name}</p>
            )}
            {staffRole && <span className="rounded-full border border-copper px-3 py-1 text-[9px] uppercase">{ROLE_LABEL[staffRole]}</span>}
          </div>
        </section>
      )}
      {dashboard.status === "loading" && activePractice && <p role="status" className="text-sm">Loading today…</p>}
      {dashboard.status === "error" && <div role="alert" className={card}><p className="text-sm">{dashboard.error}</p><button type="button" onClick={() => void dashboard.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>}
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
      {data && (
        <>
          <h1 className="text-[30px] leading-tight">Today at {data.practice.name}</h1>
          <p className="text-xs text-surface/80">
            {staffRole === "ASSISTANT" ? "Clinical-assistant operations, patient flow, intake and assigned contact work." : "Reception operations for appointments, arrivals and assigned contact work."}
          </p>
          <div className="grid grid-cols-4 gap-2" aria-label="Today's counts">
            {([["Requested", data.counts.requested], ["Waiting", data.counts.waiting], ["Unpaid", data.counts.unpaid], ["Contact", data.counts.contact]] as const).map(([name, n]) => (
              <div key={name} className="rounded-2xl border border-copper bg-graphite p-2 text-center">
                <p className="text-xl font-semibold">{n}</p>
                <p className="text-[8px] uppercase text-copper">{name}</p>
              </div>
            ))}
          </div>

          <section aria-label="Quick actions" className="grid grid-cols-2 gap-3">
            <Link href={`/app/staff/book?practice_id=${data.practice.id}`} className={`${card} min-h-14 text-sm font-semibold`}>Book appointment</Link>
            <Link href={`/app/staff/claims?practice_id=${data.practice.id}`} className={`${card} min-h-14 text-sm font-semibold`}>Claim invitations</Link>
          </section>

          <section id="schedule" aria-labelledby="flow">
            <p className={label}>Today&apos;s schedule</p>
            <h2 id="flow" className="mt-1 text-[22px]">Patient flow</h2>
            {data.appointments.length === 0 && <p className={`${card} mt-3 text-sm`}>No appointments today.</p>}
            <ul className="mt-3 space-y-3">
              {data.appointments.map((a) => (
                <li key={a.id} className={card}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] text-copper">{clinicTime(a.scheduled_start)}</p>
                      <p className="text-base font-semibold">{a.patient_name || "Patient"}</p>
                      <p className="text-xs text-surface/75">{a.reason ?? "Consultation"}</p>
                    </div>
                    <StatusBadge status={a.intake_status ?? a.status} />
                  </div>
                  <p className="mt-2 text-[10px] text-surface/70">Payment · {a.payment_status.toLowerCase()}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.status === "REQUESTED" && (
                      <button type="button" onClick={() => void mark(a.id, "confirm")} className="min-h-11 rounded-full border border-copper px-4 text-xs">Confirm</button>
                    )}
                    <Link href={`/app/staff/receipt/${a.id}?practice_id=${data.practice.id}`} className="inline-flex min-h-11 items-center rounded-full border border-copper px-4 text-xs">Payment</Link>
                    {!a.intake_status && ["REQUESTED", "CONFIRMED"].includes(a.status) && (
                      <button type="button" onClick={() => void mark(a.id, "arrive")} className="min-h-11 rounded-full border border-copper px-4 text-xs">Mark arrival</button>
                    )}
                    {a.intake_status === "ARRIVED" && (
                      <button type="button" onClick={() => void mark(a.id, "waiting")} className="min-h-11 rounded-full border border-copper px-4 text-xs">Mark waiting</button>
                    )}
                    {a.intake_status && (
                      <Link href={`/app/staff/intake/${a.id}?practice_id=${data.practice.id}`} className="inline-flex min-h-11 items-center rounded-full bg-copper px-4 text-xs font-semibold text-ink">
                        {staffRole === "ASSISTANT" ? "Open intake" : "Arrival details"}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="tasks">
            <p className={label}>Assigned follow-up contacts</p>
            <h2 id="tasks" className="sr-only">Assigned follow-ups</h2>
            {data.assigned_followups.length === 0 && <p className={`${card} mt-3 text-sm`}>No assigned follow-ups.</p>}
            <ul className="mt-3 space-y-2">
              {data.assigned_followups.map((f) => (
                <li key={f.id}>
                  <Link href={`/app/staff/followups/${f.id}?practice_id=${data.practice.id}`} className={`${card} block`}>
                    <p className="text-sm font-semibold">{f.patient_name || "Patient"} · {f.contact_status.toLowerCase()}</p>
                    <p className="text-xs text-surface/75">{f.reason}</p>
                    <p className="text-[10px] text-copper">Due {clinicDate(f.due_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[18px] border border-copper bg-surface p-4 text-ink">
            <p className="text-[9px] uppercase text-copper">Role-based access</p>
            <p className="mt-1 text-sm font-semibold">Operational access only</p>
            <p className="mt-1 text-xs">No diagnoses, unrestricted clinical history, AI analysis, prescription drafts or prescribing controls are shown on the staff dashboard.</p>
          </section>
        </>
      )}
    </StaffShell>
  );
}
