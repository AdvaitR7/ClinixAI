"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { staffCreatePatientSchema } from "@clinix/schemas";
import { useApiData } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { useApiWrite } from "@/lib/staff";

const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";
const field = "min-h-11 w-full rounded-xl border border-clear-divider bg-clear-surface px-3 text-sm";

type Doctor = { doctor_id: string; name: string; speciality: string | null };

/** Staff Add Patient (follows the Page 22 composition): registers an unclaimed patient for a doctor of this practice. */
export default function StaffAddPatientPage() {
  return <Suspense fallback={null}><AddPatientContent /></Suspense>;
}

function AddPatientContent() {
  const practiceId = useSearchParams().get("practice_id");
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const doctors = useApiData<Doctor[]>(`/staff/doctors${qs}`);
  const write = useApiWrite();
  const [form, setForm] = useState({ full_name: "", mobile: "", date_of_birth: "", sex_at_registration: "", doctor_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ patientId: string; name: string } | null>(null);
  const [code, setCode] = useState<string | null>(null);

  /** Validates with the shared schema, then creates the patient; a duplicate mobile is reported, not merged. */
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = staffCreatePatientSchema.safeParse(form);
    if (!parsed.success) {
      setError("Check every field: name, mobile, date of birth, sex and doctor are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await write<{ patient_id: string }>(`/staff/patients${qs}`, "POST", parsed.data);
      setCreated({ patientId: res.patient_id, name: form.full_name });
    } catch (cause) {
      const duplicate = (cause as { code?: string }).code === "DUPLICATE_PATIENT";
      setError(duplicate ? "A patient with this mobile number already exists." : cause instanceof Error ? cause.message : "Could not create the patient.");
    } finally {
      setBusy(false);
    }
  }

  /** Issues the one-time claim code; it is shown once on this screen. */
  async function invite() {
    if (!created) return;
    setError(null);
    try {
      const res = await write<{ invite_token: string }>(`/staff/patients/${created.patientId}/claim-invites${qs}`, "POST");
      setCode(res.invite_token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the claim invitation.");
    }
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((cur) => ({ ...cur, [key]: event.target.value }));

  if (created) {
    return (
      <StaffShell role={null} active="patients" title="Patient created">
        <div>
          <p className={label}>Clinic operations · patient created</p>
          <h1 className="mt-2 text-[28px] leading-tight">{created.name}</h1>
        </div>
        <section className={card}>
          <p className="text-sm">Registered as an unclaimed patient. Booking grants no record access.</p>
          {code && <p role="status" className="mt-3 break-all text-xs text-clear-action">Claim code (shown once): {code}</p>}
        </section>
        {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        <Link href={`/app/staff/book${qs}`} className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Book appointment</Link>
        {!code && <button type="button" onClick={() => void invite()} className="min-h-12 w-full rounded-2xl border border-clear-divider px-4 text-sm font-semibold">Send claim invitation</button>}
        <Link href="/app/staff/schedule?tab=patients" className="inline-flex min-h-11 items-center text-xs text-clear-info">Back to patients</Link>
      </StaffShell>
    );
  }

  return (
    <StaffShell role={null} active="patients" title="Add patient">
      <Link href="/app/staff/schedule?tab=patients" className="inline-flex min-h-11 items-center text-xs text-clear-info">← Back to patients</Link>
      <div>
        <p className={label}>Clinic operations · add patient</p>
        <h1 className="mt-2 text-[28px] leading-tight">Add a patient</h1>
      </div>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
        <section className={card}>
          <label className="text-xs">Full name
            <input value={form.full_name} onChange={set("full_name")} autoComplete="off" className={`${field} mt-1`} />
          </label>
          <label className="mt-3 block text-xs">Mobile number
            <input type="tel" value={form.mobile} onChange={set("mobile")} autoComplete="off" className={`${field} mt-1`} />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs">Date of birth
              <input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} className={`${field} mt-1`} />
            </label>
            <label className="text-xs">Sex
              <select value={form.sex_at_registration} onChange={set("sex_at_registration")} className={`${field} mt-1`}>
                <option value="">Select</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>
        </section>
        <section className={card}>
          <label className="text-xs">Doctor
            <select aria-label="Doctor" value={form.doctor_id} onChange={set("doctor_id")} className={`${field} mt-1`}>
              <option value="">Select a doctor</option>
              {doctors.status === "ready" && doctors.data.map((d) => <option key={d.doctor_id} value={d.doctor_id}>{d.name}{d.speciality ? ` · ${d.speciality}` : ""}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-clear-secondary">Only this practice&apos;s doctors are listed. Staff cannot view the clinical record.</p>
        </section>
        {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        <button type="submit" disabled={busy} className="min-h-12 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white disabled:opacity-50">Create patient</button>
      </form>
    </StaffShell>
  );
}
