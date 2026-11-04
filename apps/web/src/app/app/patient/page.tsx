"use client";

import Link from "next/link";
import type { PatientDashboard } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";
import { patientDashboardDemo } from "@/lib/ui-demo-data";

const nav = [
  { label: "Home", href: "/app/patient", active: true },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/care" },
  { label: "You", href: "/settings" },
];

const day = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Formats an appointment's time in the clinic's India timezone. */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
}

function horizonDates() {
  const today = new Date();
  return Array.from({ length: 5 }, (_, index) => {
    const value = new Date(today);
    value.setDate(today.getDate() + index);
    return {
      weekday: value.toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase(),
      date: value.getDate(),
    };
  });
}

/** Page 3 — Patient Dashboard (SCREEN_CATALOG §7). */
export default function PatientPage() {
  const state = useApiData<PatientDashboard>("/patients/self/dashboard");
  const dates = horizonDates();

  return (
    <WorkspaceShell workspace="Patient" title="Your care, at a glance" nav={nav}>
      {state.status === "loading" && (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
      )}

      {state.status === "error" && (
        <section className="clinix-card p-5">
          <p className="font-sans text-sm font-medium text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section aria-labelledby="horizon-title">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="horizon-title" className="clinix-label text-graphite">Care horizon</h2>
              <span className="font-sans text-xs text-graphite">Next 5 days</span>
            </div>
            <div className="clinix-card grid grid-cols-5 gap-2 p-2">
              {dates.map((date, index) => (
                <div
                  key={`${date.weekday}-${date.date}`}
                  className={`grid h-[65px] place-items-center rounded-[1.125rem] py-2 text-center ${
                    index === 0 ? "bg-botanical text-surface" : "border border-sage bg-surface text-ink"
                  }`}
                >
                  <span className="font-sans text-[9px] font-semibold">{date.weekday}</span>
                  <span className="font-mono text-xl font-bold">{date.date}</span>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="today-title">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="today-title" className="clinix-label text-botanical">Next appointment</h2>
              <span className="font-sans text-[10px] font-semibold uppercase text-graphite">
                {state.data.upcoming_appointment ? "1 item" : "No items"}
              </span>
            </div>
            <div className="clinix-card p-[18px]">
              <h3 className="font-sans text-[1.4rem] font-bold leading-tight tracking-[-0.03em] text-ink">
                {day.format(state.data.upcoming_appointment ? new Date(state.data.upcoming_appointment.scheduled_start) : new Date())}
              </h3>
              {state.data.upcoming_appointment ? (
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-canvas p-3.5">
                  <div className="w-16 shrink-0">
                    <p className="font-mono text-lg font-bold text-botanical">
                      {fmtTime(state.data.upcoming_appointment.scheduled_start)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-sans text-sm font-semibold text-ink">
                      {state.data.upcoming_appointment.reason || "Appointment"}
                    </p>
                    <div className="mt-2"><StatusBadge status={state.data.upcoming_appointment.status} /></div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl bg-canvas p-4">
                  <p className="font-sans text-sm font-semibold text-ink">No upcoming appointment</p>
                  <p className="mt-1 font-sans text-xs leading-5 text-graphite">Book a visit when you need care.</p>
                </div>
              )}
              {state.data.pending_followups.length === 0 && (
                <p className="mt-4 font-sans text-xs text-graphite">No follow-ups are due.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="care-plan-title">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="care-plan-title" className="clinix-label text-graphite">Care plan</h2>
              <span className="rounded-full border border-hairline px-2 py-1 font-sans text-[9px] font-bold uppercase text-graphite">{patientDashboardDemo.label}</span>
            </div>
            <div className="rounded-3xl bg-botanical p-[18px] text-surface shadow-[0_10px_20px_rgba(18,53,44,0.1)]">
              <p className="font-sans text-sm font-semibold">Care plan tools are not connected yet</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-copper" style={{ width: `${patientDashboardDemo.data.carePlanProgress}%` }} />
              </div>
              <p className="mt-2 font-sans text-xs text-surface/75">This preview is read-only and contains no clinical facts.</p>
            </div>
          </section>

          <section aria-labelledby="quick-links-title">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="quick-links-title" className="clinix-label text-graphite">Quick links</h2>
              <span className="font-sans text-xs text-graphite">Your record & care</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/app/patient/vault" className="clinix-card min-h-24 p-4">
                <span className="font-sans text-base font-semibold text-ink">Reports</span>
                <span className="mt-1 block font-sans text-xs text-graphite">Health Vault & uploads</span>
              </Link>
              <Link href="/app/patient/appointments" className="clinix-card min-h-24 p-4">
                <span className="font-sans text-base font-semibold text-ink">Visits</span>
                <span className="mt-1 block font-sans text-xs text-graphite">Appointments and status</span>
              </Link>
              <Link href="/app/patient/checkin" className="clinix-card min-h-24 p-4 text-left transition-transform active:translate-y-px">
                <span className="font-sans text-base font-semibold text-ink">Check-in</span>
                <span className="mt-1 block font-sans text-xs text-graphite">AI-assisted assessment</span>
              </Link>
              <Link href="/app/patient/medications" className="clinix-card min-h-24 p-4">
                <span className="font-sans text-base font-semibold text-ink">Medications</span>
                <span className="mt-1 block font-sans text-xs text-graphite">Current and past records</span>
              </Link>
            </div>
            <Link href="/app/patient/book" className="mt-3 block min-h-[58px] rounded-[1.25rem] bg-copper px-4 py-[18px] text-center font-sans text-sm font-bold uppercase text-ink">
              Book a doctor
            </Link>
          </section>

          {state.data.recent_timeline.length > 0 && (
            <section className="clinix-card p-5" aria-labelledby="activity-title">
              <h2 id="activity-title" className="clinix-label text-graphite">Recent activity</h2>
              <ul className="mt-3 divide-y divide-hairline">
                {state.data.recent_timeline.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                    <span className="font-sans text-sm text-ink">{item.label}</span>
                    <span className="font-mono text-xs text-graphite">
                      {new Date(item.at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
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
