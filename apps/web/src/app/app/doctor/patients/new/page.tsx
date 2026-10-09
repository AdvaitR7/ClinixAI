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
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/patients", disabled: true },
];

const inputClass =
  "mt-1.5 min-h-[50px] w-full rounded-2xl border border-white/10 bg-doctor-panel px-3.5 font-sans text-sm text-surface outline-none focus:border-copper";

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
    <WorkspaceShell workspace="Doctor" title="Add clinic patient" nav={nav}>
      {!review ? (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="clinix-doctor-card border-copper p-4">
            <p className="clinix-label text-copper">Professional-record boundary</p>
            <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/75">
              This creates a clinic-managed record. The patient can link and claim this record
              into their private vault later.
            </p>
          </div>

          <div>
            <label htmlFor="full_name" className="font-sans text-sm font-medium text-surface">
              Full name *
            </label>
            <input id="full_name" type="text" className={inputClass} {...register("full_name")} />
            {errors.full_name && (
              <p className="mt-1 font-sans text-xs text-critical">Enter the full name.</p>
            )}
          </div>
          <div>
            <label htmlFor="mobile" className="font-sans text-sm font-medium text-surface">
              Mobile number *
            </label>
            <input id="mobile" type="tel" className={inputClass} {...register("mobile")} />
            {errors.mobile && (
              <p className="mt-1 font-sans text-xs text-critical">Enter a valid mobile number.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date_of_birth" className="font-sans text-sm font-medium text-surface">
                Date of birth *
              </label>
              <input id="date_of_birth" type="date" className={inputClass} {...register("date_of_birth")} />
              {errors.date_of_birth && (
                <p className="mt-1 font-sans text-xs text-critical">Use YYYY-MM-DD format.</p>
              )}
            </div>
            <div>
              <label htmlFor="sex_at_registration" className="font-sans text-sm font-medium text-surface">
                Sex *
              </label>
              <input id="sex_at_registration" type="text" placeholder="Female / Male / Other" className={inputClass} {...register("sex_at_registration")} />
              {errors.sex_at_registration && (
                <p className="mt-1 font-sans text-xs text-critical">Required.</p>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="relationship_type" className="font-sans text-sm font-medium text-surface">
              Care relationship
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
          <label className="flex cursor-pointer items-center gap-2.5 font-sans text-sm text-surface">
            <input type="checkbox" {...register("preferred")} className="h-4 w-4 accent-copper" />
            Designate as preferred physician
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[54px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink transition-transform active:translate-y-px disabled:opacity-60"
          >
            Review patient details
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          <section className="clinix-doctor-card p-5">
            <p className="clinix-label text-copper">Confirm patient record</p>
            <dl className="mt-4 space-y-3 font-sans text-sm">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-doctor-muted/70">Name</dt>
                <dd className="font-semibold text-surface">{review.full_name}</dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-doctor-muted/70">Mobile</dt>
                <dd className="font-mono text-surface">{review.mobile}</dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-doctor-muted/70">Date of birth</dt>
                <dd className="font-mono text-surface">{review.date_of_birth}</dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-doctor-muted/70">Sex</dt>
                <dd className="text-surface">{review.sex_at_registration}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-doctor-muted/70">Relationship</dt>
                <dd className="text-surface">{review.relationship_type ?? "PRIMARY_PHYSICIAN"}</dd>
              </div>
            </dl>
          </section>

          {candidates && candidates.length > 0 && (
            <section className="clinix-doctor-card border-review p-5">
              <p className="clinix-label text-review">Possible duplicate records found</p>
              <p className="mt-1 font-sans text-xs text-doctor-muted/75">
                A record with this mobile number already exists. Open the existing record or resolve.
              </p>
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => (
                  <li key={c.patient_id}>
                    <button
                      type="button"
                      onClick={() => router.replace(`/app/doctor/patients/${c.patient_id}`)}
                      className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-left font-sans text-sm text-surface hover:border-copper"
                    >
                      <span className="font-semibold">{c.full_name}</span>
                      <span className="text-doctor-muted/70"> — open existing patient dossier</span>
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
              className="min-h-[52px] flex-1 rounded-[1.25rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm font-semibold text-surface"
            >
              Edit details
            </button>
            <button
              type="button"
              onClick={create}
              className="min-h-[52px] flex-1 rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink transition-transform active:translate-y-px"
            >
              Create patient
            </button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
