"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import type { DoctorDashboard } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor", active: true },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 4 — Doctor Dashboard (SCREEN_CATALOG §7). */
export default function DoctorPage() {
  const { getToken } = useAuth();
  const state = useApiData<DoctorDashboard>("/doctor/dashboard");
  const [busy, setBusy] = useState<string | null>(null);

  async function act(path: string, id: string) {
    setBusy(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, path, { method: "POST", body: "{}" });
      await state.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Clinical command desk" nav={nav}>
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && (
        <section className="clinix-doctor-card p-5">
          <p className="font-sans text-sm text-surface">Could not load the command desk.</p>
          <p className="mt-1 font-sans text-xs text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section aria-labelledby="attention-title">
            <h2 id="attention-title" className="sr-only">Attention summary</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="clinix-doctor-card min-h-[74px] p-3">
                <p className="font-mono text-xl font-bold text-surface">{state.data.incoming_requests.length}</p>
                <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wide text-copper">Waiting</p>
              </div>
              <Link href="/app/doctor/drafts" className="clinix-doctor-card min-h-[74px] p-3">
                <p className="font-mono text-xl font-bold text-surface">{state.data.draft_queue.pending}</p>
                <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wide text-copper">Draft reviews</p>
              </Link>
              <div className="clinix-doctor-card min-h-[74px] p-3">
                <p className="font-mono text-xl font-bold text-surface">
                  {state.data.followups_due.due_today + state.data.followups_due.overdue}
                </p>
                <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wide text-evidence">Follow-ups</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="schedule-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="clinix-label text-copper">Today&apos;s schedule</p>
                <h2 id="schedule-title" className="mt-1 font-sans text-xl font-semibold text-surface">Appointments & attention</h2>
              </div>
              <Link href="/app/doctor/schedule" className="font-sans text-xs font-medium text-doctor-muted/70">Open schedule</Link>
            </div>
            {state.data.today_appointments.length === 0 ? (
              <div className="clinix-doctor-card p-5">
                <p className="font-sans text-sm font-semibold text-surface">No appointments today</p>
                <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/65">Adjust availability or review upcoming dates in Schedule.</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {state.data.today_appointments.map((appointment) => (
                  <li key={appointment.id} className="flex gap-3">
                    <time className="w-12 shrink-0 pt-3 font-mono text-[11px] text-doctor-muted/75">
                      {fmtTime(appointment.scheduled_start)}
                    </time>
                    <div className="clinix-doctor-card min-w-0 flex-1 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-sans text-sm font-semibold text-surface">{appointment.patient_name}</p>
                          <p className="mt-1 font-sans text-xs text-doctor-muted/70">{appointment.reason || "Appointment"}</p>
                        </div>
                        <StatusBadge status={appointment.status} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {state.data.incoming_requests.length > 0 && (
            <section aria-labelledby="requests-title">
              <p className="clinix-label text-copper">Incoming requests</p>
              <h2 id="requests-title" className="mt-1 font-sans text-xl font-semibold text-surface">Needs a decision</h2>
              <ul className="mt-4 space-y-3">
                {state.data.incoming_requests.map((appointment) => (
                  <li key={appointment.id} className="clinix-doctor-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-sans text-sm font-semibold text-surface">{appointment.patient_name}</p>
                        <p className="mt-1 font-mono text-xs text-doctor-muted/65">
                          {fmtTime(appointment.scheduled_start)}{appointment.reason ? ` · ${appointment.reason}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={appointment.status} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={busy === appointment.id}
                        onClick={() => act(`/doctor/appointments/${appointment.id}/confirm`, appointment.id)}
                        className="min-h-11 rounded-2xl bg-copper px-4 font-sans text-sm font-semibold text-ink disabled:opacity-60"
                      >Confirm</button>
                      <button
                        type="button"
                        disabled={busy === appointment.id}
                        onClick={() => act(`/appointments/${appointment.id}/cancel`, appointment.id)}
                        className="min-h-11 rounded-2xl border border-critical bg-critical px-4 font-sans text-sm font-semibold text-surface disabled:opacity-60"
                      >Decline</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="drafts-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="clinix-label text-copper">Prescription draft queue</p>
                <h2 id="drafts-title" className="mt-1 font-sans text-xl font-semibold text-surface">
                  {state.data.draft_queue.pending} {state.data.draft_queue.pending === 1 ? "draft requires" : "drafts require"} review
                </h2>
              </div>
              <StatusBadge status={state.data.draft_queue.high_risk ? "NEEDS_REVIEW" : "DRAFT"} />
            </div>
            <Link href="/app/doctor/drafts" className="clinix-doctor-card mt-4 flex min-h-14 items-center justify-between p-4 font-sans text-sm font-semibold text-surface">
              Open prescription drafts <span aria-hidden="true" className="text-copper">→</span>
            </Link>
          </section>

          <section aria-labelledby="followups-title">
            <p className="clinix-label text-copper">Follow-ups due</p>
            <h2 id="followups-title" className="mt-1 font-sans text-xl font-semibold text-surface">Needs your attention</h2>
            <div className="clinix-doctor-card mt-4 p-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-sm font-semibold text-surface">Due today</span>
                <span className="font-mono text-lg text-evidence">{state.data.followups_due.due_today}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="font-sans text-sm font-semibold text-surface">Overdue</span>
                <span className="font-mono text-lg text-surface">{state.data.followups_due.overdue}</span>
              </div>
              <p className="mt-3 rounded-xl border border-white/10 p-3 font-sans text-xs leading-5 text-doctor-muted/65">
                Follow-up records are not available yet; these are API summary counts only.
              </p>
            </div>
          </section>

          <section aria-labelledby="patient-search-title">
            <p className="clinix-label text-copper">Patient search</p>
            <h2 id="patient-search-title" className="mt-1 font-sans text-xl font-semibold text-surface">Find or begin a record</h2>
            <Link href="/app/doctor/patients" className="clinix-doctor-card mt-4 block min-h-14 px-4 py-[18px] font-sans text-sm text-doctor-muted/70">
              Search name, phone, patient ID
            </Link>
            <Link href="/app/doctor/patients/new" className="clinix-doctor-card mt-3 flex min-h-16 items-center justify-between p-4 font-sans text-sm font-semibold text-surface">
              Create unclaimed patient record <span aria-hidden="true" className="text-copper">→</span>
            </Link>
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
