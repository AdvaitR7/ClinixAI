"use client";

import type { DoctorWorkspace } from "@clinix/schemas";
import { useApiData } from "@/lib/api";

/** Normalizes the stored risk-flag JSON into displayable strings without trusting its shape. */
function flagList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === "string" && !!flag.trim()) : [];
}

/**
 * Safety context beside the medicine editor (SCR-033/034 "Safety").
 * Shows only recorded facts: the doctor's current-use medicines, extraction flags and confidence.
 * Allergies and drug-interaction checks have no data source, so it says so instead of implying "none found".
 */
export function PrescriptionSafetyPanel({
  patientId,
  riskFlags,
  overallConfidence,
}: {
  patientId: string;
  riskFlags?: unknown;
  overallConfidence?: number | null;
}) {
  const muted = "text-clear-secondary";
  const action = "text-clear-action";
  const workspace = useApiData<DoctorWorkspace>(`/doctor/patients/${encodeURIComponent(patientId)}/workspace`);
  const current = workspace.status === "ready" ? (workspace.data.medications ?? []).filter((item) => item.status === "CURRENT") : [];
  const flags = flagList(riskFlags);
  return (
    <section aria-labelledby="rx-safety-title" className="clear-card p-4 font-sans text-xs text-clear-ink">
      <h3 id="rx-safety-title" className={`clinix-label ${action}`}>Safety context</h3>
      <dl className="mt-3 space-y-3">
        <div><dt className={muted}>Known allergies</dt><dd className="mt-1">Allergy data unavailable — confirm with the patient.</dd></div>
        <div>
          <dt className={muted}>Current medicines you recorded</dt>
          <dd className="mt-1">
            {workspace.status === "loading" && <span role="status">Checking recorded medicines…</span>}
            {workspace.status === "error" && (
              <span role="alert">{workspace.error} <button type="button" onClick={() => void workspace.refresh()} className={`min-h-11 underline ${action}`}>Retry medicine context</button></span>
            )}
            {workspace.status === "ready" && (current.length ? <ul className="list-disc pl-4">{current.map((item) => <li key={item.entry_id ?? `${item.medicine_name}-${item.prescription_id}`}>{[item.medicine_name, item.dose, item.frequency].filter(Boolean).join(" · ")}</li>)}</ul> : "None recorded by you")}
          </dd>
        </div>
        {typeof overallConfidence === "number" && <div><dt className={muted}>OCR confidence</dt><dd className="mt-1">{Math.round(overallConfidence * 100)}%</dd></div>}
        {flags.length > 0 && <div><dt className={muted}>Extraction flags</dt><dd className="mt-1">{flags.join(" · ")}</dd></div>}
      </dl>
      <p className="mt-3 text-xs leading-4 text-clear-secondary">No interaction or dose-range check is performed. Medicines recorded by other clinicians are not shown.</p>
    </section>
  );
}
