"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApiData, useMe } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { StatusBadge } from "@/components/status-badge";
import { clinicDate, clinicTime, useApiWrite, type StaffAppointment } from "@/lib/staff";
import { recordHref } from "@/lib/route-params";

const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";

type Tab = "schedule" | "patients" | "intake";
type ScheduleResponse = { date: string; role: string; appointments: StaffAppointment[] };
type OperationalPatient = { patient_id: string; full_name: string; claim_status: string; phone_hint: string; next_appointment_at: string | null };

/** Page 23g — restricted, practice-scoped schedule, patient list and intake queue (FigCraft frame 5953). */
export default function StaffSchedulePage() {
  return <Suspense fallback={null}><ScheduleContent /></Suspense>;
}

function ScheduleContent() {
  const requested = useSearchParams().get("tab");
  const me = useMe();
  const member = me.status === "ready" ? (me.me.memberships ?? []).find((m) => m.role === "RECEPTION" || m.role === "ASSISTANT") : undefined;
  const role = (member?.role as "RECEPTION" | "ASSISTANT" | undefined) ?? null;
  // Receptionists have no intake tab; fall back to the schedule.
  const tab: Tab = requested === "patients" ? "patients" : requested === "intake" && role === "ASSISTANT" ? "intake" : "schedule";
  const practiceId = member?.practice_id ?? null;

  return (
    <StaffShell role={role} active={tab === "schedule" ? "schedule" : tab === "patients" ? "patients" : "intake"} title="Schedule & patients">
      <div>
        <p className={label}>Clinic operations · practice scoped</p>
        <h1 className="mt-2 text-[28px] leading-tight">Schedule &amp; patients</h1>
      </div>
      <nav aria-label="Operational views" className="flex justify-between rounded-[22px] border border-clear-divider bg-clear-surface p-2 text-xs">
        {([["schedule", "Schedule", "/app/staff/schedule"], ["patients", "Patients", "/app/staff/schedule?tab=patients"], ...(role === "ASSISTANT" ? [["intake", "Intake", "/app/staff/schedule?tab=intake"]] : [])] as const).map(([key, text, href]) => (
          <Link key={key} href={href} aria-current={tab === key ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center rounded-full ${tab === key ? "font-semibold text-clear-action" : ""}`}>{text}</Link>
        ))}
      </nav>
      {practiceId ? (
        tab === "patients" ? <PatientsTab practiceId={practiceId} /> : <ScheduleTab practiceId={practiceId} intakeOnly={tab === "intake"} role={role} />
      ) : me.status === "ready" ? (
        <p className={`${card} text-sm`} role="status">You have no active practice.</p>
      ) : (
        <p role="status" className="text-sm">Loading…</p>
      )}
      <section className="rounded-[18px] border border-clear-divider bg-surface p-4 text-clear-ink">
        <p className="text-xs">Operational only. No clinical history, diagnoses, records or prescriptions are shown. Patient names are logged to the access ledger.</p>
      </section>
    </StaffShell>
  );
}

/** Today's appointments, or only those in the intake queue for assistants. */
function ScheduleTab({ practiceId, intakeOnly, role }: { practiceId: string; intakeOnly: boolean; role: "RECEPTION" | "ASSISTANT" | null }) {
  const schedule = useApiData<ScheduleResponse>(`/staff/schedule?practice_id=${practiceId}`);
  const write = useApiWrite();
  const [error, setError] = useState<string | null>(null);

  /** Marks arrival or waiting and reloads. */
  async function mark(id: string, action: "arrive" | "waiting") {
    setError(null);
    try {
      await write(`/staff/appointments/${id}/${action}?practice_id=${practiceId}`, "POST");
      await schedule.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the appointment.");
    }
  }

  const all = schedule.status === "ready" ? schedule.data.appointments : [];
  const rows = intakeOnly ? all.filter((a) => a.intake_status !== null) : all;
  return (
    <section aria-labelledby="sched">
      <h2 id="sched" className="text-xs font-semibold uppercase text-clear-action">{intakeOnly ? "Intake queue · today" : "Schedule · today"}</h2>
      {schedule.status === "loading" && <p role="status" className="mt-3 text-sm">Loading schedule…</p>}
      {schedule.status === "error" && <div role="alert" className={`${card} mt-3`}><p className="text-sm">{schedule.error}</p><button type="button" onClick={() => void schedule.refresh()} className="mt-2 min-h-11 text-xs text-clear-info">Retry</button></div>}
      {schedule.status === "ready" && rows.length === 0 && <p className={`${card} mt-3 text-sm`}>{intakeOnly ? "No patients have arrived for intake." : "No appointments today."}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-critical">{error}</p>}
      <ul className="mt-3 space-y-3">
        {rows.map((a) => (
          <li key={a.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{clinicTime(a.scheduled_start)} · {a.patient_name || "Patient"}</p>
              <StatusBadge status={a.intake_status ?? a.status} />
            </div>
            <p className="mt-1 text-xs text-clear-secondary">{a.reason ?? "Consultation"} · Payment {a.payment_status.toLowerCase()}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {!a.intake_status && ["REQUESTED", "CONFIRMED"].includes(a.status) && <button type="button" onClick={() => void mark(a.id, "arrive")} className="min-h-11 rounded-full border border-clear-divider px-4">Mark arrival</button>}
              {a.intake_status === "ARRIVED" && <button type="button" onClick={() => void mark(a.id, "waiting")} className="min-h-11 rounded-full border border-clear-divider px-4">Mark waiting</button>}
              {a.intake_status && <Link href={recordHref("/app/staff/intake", "appointmentId", a.id, { practice_id: practiceId })} className="inline-flex min-h-11 items-center rounded-full bg-clear-action px-4 font-semibold text-white">{role === "ASSISTANT" ? "Open intake" : "Arrival details"}</Link>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Operational patient list with name search; no clinical data. */
function PatientsTab({ practiceId }: { practiceId: string }) {
  const [q, setQ] = useState("");
  const patients = useApiData<OperationalPatient[]>(`/staff/patients?practice_id=${practiceId}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
  return (
    <section aria-labelledby="pts">
      <h2 id="pts" className="text-xs font-semibold uppercase text-clear-action">Patients · operational view</h2>
      <Link href={`/app/staff/patients/new?practice_id=${practiceId}`} className="mt-3 flex min-h-11 items-center justify-center rounded-2xl border border-clear-divider px-4 text-sm font-semibold text-clear-action">Add patient</Link>
      <input aria-label="Search by name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="mt-3 min-h-11 w-full rounded-2xl border border-clear-info bg-clear-surface px-4 text-sm" />
      {patients.status === "loading" && <p role="status" className="mt-3 text-sm">Loading patients…</p>}
      {patients.status === "error" && <div role="alert" className={`${card} mt-3`}><p className="text-sm">{patients.error}</p></div>}
      {patients.status === "ready" && patients.data.length === 0 && <p className={`${card} mt-3 text-sm`}>No patients found.</p>}
      <ul className="mt-3 space-y-3">
        {patients.status === "ready" && patients.data.map((p) => (
          <li key={p.patient_id} className={card}>
            <p className="text-sm font-semibold">{p.full_name} · {p.claim_status} · {p.phone_hint}</p>
            <p className="mt-1 text-xs text-clear-secondary">{p.next_appointment_at ? `Next visit ${clinicDate(p.next_appointment_at)} ${clinicTime(p.next_appointment_at)}` : "No upcoming visit"} · Contact and arrival only</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
