"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiData } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { clinicTime, useApiWrite } from "@/lib/staff";

const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";
const field = "min-h-11 w-full rounded-xl border border-clear-divider bg-clear-surface px-3 text-sm";

type Doctor = { doctor_id: string; name: string; speciality: string | null };
type Patient = { patient_id: string; full_name: string };

/** Page 23d — staff books an appointment for one of the practice's patients (FigCraft frame 5918). */
export default function StaffBookPage() {
  return <Suspense fallback={null}><BookContent /></Suspense>;
}

function BookContent() {
  const practiceId = useSearchParams().get("practice_id");
  const router = useRouter();
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const doctors = useApiData<Doctor[]>(`/staff/doctors${qs}`);
  const patients = useApiData<Patient[]>(`/staff/patients${qs}`);
  const write = useApiWrite();
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [type, setType] = useState<"IN_PERSON" | "ONLINE">("IN_PERSON");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slots = useApiData<{ slots: { start: string }[] }>(doctorId ? `/doctors/${doctorId}/availability?from=${date}&to=${date}&type=${type === "ONLINE" ? "ONLINE" : "IN_PERSON"}` : null);

  /** Requests the appointment; a taken slot is reported, never double-booked. */
  async function book() {
    setBusy(true);
    setError(null);
    try {
      await write(`/staff/appointments${qs}`, "POST", { patient_id: patientId, doctor_id: doctorId, appointment_type: type, scheduled_start: slot, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      router.replace("/app/staff");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not book the appointment.");
      setBusy(false);
    }
  }

  const freeSlots = slots.status === "ready" ? slots.data.slots : [];
  return (
    <StaffShell role={null} active="schedule" title="Book appointment">
      <Link href="/app/staff" className="min-h-11 text-xs text-clear-info">← Back to dashboard</Link>
      <div>
        <p className={label}>Clinic operations · book appointment</p>
        <h1 className="mt-2 text-[28px] leading-tight">Book for a patient</h1>
      </div>
      <section className={card}>
        <label className="text-xs">Patient
          <select aria-label="Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} className={`${field} mt-1`}>
            <option value="">Select a patient</option>
            {patients.status === "ready" && patients.data.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-clear-secondary">Chosen from this practice&apos;s patients only. Booking grants no record access.</p>
      </section>
      <section className={card}>
        <label className="text-xs">Doctor
          <select aria-label="Doctor" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setSlot(""); }} className={`${field} mt-1`}>
            <option value="">Select a doctor</option>
            {doctors.status === "ready" && doctors.data.map((d) => <option key={d.doctor_id} value={d.doctor_id}>{d.name}{d.speciality ? ` · ${d.speciality}` : ""}</option>)}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs">Type
            <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setSlot(""); }} className={`${field} mt-1`}>
              <option value="IN_PERSON">In clinic</option>
              <option value="ONLINE">Online</option>
            </select>
          </label>
          <label className="text-xs">Date
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); }} className={`${field} mt-1`} />
          </label>
        </div>
        {doctorId && (
          <div className="mt-3" role="group" aria-label="Available times">
            {slots.status === "loading" && <p role="status" className="text-xs">Loading times…</p>}
            {slots.status === "ready" && freeSlots.length === 0 && <p className="text-xs text-clear-secondary">No published times on this date.</p>}
            <div className="flex flex-wrap gap-2">
              {freeSlots.map((s) => (
                <button key={s.start} type="button" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)} className={`min-h-11 rounded-full border px-3 text-xs ${slot === s.start ? "border-clear-divider bg-clear-action text-white" : "border-clear-divider"}`}>{clinicTime(s.start)}</button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-clear-secondary">Times come from the doctor&apos;s published availability. A taken time shows an error, never a double booking.</p>
        <label className="mt-3 block text-xs">Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
      </section>
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
      <button type="button" disabled={busy || !patientId || !doctorId || !slot} onClick={() => void book()} className="min-h-12 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white disabled:opacity-50">Request appointment</button>
    </StaffShell>
  );
}
