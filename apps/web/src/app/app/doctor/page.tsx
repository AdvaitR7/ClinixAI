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
  { label: "Home", href: "/app/doctor", active: true },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor", disabled: true },
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
    <WorkspaceShell workspace="Doctor" title="Home" nav={nav}>
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
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
              Today&apos;s schedule
            </p>
            {state.data.today_appointments.length === 0 ? (
              <p className="mt-1 font-sans text-sm text-ink">No appointments today.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {state.data.today_appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-sans text-sm font-semibold">{a.patient_name}</p>
                      <p className="font-mono text-xs text-graphite">{fmtTime(a.scheduled_start)}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {state.data.incoming_requests.length > 0 && (
            <section className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Incoming requests
              </p>
              <ul className="mt-3 space-y-3">
                {state.data.incoming_requests.map((a) => (
                  <li key={a.id} className="rounded-xl border border-hairline p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-sans text-sm font-semibold">{a.patient_name}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-graphite">
                      {fmtTime(a.scheduled_start)}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy === a.id}
                        onClick={() => act(`/doctor/appointments/${a.id}/confirm`, a.id)}
                        className="rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busy === a.id}
                        onClick={() => act(`/appointments/${a.id}/cancel`, a.id)}
                        className="rounded-full border border-hairline px-4 py-2 font-sans text-sm font-semibold text-critical disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-hairline bg-surface p-4">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Prescription drafts
              </p>
              <p className="mt-1 font-mono text-2xl text-ink">0</p>
            </div>
            <div className="rounded-2xl border border-hairline bg-surface p-4">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Follow-ups due
              </p>
              <p className="mt-1 font-mono text-2xl text-ink">0</p>
            </div>
          </section>

          <section className="space-y-3">
            <Link
              href="/app/doctor/patients/new"
              className="block rounded-full bg-copper px-4 py-3 text-center font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
            >
              Add patient
            </Link>
            <button
              type="button"
              disabled
              className="w-full rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite"
            >
              Start consultation
            </button>
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
