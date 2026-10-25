"use client";

import { useState } from "react";
import type { MedicationView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/medications", active: true },
];

const FILTERS = [
  { key: "CURRENT", label: "Active" },
  { key: "PAST", label: "Completed" },
  { key: "UNKNOWN_STATUS", label: "Prescribed" },
] as const;

/** Page 10 — Medication history (SCREEN_CATALOG §7, Figma 29:2 & 30:2). */
export default function MedicationsPage() {
  const state = useApiData<{ medications: MedicationView[] }>("/patients/self/medications");
  const [filter, setFilter] = useState<string | null>(null);
  const [selectedMed, setSelectedMed] = useState<MedicationView | null>(null);

  const list = state.status === "ready"
    ? state.data.medications.filter((m) => !filter || m.status === filter)
    : [];

  return (
    <WorkspaceShell workspace="Patient" title="Medications" nav={nav}>
      {state.status === "loading" && (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-36 rounded-3xl" />
        </div>
      )}

      {state.status === "error" && (
        <section className="clinix-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section className="clinix-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="clinix-label text-botanical">Registry</p>
                <h2 className="mt-1 font-sans text-xl font-bold text-ink">Prescribed treatments</h2>
              </div>
              <span className="rounded-full border border-sage px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-botanical">
                {state.data.medications.length} total
              </span>
            </div>
            <p className="mt-2 font-sans text-xs leading-5 text-graphite">
              Your active and historical medications as recorded across clinical consultations.
            </p>
          </section>

          <div className="flex flex-wrap gap-2" aria-label="Filter medications by status">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={`min-h-10 rounded-full border px-4 font-sans text-xs font-semibold ${
                filter === null ? "border-botanical bg-botanical text-surface" : "border-sage bg-surface text-graphite"
              }`}
            >
              All
            </button>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`min-h-10 rounded-full border px-4 font-sans text-xs font-semibold ${
                  filter === f.key ? "border-botanical bg-botanical text-surface" : "border-sage bg-surface text-graphite"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="clinix-card p-6 text-center">
              <p className="font-sans text-sm font-semibold text-ink">No medications recorded</p>
              <p className="mt-1 font-sans text-xs text-graphite">Treatments prescribed by your doctors will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {list.map((m, i) => (
                <li key={`${m.medicine_name}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedMed(m)}
                    className="clinix-card w-full p-5 text-left transition-transform active:translate-y-px"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-sans text-base font-bold text-ink">{m.medicine_name}</h3>
                        <p className="mt-1 font-sans text-xs text-graphite">
                          {[m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || "Dosing not specified"}
                        </p>
                      </div>
                      <StatusBadge status={m.status} />
                    </div>
                    {m.prescribing_doctor && (
                      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 font-sans text-xs text-graphite">
                        <span>Dr. {m.prescribing_doctor}</span>
                        {m.prescribed_date && (
                          <span className="font-mono text-[11px]">
                            {new Date(m.prescribed_date).toLocaleDateString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-2xl border border-sage/60 bg-surface/80 p-4 font-sans text-xs leading-5 text-graphite">
            <span className="font-bold text-ink">Clinical caution:</span> Historical use is not authorization to restart treatment. Consult your doctor before changing or resuming any medicine.
          </div>

          {/* Page 10a / Node 30:2 — Medication detail sheet */}
          {selectedMed && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="med-detail-title"
              className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
            >
              <div className="w-full max-w-lg rounded-t-[2rem] border border-sage bg-surface p-6 shadow-2xl sm:rounded-[2rem]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="clinix-label text-botanical">Treatment details</p>
                    <h2 id="med-detail-title" className="mt-1 font-sans text-2xl font-bold text-ink">
                      {selectedMed.medicine_name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMed(null)}
                    aria-label="Close treatment details"
                    className="grid size-9 place-items-center rounded-full border border-sage bg-canvas text-ink"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <StatusBadge status={selectedMed.status} />
                  {selectedMed.prescribing_doctor && (
                    <span className="font-sans text-xs text-graphite">Prescribed by Dr. {selectedMed.prescribing_doctor}</span>
                  )}
                </div>

                <div className="mt-5 space-y-3 rounded-2xl bg-canvas p-4 font-sans text-sm">
                  <div className="flex justify-between border-b border-hairline pb-2">
                    <span className="text-graphite">Dose / Route</span>
                    <span className="font-semibold text-ink">{[selectedMed.dose, selectedMed.route].filter(Boolean).join(" · ") || "Not recorded"}</span>
                  </div>
                  <div className="flex justify-between border-b border-hairline pb-2">
                    <span className="text-graphite">Frequency</span>
                    <span className="font-semibold text-ink">{selectedMed.frequency || "Not recorded"}</span>
                  </div>
                  <div className="flex justify-between border-b border-hairline pb-2">
                    <span className="text-graphite">Patient response</span>
                    <span className="font-semibold text-ink">{selectedMed.response || "Not recorded"}</span>
                  </div>
                  {selectedMed.adverse_reaction && (
                    <div className="flex justify-between border-b border-hairline pb-2 text-critical">
                      <span>Adverse reaction</span>
                      <span className="font-semibold">{selectedMed.adverse_reaction}</span>
                    </div>
                  )}
                  {selectedMed.reason_stopped && (
                    <div className="flex justify-between text-graphite">
                      <span>Reason stopped</span>
                      <span className="font-semibold text-ink">{selectedMed.reason_stopped}</span>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setSelectedMed(null)}
                    className="min-h-12 w-full rounded-2xl bg-botanical px-4 font-sans text-sm font-semibold text-surface"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
