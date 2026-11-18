"use client";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useState } from "react";
import type { DoctorDashboard } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";
import { doctorNav } from "@/lib/workspace-nav";

const nav = doctorNav("desk");

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

  const [actionError, setActionError] = useState<string | null>(null);

  /** Runs a confirm/cancel action and surfaces a failure inline instead of an unhandled rejection. */
  async function act(path: string, id: string) {
    setBusy(id);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, path, { method: "POST", body: "{}" });
      await state.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The action failed.");
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

      {actionError && (
        <p role="alert" className="mb-3 font-sans text-xs text-critical">
          {actionError}
        </p>
      )}

      {state.status === "error" && (
        <section className="clear-card p-5">
          <p className="font-sans text-sm text-clear-ink">Could not load the command desk.</p>
          <p className="mt-1 font-sans text-xs text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <Link href="/app/doctor/requests" className="inline-flex min-h-11 items-center font-sans text-xs font-medium text-clear-secondary">Record removal requests</Link>
          <section aria-labelledby="attention-title">
            <h2 id="attention-title" className="sr-only">Attention summary</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="clear-card min-h-[74px] p-3">
                <p className="font-sans tabular-nums text-xl font-bold text-clear-ink">{state.data.incoming_requests.length}</p>
                <p className="mt-1 font-sans text-xs font-bold uppercase tracking-wide text-clear-action">Waiting</p>
              </div>
              <Link href="/app/doctor/drafts" className="clear-card min-h-[74px] p-3">
                <p className="font-sans tabular-nums text-xl font-bold text-clear-ink">{state.data.draft_queue.pending}</p>
                <p className="mt-1 font-sans text-xs font-bold uppercase tracking-wide text-clear-action">Draft reviews</p>
              </Link>
              <div className="clear-card min-h-[74px] p-3">
                <p className="font-sans tabular-nums text-xl font-bold text-clear-ink">
                  {state.data.followups_due.due_today + state.data.followups_due.overdue}
                </p>
                <p className="mt-1 font-sans text-xs font-bold uppercase tracking-wide text-clear-info">Follow-ups</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="schedule-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="clinix-label text-clear-action">Today&apos;s schedule</p>
                <h2 id="schedule-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">Appointments & attention</h2>
              </div>
              <Link href="/app/doctor/schedule" className="inline-flex min-h-11 items-center font-sans text-xs font-medium text-clear-secondary">Open schedule</Link>
            </div>
            {state.data.today_appointments.length === 0 ? (
              <div className="clear-card p-5">
                <p className="font-sans text-sm font-semibold text-clear-ink">No appointments today</p>
                <p className="mt-1 font-sans text-xs leading-5 text-clear-secondary">Adjust availability or review upcoming dates in Schedule.</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {state.data.today_appointments.map((appointment) => (
                  <li key={appointment.id} className="flex gap-3">
                    <time className="min-w-14 shrink-0 whitespace-nowrap pt-3 font-sans tabular-nums text-xs text-clear-secondary">
                      {fmtTime(appointment.scheduled_start)}
                    </time>
                    <div className="clear-card min-w-0 flex-1 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-sans text-sm font-semibold text-clear-ink">{appointment.patient_name}</p>
                          <p className="mt-1 font-sans text-xs text-clear-secondary">{appointment.reason || "Appointment"}</p>
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
              <p className="clinix-label text-clear-action">Incoming requests</p>
              <h2 id="requests-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">Needs a decision</h2>
              <ul className="mt-4 space-y-3">
                {state.data.incoming_requests.map((appointment) => (
                  <li key={appointment.id} className="clear-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-sans text-sm font-semibold text-clear-ink">{appointment.patient_name}</p>
                        <p className="mt-1 font-sans tabular-nums text-xs text-clear-secondary">
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
                        className="min-h-11 rounded-2xl bg-clear-action px-4 font-sans text-sm font-semibold text-white disabled:opacity-60"
                      >Confirm</button>
                      <button
                        type="button"
                        disabled={busy === appointment.id}
                        onClick={() => act(`/appointments/${appointment.id}/cancel`, appointment.id)}
                        className="min-h-11 rounded-2xl border border-critical bg-critical px-4 font-sans text-sm font-semibold text-white disabled:opacity-60"
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
                <p className="clinix-label text-clear-action">Prescription draft queue</p>
                <h2 id="drafts-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">
                  {state.data.draft_queue.pending} {state.data.draft_queue.pending === 1 ? "draft requires" : "drafts require"} review
                </h2>
              </div>
              <StatusBadge status={state.data.draft_queue.high_risk ? "NEEDS_REVIEW" : "DRAFT"} />
            </div>
            <Link href="/app/doctor/drafts" className="clear-card mt-4 flex min-h-14 items-center justify-between p-4 font-sans text-sm font-semibold text-clear-ink">
              Open prescription drafts <span aria-hidden="true" className="text-clear-action">→</span>
            </Link>
          </section>

          <section aria-labelledby="followups-title">
            <p className="clinix-label text-clear-action">Follow-ups due</p>
            <h2 id="followups-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">Needs your attention</h2>
            <div className="clear-card mt-4 p-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-sm font-semibold text-clear-ink">Due today</span>
                <span className="font-sans tabular-nums text-lg text-clear-info">{state.data.followups_due.due_today}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-clear-divider pt-3">
                <span className="font-sans text-sm font-semibold text-clear-ink">Overdue</span>
                <span className="font-sans tabular-nums text-lg text-clear-ink">{state.data.followups_due.overdue}</span>
              </div>
              <Link href="/app/doctor/followups" className="mt-3 flex min-h-11 items-center justify-between border-t border-clear-divider pt-3 font-sans text-sm font-semibold text-clear-ink">
                Open follow-up worklist <span aria-hidden="true" className="text-clear-action">→</span>
              </Link>
            </div>
          </section>

          <section aria-labelledby="practice-title">
            <p className="clinix-label text-clear-action">Practice</p>
            <h2 id="practice-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">Team and profile</h2>
            <Link href="/app/doctor/team" className="clear-card mt-4 flex min-h-14 items-center justify-between p-4 font-sans text-sm font-semibold text-clear-ink">
              Practice team <span aria-hidden="true" className="text-clear-action">→</span>
            </Link>
            <Link href="/app/doctor/profile" className="clear-card mt-3 flex min-h-14 items-center justify-between p-4 font-sans text-sm font-semibold text-clear-ink">
              Profile and services <span aria-hidden="true" className="text-clear-action">→</span>
            </Link>
          </section>

          <section aria-labelledby="patient-search-title">
            <p className="clinix-label text-clear-action">Patient search</p>
            <h2 id="patient-search-title" className="mt-1 font-sans text-xl font-semibold text-clear-ink">Find or begin a record</h2>
            <Link href="/app/doctor/patients" className="clear-card mt-4 block min-h-14 px-4 py-[18px] font-sans text-sm text-clear-secondary">
              Search name, phone, patient ID
            </Link>
            <Link href="/app/doctor/patients/new" className="clear-card mt-3 flex min-h-16 items-center justify-between p-4 font-sans text-sm font-semibold text-clear-ink">
              Create unclaimed patient record <span aria-hidden="true" className="text-clear-action">→</span>
            </Link>
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
