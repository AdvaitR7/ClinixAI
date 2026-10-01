"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { doctorOnboardingSchema, type DoctorOnboarding } from "@clinix/schemas";
import { AuthShell, FormError } from "@/components/auth-shell";
import { fetchApi } from "@/lib/api";

const inputClass =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper";

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
      eyebrow="Doctor onboarding"
      title="Set up your professional profile"
      orientation="Your registration is reviewed before Doctor workspace access. Patient workspace access stays independent."
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="registration_number" className="font-sans text-sm font-medium">
            Medical registration number
          </label>
          <input id="registration_number" type="text" className={inputClass} {...register("registration_number")} />
          {errors.registration_number && (
            <p className="mt-1 font-sans text-sm text-critical">Enter your registration number.</p>
          )}
        </div>
        <div>
          <label htmlFor="registration_authority" className="font-sans text-sm font-medium">
            Registration authority / medical council
          </label>
          <input id="registration_authority" type="text" className={inputClass} {...register("registration_authority")} />
          {errors.registration_authority && (
            <p className="mt-1 font-sans text-sm text-critical">Enter the issuing authority.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="qualification" className="font-sans text-sm font-medium">
              Qualification <span className="text-graphite">(optional)</span>
            </label>
            <input id="qualification" type="text" className={inputClass} {...register("qualification")} />
          </div>
          <div>
            <label htmlFor="speciality" className="font-sans text-sm font-medium">
              Speciality <span className="text-graphite">(optional)</span>
            </label>
            <input id="speciality" type="text" className={inputClass} {...register("speciality")} />
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-surface p-4">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-review">
            Verification: pending
          </p>
          <p className="mt-1 font-sans text-sm text-graphite">
            New applications start as Pending. Evidence upload arrives in a later phase.
          </p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-11 w-full rounded-full bg-botanical px-4 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
        >
          {isSubmitting ? "Submitting…" : "Submit for verification"}
        </button>
        <FormError message={submitError} />
      </form>
    </AuthShell>
  );
}
