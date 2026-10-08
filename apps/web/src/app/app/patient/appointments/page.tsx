"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import type { PatientAppointmentView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments", active: true },
  { label: "Care", href: "/app/patient", disabled: true },
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

/** Page 11 — Patient appointments (SCREEN_CATALOG §7). */
export default function PatientAppointmentsPage() {
  const { getToken } = useAuth();
  const state = useApiData<PatientAppointmentView[]>("/patients/self/appointments");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Upcoming");

  async function cancel(id: string) {
    const token = await getToken();
    if (!token) return;
    await fetchApi(token, `/appointments/${id}/cancel`, { method: "POST", body: "{}" });
    await state.refresh();
  }

  return (
    <WorkspaceShell workspace="Patient" title="Appointments" nav={nav}>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 font-sans text-sm font-semibold ${
              tab === t ? "bg-botanical text-surface" : "bg-surface text-graphite"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && (
        <p className="font-sans text-sm text-critical">{state.error}</p>
      )}

      {state.status === "ready" && (
        <section className="space-y-3">
          {state.data.filter((a) => bucket(a) === tab).length === 0 ? (
            <p className="font-sans text-sm text-graphite">No {tab.toLowerCase()} appointments.</p>
          ) : (
            state.data
              .filter((a) => bucket(a) === tab)
              .map((a) => (
                <div key={a.id} className="rounded-2xl border border-hairline bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-sans text-sm font-semibold">
                      {a.doctor_name}
                      {a.speciality ? ` · ${a.speciality}` : ""}
                    </p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-graphite">
                    {fmtAt(a.scheduled_start)} · {a.appointment_type}
                  </p>
                  {a.reason && <p className="mt-1 font-sans text-sm text-graphite">{a.reason}</p>}
                  <div className="mt-2 flex items-center justify-between">
                    <StatusBadge status={a.payment_status} />
                    {a.status === "REQUESTED" && (
                      <button
                        type="button"
                        onClick={() => cancel(a.id)}
                        className="rounded-full border border-hairline px-4 py-1.5 font-sans text-xs font-semibold text-critical"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
          )}

          <Link
            href="/app/patient/book"
            className="block rounded-full bg-copper px-4 py-3 text-center font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
          >
            Book appointment
          </Link>
        </section>
      )}
    </WorkspaceShell>
  );
}
