"use client";

import Link from "next/link";
import type { PatientDashboard } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient", active: true },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient", disabled: true },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/medications" },
];

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 3 — Patient Dashboard (SCREEN_CATALOG §7). */
export default function PatientPage() {
  const state = useApiData<PatientDashboard>("/patients/self/dashboard");

  return (
    <WorkspaceShell workspace="Patient" title="Home" nav={nav}>
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Today
            </p>
            {state.data.upcoming_appointment ? (
              <div className="mt-3">
                <p className="font-sans text-base font-semibold">
                  {fmtWhen(state.data.upcoming_appointment.scheduled_start)}
                </p>
                <p className="mt-1 font-sans text-sm text-graphite">
                  {state.data.upcoming_appointment.reason || "Appointment"}
                </p>
                <div className="mt-2">
                  <StatusBadge status={state.data.upcoming_appointment.status} />
                </div>
              </div>
            ) : (
              <p className="mt-1 font-sans text-sm text-ink">No upcoming appointment.</p>
            )}
            {state.data.pending_followups.length === 0 && (
              <p className="mt-3 font-sans text-sm text-graphite">No follow-ups due.</p>
            )}
          </section>

          <section>
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Quick actions
            </p>
            <div className="mt-2 grid gap-3">
              <button
                type="button"
                disabled
                className="w-full rounded-2xl border border-hairline bg-surface px-4 py-3 text-left font-sans text-sm font-semibold text-graphite"
              >
                New check-in
                <span className="block font-sans text-xs font-normal text-graphite">
                  Arrives with AI assistance
                </span>
              </button>
              <button
                type="button"
                disabled
                className="w-full rounded-2xl border border-hairline bg-surface px-4 py-3 text-left font-sans text-sm font-semibold text-graphite"
              >
                Upload report
                <span className="block font-sans text-xs font-normal text-graphite">
                  Arrives with the health vault
                </span>
              </button>
              <Link
                href="/app/patient/book"
                className="w-full rounded-2xl bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
              >
                Book doctor
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Medications
            </p>
            <Link
              href="/app/patient/medications"
              className="mt-1 inline-block font-sans text-sm font-semibold text-copper"
            >
              View medication history →
            </Link>
          </section>

          {state.data.recent_timeline.length > 0 && (
            <section className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Recent activity
              </p>
              <ul className="mt-3 space-y-3">
                {state.data.recent_timeline.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="font-sans text-sm">{t.label}</span>
                    <span className="font-mono text-xs text-graphite">
                      {new Date(t.at).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
