"use client";

import { useState } from "react";
import type { MedicationView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/medications", active: true },
];

const FILTERS = [
  { key: "CURRENT", label: "Active" },
  { key: "PAST", label: "Completed" },
  { key: "UNKNOWN_STATUS", label: "Prescribed" },
] as const;

/** Page 10 — Medication history (SCREEN_CATALOG §7). */
export default function MedicationsPage() {
  const state = useApiData<{ medications: MedicationView[] }>("/patients/self/medications");
  const [filter, setFilter] = useState<string | null>(null);

  return (
    <WorkspaceShell workspace="Patient" title="Medications" nav={nav}>
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
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={`rounded-full border px-3 py-1 font-sans text-xs font-semibold ${
                filter === null ? "border-copper text-copper" : "border-hairline text-graphite"
              }`}
            >
              All
            </button>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 font-sans text-xs font-semibold ${
                  filter === f.key ? "border-copper text-copper" : "border-hairline text-graphite"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {state.data.medications.filter((m) => !filter || m.status === filter).length === 0 ? (
            <p className="font-sans text-sm text-graphite">No medications recorded.</p>
          ) : (
            <ul className="space-y-3">
              {state.data.medications
                .filter((m) => !filter || m.status === filter)
                .map((m, i) => (
                  <li key={i} className="rounded-2xl border border-hairline bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-sans text-sm font-semibold">{m.medicine_name}</p>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 font-sans text-sm text-graphite">
                      {[m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || "No dosing details"}
                    </p>
                    {m.prescribing_doctor && (
                      <p className="mt-1 font-sans text-xs text-graphite">
                        Prescribed by {m.prescribing_doctor}
                        {m.prescribed_date
                          ? ` · ${new Date(m.prescribed_date).toLocaleDateString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </p>
                    )}
                    {m.response && (
                      <p className="mt-1 font-sans text-xs text-graphite">Response: {m.response}</p>
                    )}
                    {m.adverse_reaction && (
                      <p className="mt-1 font-sans text-xs text-critical">
                        Adverse reaction: {m.adverse_reaction}
                      </p>
                    )}
                    {m.reason_stopped && (
                      <p className="mt-1 font-sans text-xs text-graphite">
                        Reason stopped: {m.reason_stopped}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          )}

          <p className="rounded-2xl border border-hairline bg-surface p-4 font-sans text-xs text-graphite">
            Historical use is not authorization to restart treatment — consult your doctor before
            changing or resuming any medicine.
          </p>
        </>
      )}
    </WorkspaceShell>
  );
}
