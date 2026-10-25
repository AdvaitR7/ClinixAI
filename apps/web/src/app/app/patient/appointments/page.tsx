"use client";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useState } from "react";
import type { PatientAppointmentView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments", active: true },
  { label: "Care", href: "/app/patient/medications" },
];

const TABS = ["Upcoming", "Past", "Cancelled"] as const;

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bucket(a: PatientAppointmentView): (typeof TABS)[number] | null {
  if (a.status === "CANCELLED") return "Cancelled";
  const past = new Date(a.scheduled_start).getTime() < Date.now();
  if (a.status === "COMPLETED" || a.status === "NO_SHOW") return "Past";
  if (past && a.status !== "REQUESTED" && a.status !== "CONFIRMED") return "Past";
  return "Upcoming";
}

/** Page 11 — Patient appointments (SCREEN_CATALOG §7, Figma 32:27). */
export default function PatientAppointmentsPage() {
  const { getToken } = useAuth();
  const state = useApiData<PatientAppointmentView[]>("/patients/self/appointments");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Upcoming");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel(id: string) {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetchApi(token, `/appointments/${id}/cancel`, { method: "POST", body: "{}" });
      await state.refresh();
      setCancellingId(null);
    } finally {
      setBusy(false);
    }
  }

  const filtered = state.status === "ready"
    ? state.data.filter((a) => bucket(a) === tab)
    : [];

  return (
    <WorkspaceShell workspace="Patient" title="Appointments" nav={nav}>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-sage/20 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-10 rounded-xl font-sans text-xs font-semibold transition-colors ${
              tab === t ? "bg-surface text-botanical shadow-sm" : "text-graphite hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
        </div>
      )}

      {state.status === "error" && (
        <section className="clinix-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <section className="space-y-4">
          {filtered.length === 0 ? (
            <div className="clinix-card p-6 text-center">
              <p className="font-sans text-sm font-semibold text-ink">No {tab.toLowerCase()} appointments</p>
              <p className="mt-1 font-sans text-xs text-graphite">When you schedule visits with a doctor, they will appear here.</p>
            </div>
          ) : (
            filtered.map((a) => (
              <div key={a.id} className="clinix-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-sans text-base font-bold text-ink">Dr. {a.doctor_name}</h3>
                    <p className="mt-0.5 font-sans text-xs text-graphite">{a.speciality || "General Physician"}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-xl bg-canvas p-2.5 font-mono text-xs text-botanical">
                  <span>📅</span>
                  <span>{fmtAt(a.scheduled_start)} · {a.appointment_type.replace(/_/g, " ")}</span>
                </div>

                {a.reason && (
                  <p className="mt-2.5 font-sans text-xs leading-5 text-graphite">
                    <span className="font-semibold text-ink">Reason: </span>
                    {a.reason}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[11px] text-graphite">Payment:</span>
                    <StatusBadge status={a.payment_status} />
                  </div>
                  {a.status === "REQUESTED" && (
                    <button
                      type="button"
                      onClick={() => setCancellingId(a.id)}
                      className="rounded-full border border-critical/40 bg-critical/10 px-3.5 py-1 font-sans text-xs font-semibold text-critical hover:bg-critical/20"
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          <Link
            href="/app/patient/book"
            className="block min-h-[54px] rounded-[1.25rem] bg-copper px-4 py-4 text-center font-sans text-sm font-bold uppercase tracking-wider text-ink transition-transform active:translate-y-px"
          >
            Book new appointment
          </Link>

          {/* Cancellation confirm modal */}
          {cancellingId && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-dialog-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            >
              <div className="w-full max-w-sm rounded-[1.75rem] border border-sage bg-surface p-6 shadow-2xl">
                <h3 id="cancel-dialog-title" className="font-sans text-lg font-bold text-ink">
                  Cancel appointment request?
                </h3>
                <p className="mt-2 font-sans text-xs leading-5 text-graphite">
                  This appointment request will be marked cancelled and the reserved slot will be freed.
                </p>
                <div className="mt-5 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCancellingId(null)}
                    disabled={busy}
                    className="min-h-11 flex-1 rounded-xl border border-hairline bg-surface font-sans text-xs font-semibold text-graphite"
                  >
                    Keep visit
                  </button>
                  <button
                    type="button"
                    onClick={() => cancel(cancellingId)}
                    disabled={busy}
                    className="min-h-11 flex-1 rounded-xl bg-critical font-sans text-xs font-semibold text-surface disabled:opacity-60"
                  >
                    {busy ? "Cancelling…" : "Yes, cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </WorkspaceShell>
  );
}
