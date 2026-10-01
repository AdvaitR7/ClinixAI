"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { patientOnboardingSchema, type PatientOnboarding } from "@clinix/schemas";
import { AuthShell, FormError } from "@/components/auth-shell";
import { fetchApi } from "@/lib/api";

const inputClass =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper";

/**
 * Page 2a — Patient Onboarding (SCREEN_CATALOG §7): identity form, vault vs
 * private-mode choice, mobile record-lookup stub (real claim flow is Phase 2).
 */
export default function PatientOnboardingPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [mode, setMode] = useState<"vault" | "private">("vault");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PatientOnboarding>({ resolver: zodResolver(patientOnboardingSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi<{ patient_id: string }>(token, "/patients/self", {
        method: "POST",
        body: JSON.stringify(data),
      });
      router.replace("/app/patient");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    }
  });

  return (
    <AuthShell
      eyebrow="Patient onboarding"
      title="Set up your patient workspace"
      orientation="Your identity is stored encrypted. Only you control who sees it."
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="full_name" className="font-sans text-sm font-medium">
            Full name
          </label>
          <input id="full_name" type="text" autoComplete="name" className={inputClass} {...register("full_name")} />
          {errors.full_name && (
            <p className="mt-1 font-sans text-sm text-critical">Enter your full name.</p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className="font-sans text-sm font-medium">
            Mobile number
          </label>
          <p className="mb-1 font-sans text-xs text-graphite">
            Used to find records your doctor may have created for you (Phase 2 lookup).
          </p>
          <input id="phone" type="tel" autoComplete="tel" className={inputClass} {...register("phone")} />
          {errors.phone && (
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
          </div>
        </div>

        <fieldset>
          <legend className="font-sans text-sm font-medium">How should CliniX keep your data?</legend>
          <div className="mt-2 space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hairline bg-surface p-4">
              <input
                type="radio"
                name="privacy-mode"
                checked={mode === "vault"}
                onChange={() => setMode("vault")}
                className="mt-1 h-4 w-4 accent-[#12352c]"
              />
              <span>
                <span className="block font-sans text-sm font-semibold">Personal Health Vault</span>
                <span className="block font-sans text-sm text-graphite">
                  Persistent longitudinal storage of your records, under your control.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hairline bg-surface p-4">
              <input
                type="radio"
                name="privacy-mode"
                checked={mode === "private"}
                onChange={() => setMode("private")}
                className="mt-1 h-4 w-4 accent-[#12352c]"
              />
              <span>
                <span className="block font-sans text-sm font-semibold">Private Consultation Mode</span>
                <span className="block font-sans text-sm text-graphite">
                  Temporary processing with package export — no mandatory long-term storage.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-11 w-full rounded-full bg-botanical px-4 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
        >
          {isSubmitting ? "Setting up…" : "Finish setup"}
        </button>
        <FormError message={submitError} />
      </form>
    </AuthShell>
  );
}
