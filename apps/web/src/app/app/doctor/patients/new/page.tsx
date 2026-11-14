"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { DoctorDirectoryEntry } from "@clinix/schemas";
import { doctorCreatePatientSchema, type DoctorCreatePatient } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { fetchApi } from "@/lib/api";
import { recordHref } from "@/lib/route-params";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/patients", disabled: true },
];

const inputClass =
  "mt-1.5 min-h-[50px] w-full rounded-2xl border border-clear-divider bg-clear-surface px-3.5 font-sans text-sm text-clear-ink outline-none focus:border-clear-action";

/** Page 22 — Add Clinic Patient (SCREEN_CATALOG §7). */
export default function AddPatientPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [review, setReview] = useState<DoctorCreatePatient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DoctorDirectoryEntry[] | null>(null);
  const [created, setCreated] = useState<{ patientId: string; summary: DoctorCreatePatient } | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
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
      setCreated({ patientId: res.patient_id, summary: review });
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

  /** Issues the one-time claim code for the new patient; it is shown once and never stored in the page URL. */
  async function sendInvite() {
    if (!created) return;
    setInviting(true);
    setInviteError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<{ invite_token: string; expires_at: string }>(
        token,
        `/doctor/patients/${created.patientId}/claim-invites`,
        { method: "POST", body: "{}" },
      );
      setInvite({ code: res.invite_token, expiresAt: res.expires_at });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not create the claim invitation.");
    } finally {
      setInviting(false);
    }
  }

  /** SCR-041: confirms the patient exists and offers the two next steps. */
  if (created) {
    return (
      <WorkspaceShell workspace="Doctor" title="Patient created" nav={nav}>
        <section className="clear-card border-clear-divider p-5">
          <p className="clinix-label text-clear-action">Patient record created</p>
          <dl className="mt-4 space-y-3 font-sans text-sm">
            <div className="flex justify-between border-b border-clear-divider pb-2">
              <dt className="text-clear-secondary">Name</dt>
              <dd className="font-semibold text-clear-ink">{created.summary.full_name}</dd>
            </div>
            <div className="flex justify-between border-b border-clear-divider pb-2">
              <dt className="text-clear-secondary">Date of birth</dt>
              <dd className="font-sans tabular-nums text-clear-ink">{created.summary.date_of_birth}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-clear-secondary">Status</dt>
              <dd className="text-clear-ink">Unclaimed</dd>
            </div>
          </dl>
        </section>
        {invite && (
          <section role="status" className="clear-card border-review p-5">
            <p className="clinix-label text-review">Claim code (shown once)</p>
            <p className="mt-2 break-all font-sans tabular-nums text-sm text-clear-ink">{invite.code}</p>
            <p className="mt-2 font-sans text-xs text-clear-secondary">Give this code to the patient. It expires on {new Date(invite.expiresAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} and cannot be shown again.</p>
          </section>
        )}
        {inviteError && <p role="alert" className="font-sans text-sm font-medium text-critical">{inviteError}</p>}
        <div className="flex flex-col gap-3">
          <Link
            href={recordHref("/app/doctor/patients", "patientId", created.patientId)}
            className="flex min-h-[52px] items-center justify-center rounded-[1.25rem] bg-clear-action px-4 font-sans text-sm font-semibold uppercase text-white"
          >
            Open workspace
          </Link>
          {!invite && (
            <button
              type="button"
              disabled={inviting}
              onClick={() => void sendInvite()}
              className="min-h-[52px] rounded-[1.25rem] border border-clear-divider bg-clear-surface px-4 font-sans text-sm font-semibold text-clear-ink disabled:opacity-60"
            >
              Send claim invitation
            </button>
          )}
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Add clinic patient" nav={nav}>
      {!review ? (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="clear-card border-clear-divider p-4">
            <p className="clinix-label text-clear-action">Professional-record boundary</p>
            <p className="mt-1 font-sans text-xs leading-5 text-clear-secondary">
              This creates a clinic-managed record. The patient can link and claim this record
              into their private vault later.
            </p>
          </div>

          <div>
            <label htmlFor="full_name" className="font-sans text-sm font-medium text-clear-ink">
              Full name *
            </label>
            <input id="full_name" type="text" className={inputClass} {...register("full_name")} />
            {errors.full_name && (
              <p className="mt-1 font-sans text-xs text-critical">Enter the full name.</p>
            )}
          </div>
          <div>
            <label htmlFor="mobile" className="font-sans text-sm font-medium text-clear-ink">
              Mobile number *
            </label>
            <input id="mobile" type="tel" className={inputClass} {...register("mobile")} />
            {errors.mobile && (
              <p className="mt-1 font-sans text-xs text-critical">Enter a valid mobile number.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date_of_birth" className="font-sans text-sm font-medium text-clear-ink">
                Date of birth *
              </label>
              <input id="date_of_birth" type="date" className={inputClass} {...register("date_of_birth")} />
              {errors.date_of_birth && (
                <p className="mt-1 font-sans text-xs text-critical">Use YYYY-MM-DD format.</p>
              )}
            </div>
            <div>
              <label htmlFor="sex_at_registration" className="font-sans text-sm font-medium text-clear-ink">
                Sex *
              </label>
              <input id="sex_at_registration" type="text" placeholder="Female / Male / Other" className={inputClass} {...register("sex_at_registration")} />
              {errors.sex_at_registration && (
                <p className="mt-1 font-sans text-xs text-critical">Required.</p>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="relationship_type" className="font-sans text-sm font-medium text-clear-ink">
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
          <label className="flex cursor-pointer items-center gap-2.5 font-sans text-sm text-clear-ink">
            <input type="checkbox" {...register("preferred")} className="h-4 w-4 accent-clear-action" />
            Designate as preferred physician
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[54px] w-full rounded-[1.25rem] bg-clear-action px-4 font-sans text-sm font-semibold uppercase text-white transition-transform active:translate-y-px disabled:opacity-60"
          >
            Review patient details
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          <section className="clear-card p-5">
            <p className="clinix-label text-clear-action">Confirm patient record</p>
            <dl className="mt-4 space-y-3 font-sans text-sm">
              <div className="flex justify-between border-b border-clear-divider pb-2">
                <dt className="text-clear-secondary">Name</dt>
                <dd className="font-semibold text-clear-ink">{review.full_name}</dd>
              </div>
              <div className="flex justify-between border-b border-clear-divider pb-2">
                <dt className="text-clear-secondary">Mobile</dt>
                <dd className="font-sans tabular-nums text-clear-ink">{review.mobile}</dd>
              </div>
              <div className="flex justify-between border-b border-clear-divider pb-2">
                <dt className="text-clear-secondary">Date of birth</dt>
                <dd className="font-sans tabular-nums text-clear-ink">{review.date_of_birth}</dd>
              </div>
              <div className="flex justify-between border-b border-clear-divider pb-2">
                <dt className="text-clear-secondary">Sex</dt>
                <dd className="text-clear-ink">{review.sex_at_registration}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-clear-secondary">Relationship</dt>
                <dd className="text-clear-ink">{review.relationship_type ?? "PRIMARY_PHYSICIAN"}</dd>
              </div>
            </dl>
          </section>

          {candidates && candidates.length > 0 && (
            <section className="clear-card border-review p-5">
              <p className="clinix-label text-review">Possible duplicate records found</p>
              <p className="mt-1 font-sans text-xs text-clear-secondary">
                A record with this mobile number already exists. Open the existing record or resolve.
              </p>
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => (
                  <li key={c.patient_id}>
                    <button
                      type="button"
                      onClick={() => router.replace(recordHref("/app/doctor/patients", "patientId", c.patient_id))}
                      className="w-full rounded-xl border border-clear-divider bg-clear-canvas p-3 text-left font-sans text-sm text-clear-ink hover:border-clear-action"
                    >
                      <span className="font-semibold">{c.full_name}</span>
                      <span className="text-clear-secondary"> — open existing patient dossier</span>
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
              className="min-h-[52px] flex-1 rounded-[1.25rem] border border-clear-divider bg-clear-surface px-4 font-sans text-sm font-semibold text-clear-ink"
            >
              Edit details
            </button>
            <button
              type="button"
              onClick={create}
              className="min-h-[52px] flex-1 rounded-[1.25rem] bg-clear-action px-4 font-sans text-sm font-semibold uppercase text-white transition-transform active:translate-y-px"
            >
              Create patient
            </button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
