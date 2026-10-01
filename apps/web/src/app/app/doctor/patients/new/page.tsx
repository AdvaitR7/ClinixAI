"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { DoctorDirectoryEntry } from "@clinix/schemas";
import { doctorCreatePatientSchema, type DoctorCreatePatient } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { fetchApi } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/patients", disabled: true },
  { label: "Follow-ups", href: "/app/doctor/patients", disabled: true },
];

const inputClass =
  "mt-1 h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper";

/** Page 22 — Add Clinic Patient (SCREEN_CATALOG §7). */
export default function AddPatientPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [review, setReview] = useState<DoctorCreatePatient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DoctorDirectoryEntry[] | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DoctorCreatePatient>({
    resolver: zodResolver(doctorCreatePatientSchema),
    defaultValues: { relationship_type: "PRIMARY_PHYSICIAN", preferred: false },
  });

  const onSubmit = handleSubmit((data) => {
    setError(null);
    setCandidates(null);
    setReview(data);
  });

  async function create() {
    if (!review) return;
    setError(null);
    setCandidates(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<{ patient_id: string }>(token, "/doctor/patients", {
        method: "POST",
        body: JSON.stringify(review),
      });
      router.replace(`/app/doctor/patients/${res.patient_id}`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "DUPLICATE_PATIENT") {
        const token = await getToken();
        if (token) {
          const matches = await fetchApi<DoctorDirectoryEntry[]>(
            token,
            `/doctor/patients?q=${encodeURIComponent(review.mobile)}`,
          );
          setCandidates(matches);
        }
        setError("A patient with this mobile number already exists.");
      } else {
        setError(err instanceof Error ? err.message : "Could not create patient");
      }
    }
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Add patient" nav={nav}>
      {!review ? (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div>
            <label htmlFor="full_name" className="font-sans text-sm font-medium">
              Full name
            </label>
            <input id="full_name" type="text" className={inputClass} {...register("full_name")} />
            {errors.full_name && (
              <p className="mt-1 font-sans text-sm text-critical">Enter the full name.</p>
            )}
          </div>
          <div>
            <label htmlFor="mobile" className="font-sans text-sm font-medium">
              Mobile number
            </label>
            <input id="mobile" type="tel" className={inputClass} {...register("mobile")} />
            {errors.mobile && (
              <p className="mt-1 font-sans text-sm text-critical">Enter a valid mobile number.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date_of_birth" className="font-sans text-sm font-medium">
                Date of birth
              </label>
              <input id="date_of_birth" type="date" className={inputClass} {...register("date_of_birth")} />
              {errors.date_of_birth && (
                <p className="mt-1 font-sans text-sm text-critical">Use YYYY-MM-DD format.</p>
              )}
            </div>
            <div>
              <label htmlFor="sex_at_registration" className="font-sans text-sm font-medium">
                Sex at registration
              </label>
              <input id="sex_at_registration" type="text" className={inputClass} {...register("sex_at_registration")} />
              {errors.sex_at_registration && (
                <p className="mt-1 font-sans text-sm text-critical">Required.</p>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="relationship_type" className="font-sans text-sm font-medium">
              Relationship
            </label>
            <select id="relationship_type" className={inputClass} {...register("relationship_type")}>
              <option value="PRIMARY_PHYSICIAN">Primary physician</option>
              <option value="DERMATOLOGIST">Dermatologist</option>
              <option value="CARDIOLOGIST">Cardiologist</option>
              <option value="DENTIST">Dentist</option>
              <option value="PSYCHIATRIST">Psychiatrist</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <label className="flex items-center gap-2 font-sans text-sm">
            <input type="checkbox" {...register("preferred")} className="h-4 w-4 accent-[#12352c]" />
            Preferred doctor
          </label>

          <div className="rounded-2xl border border-hairline bg-surface p-4">
            <p className="font-sans text-sm text-graphite">
              This creates a clinic-managed record. It does not create a patient-owned CliniX
              account. The patient can claim this record later (invite arrives in a later phase).
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-botanical px-4 py-3 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
          >
            Review
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Confirm patient
            </p>
            <dl className="mt-3 space-y-2 font-sans text-sm">
              <div className="flex justify-between">
                <dt className="text-graphite">Name</dt>
                <dd className="font-semibold">{review.full_name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-graphite">Mobile</dt>
                <dd className="font-mono">{review.mobile}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-graphite">Date of birth</dt>
                <dd className="font-mono">{review.date_of_birth}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-graphite">Sex</dt>
                <dd>{review.sex_at_registration}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-graphite">Relationship</dt>
                <dd>{review.relationship_type ?? "PRIMARY_PHYSICIAN"}</dd>
              </div>
            </dl>
          </section>

          {candidates && candidates.length > 0 && (
            <section className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-review">
                Possible existing records
              </p>
              <ul className="mt-2 space-y-2">
                {candidates.map((c) => (
                  <li key={c.patient_id}>
                    <button
                      type="button"
                      onClick={() => router.replace(`/app/doctor/patients/${c.patient_id}`)}
                      className="w-full rounded-xl border border-hairline p-3 text-left font-sans text-sm"
                    >
                      <span className="font-semibold">{c.full_name}</span>
                      <span className="text-graphite"> — this is the same patient</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <p className="font-sans text-sm font-medium text-critical">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setReview(null)}
              className="flex-1 rounded-full border border-hairline px-4 py-3 font-sans text-base font-semibold text-graphite"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={create}
              className="flex-1 rounded-full bg-botanical px-4 py-3 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px"
            >
              Create patient
            </button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
