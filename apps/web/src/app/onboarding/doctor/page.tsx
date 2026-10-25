"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { doctorOnboardingSchema, type DoctorOnboarding } from "@clinix/schemas";
import { AuthShell, FormError } from "@/components/auth-shell";
import { fetchApi } from "@/lib/api";

const inputClass = "clinix-field mt-2 border-copper/80 bg-graphite text-surface placeholder:text-doctor-muted/60";

/**
 * Page 2b — Doctor Onboarding (SCREEN_CATALOG §7). Verification evidence
 * upload deferred to Phase 4; new rows start PENDING server-side.
 */
export default function DoctorOnboardingPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DoctorOnboarding>({ resolver: zodResolver(doctorOnboardingSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi<{ doctor_id: string }>(token, "/doctors/self", {
        method: "POST",
        body: JSON.stringify(data),
      });
      router.replace("/app/doctor");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    }
  });

  return (
    <AuthShell
      eyebrow="Doctor onboarding · 1 of 3"
      title="Your clinical profile"
      orientation="Add a few professional details. Your Doctor workspace opens when setup is complete."
      tone="doctor"
    >
      <section className="mb-8 rounded-[1.75rem] border-[6px] border-copper bg-graphite p-4">
        <p className="clinix-label text-copper">Clinical profile</p>
        <div className="mt-2 flex items-center gap-3">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-copper text-ink">✓</span>
          <div>
            <p className="font-sans text-sm font-semibold text-surface">Professional identity</p>
            <p className="font-sans text-xs text-doctor-muted/75">Your role and credentials stay linked to records you author.</p>
          </div>
        </div>
      </section>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="registration_number" className="font-sans text-sm font-medium text-surface">
            Medical registration number
          </label>
          <input id="registration_number" type="text" className={inputClass} {...register("registration_number")} />
          {errors.registration_number && (
            <p className="mt-1 font-sans text-sm text-critical">Enter your registration number.</p>
          )}
        </div>
        <div>
          <label htmlFor="registration_authority" className="font-sans text-sm font-medium text-surface">
            Registration authority / medical council
          </label>
          <input id="registration_authority" type="text" className={inputClass} {...register("registration_authority")} />
          {errors.registration_authority && (
            <p className="mt-1 font-sans text-sm text-critical">Enter the issuing authority.</p>
          )}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="qualification" className="font-sans text-sm font-medium text-surface">
              Qualification <span className="text-graphite">(optional)</span>
            </label>
            <input id="qualification" type="text" className={inputClass} {...register("qualification")} />
          </div>
          <div>
            <label htmlFor="speciality" className="font-sans text-sm font-medium text-surface">
              Speciality <span className="text-graphite">(optional)</span>
            </label>
            <input id="speciality" type="text" className={inputClass} {...register("speciality")} />
          </div>
        </div>

        <div className="rounded-2xl border border-copper/70 bg-graphite p-4">
          <p className="clinix-label text-copper">Verification: pending</p>
          <p className="mt-1 font-sans text-sm text-doctor-muted/75">
            Your details are recorded as Pending; workspace access opens after setup.
          </p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[58px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-base font-semibold text-ink transition-transform active:translate-y-px disabled:opacity-60"
        >
          {isSubmitting ? "Setting up…" : "Finish setup"}
        </button>
        <FormError message={submitError} />
      </form>
    </AuthShell>
  );
}
