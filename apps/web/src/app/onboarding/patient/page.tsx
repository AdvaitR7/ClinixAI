"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { patientOnboardingSchema, type PatientOnboarding } from "@clinix/schemas";
import { AuthShell, FormError } from "@/components/auth-shell";
import { fetchApi } from "@/lib/api";

const inputClass = "clinix-field mt-2 font-sans text-sm";

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
      eyebrow="Patient onboarding · 1 of 3"
      title="Welcome to CliniXAI"
      orientation="Let's set up your private patient record. You can change these details later."
    >
      <section className="mb-8 rounded-[1.75rem] bg-sage/20 p-1.5">
        <div className="rounded-[1.35rem] border border-sage bg-surface p-4">
          <p className="clinix-label text-botanical">Patient record</p>
          <div className="mt-2 flex items-center gap-3">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-botanical text-surface">✓</span>
            <div>
              <p className="font-sans text-sm font-semibold text-ink">Private by default</p>
              <p className="font-sans text-xs text-graphite">Nothing is shared without your consent.</p>
            </div>
          </div>
        </div>
      </section>
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
        <div className="grid gap-5 sm:grid-cols-2">
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
            <label className="flex min-h-20 cursor-pointer items-start gap-3 rounded-[1.25rem] border border-sage bg-surface p-4">
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
            <label className="flex min-h-20 cursor-pointer items-start gap-3 rounded-[1.25rem] border border-sage bg-surface p-4">
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
          className="min-h-[58px] w-full rounded-[1.25rem] bg-botanical px-4 font-sans text-base font-semibold text-surface shadow-[0_8px_18px_rgba(18,53,44,0.14)] transition-transform active:translate-y-px disabled:opacity-60"
        >
          {isSubmitting ? "Setting up…" : "Finish setup"}
        </button>
        <FormError message={submitError} />
      </form>
    </AuthShell>
  );
}
