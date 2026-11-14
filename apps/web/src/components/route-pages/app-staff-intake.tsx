"use client";


import { useRouteParam } from "@/lib/route-params";

import { Suspense, useState } from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import { useApiData } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { clinicTime, useApiWrite, type StaffIntake } from "@/lib/staff";

const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";
const input = "min-h-11 w-full rounded-xl border border-clear-divider bg-clear-surface px-3 text-sm";

const FIELDS = [
  ["temperature_c", "Temperature (°C)", "0.1"],
  ["pulse_bpm", "Pulse (bpm)", "1"],
  ["systolic_mmhg", "BP systolic (mmHg)", "1"],
  ["diastolic_mmhg", "BP diastolic (mmHg)", "1"],
  ["spo2_percent", "SpO₂ (%)", "1"],
  ["weight_kg", "Weight (kg)", "0.1"],
] as const;

/** Pages 24 / 24a — assistant intake with vitals, or receptionist arrival-only access. */
export default function IntakePage() {
  return <Suspense fallback={<p role="status" className="p-6 text-sm">Loading…</p>}><IntakeContent /></Suspense>;
}

function IntakeContent() {
  const appointmentId = useRouteParam("appointmentId");
  const practiceId = useSearchParams().get("practice_id");
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const intake = useApiData<StaffIntake>(`/staff/appointments/${appointmentId}/intake${qs}`);
  const write = useApiWrite();
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = intake.status === "ready" ? intake.data : null;
  const locked = data?.clinical_intake_locked ?? true;

  /** Saves entered vitals with CLINIC_STAFF provenance; blank fields are omitted. */
  async function saveVitals() {
    setError(null);
    const body: Record<string, number | string> = {};
    for (const [key] of FIELDS) {
      if (values[key]?.trim()) body[key] = Number(values[key]);
    }
    if (note.trim()) body.intake_note = note.trim();
    setBusy(true);
    try {
      await write(`/staff/appointments/${appointmentId}/vitals${qs}`, "PUT", body);
      setValues({});
      await intake.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vitals were not saved.");
    } finally {
      setBusy(false);
    }
  }

  /** Marks the patient Ready for Doctor after vitals exist. */
  async function ready() {
    setError(null);
    setBusy(true);
    try {
      await write(`/staff/appointments/${appointmentId}/ready${qs}`, "POST");
      await intake.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark ready.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell role={locked ? "RECEPTION" : "ASSISTANT"} active={locked ? "patients" : "intake"} title="Patient intake">
      <Link href="/app/staff" className="min-h-11 text-xs text-clear-info">← Back to dashboard</Link>
      {intake.status === "loading" && <p role="status" className="text-sm">Loading intake…</p>}
      {intake.status === "error" && <div role="alert" className={card}><p className="text-sm">{intake.error}</p><button type="button" onClick={() => void intake.refresh()} className="mt-2 min-h-11 text-xs text-clear-info">Retry</button></div>}
      {data && (
        <>
          <div>
            <p className={label}>{locked ? "Arrival only" : "Clinical assistant · intake"}</p>
            <h1 className="mt-2 text-[28px] leading-tight">{data.patient_name || "Patient"}</h1>
            <p className="text-xs text-clear-secondary">{clinicTime(data.scheduled_start)} · {data.reason ?? "Consultation"}</p>
            <p className="mt-2 inline-flex rounded-full border border-clear-divider px-3 py-1 text-xs uppercase">{data.intake_status ?? "Not arrived"}</p>
          </div>
          {locked ? (
            <section className={card}>
              <p className={label}>Clinical intake locked</p>
              <p className="mt-2 text-sm">Receptionists can record arrival only. Vitals and intake notes are entered by a clinical assistant.</p>
            </section>
          ) : (
            <>
              <section className={card} aria-labelledby="vitals-heading">
                <p className={label}>Vitals · Clinical assistant entered</p>
                <h2 id="vitals-heading" className="mt-1 text-lg">Record vitals</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {FIELDS.map(([key, text, step]) => (
                    <label key={key} className="text-xs text-clear-secondary">
                      {text}
                      <input type="number" inputMode="decimal" step={step} value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} className={`${input} mt-1`} />
                    </label>
                  ))}
                </div>
                <label className="mt-3 block text-xs text-clear-secondary">
                  Intake note
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className={`${input} mt-1 py-2`} />
                </label>
                <button type="button" disabled={busy} onClick={() => void saveVitals()} className="mt-3 min-h-11 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white disabled:opacity-60">Save vitals</button>
              </section>
              {data.vitals.length > 0 && (
                <section aria-labelledby="saved-heading">
                  <h2 id="saved-heading" className={label}>Recorded entries</h2>
                  <ul className="mt-2 space-y-2">
                    {data.vitals.map((v) => (
                      <li key={v.id} className={card}>
                        <p className="text-xs">
                          {[v.temperature_c !== null && `${v.temperature_c} °C`, v.pulse_bpm !== null && `${v.pulse_bpm} bpm`, v.systolic_mmhg !== null && `${v.systolic_mmhg}/${v.diastolic_mmhg ?? "–"} mmHg`, v.spo2_percent !== null && `SpO₂ ${v.spo2_percent}%`, v.weight_kg !== null && `${v.weight_kg} kg`].filter(Boolean).join(" · ")}
                        </p>
                        <p className="mt-1 text-xs text-clear-action">Clinical assistant entered · {clinicTime(v.recorded_at)}</p>
                        {v.needs_doctor_review && <p className="mt-1 text-xs font-semibold text-review">Needs doctor review</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <button type="button" disabled={busy || data.vitals.length === 0 || data.intake_status === "READY_FOR_DOCTOR"} onClick={() => void ready()} className="min-h-12 w-full rounded-2xl border border-clear-divider px-4 text-sm font-semibold disabled:opacity-50">
                {data.intake_status === "READY_FOR_DOCTOR" ? "Ready for doctor" : "Mark ready for doctor"}
              </button>
              <p className="text-xs text-clear-secondary">No diagnosis, assessment, treatment or prescription controls are available here.</p>
            </>
          )}
          {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        </>
      )}
    </StaffShell>
  );
}
