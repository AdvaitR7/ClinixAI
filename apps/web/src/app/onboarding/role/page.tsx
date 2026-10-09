"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useMe } from "@/lib/api";

/**
 * Page 2 role selector (SCREEN_CATALOG §7: initial Primary UI selector —
 * Patient or Doctor; staff is invitation-only, never here).
 */
export default function RoleSelectPage() {
  const router = useRouter();
  const state = useMe();

  useEffect(() => {
    if (state.status === "ready") {
      router.replace(
        state.me.role === "DOCTOR" ? "/app/doctor" : "/app/patient",
      );
    }
  }, [state, router]);

  return (
    <AuthShell
      eyebrow="Onboarding"
      title="How will you use CliniX?"
      orientation="Choose the workspace to set up first. One account, one role for now."
    >
      <div className="space-y-4">
        <Link
          href="/onboarding/patient"
          className="clinix-card flex min-h-28 items-center justify-between gap-4 p-5 transition-transform active:translate-y-px"
        >
          <span>
            <span className="block font-sans text-lg font-semibold text-ink">I am a patient</span>
            <span className="mt-1 block font-sans text-sm leading-5 text-graphite">
              Keep your health vault, book care, and control record sharing.
            </span>
          </span>
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-botanical text-xl text-surface">→</span>
        </Link>
        <Link
          href="/onboarding/doctor"
          className="clinix-card flex min-h-28 items-center justify-between gap-4 p-5 transition-transform active:translate-y-px"
        >
          <span>
            <span className="block font-sans text-lg font-semibold text-ink">I am a doctor</span>
            <span className="mt-1 block font-sans text-sm leading-5 text-graphite">
              Set up a verified professional profile and clinical workspace.
            </span>
          </span>
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-copper text-xl text-ink">→</span>
        </Link>
        <Link
          href="/onboarding/staff"
          className="clinix-card flex min-h-24 items-center justify-between gap-4 border-copper p-5 transition-transform active:translate-y-px"
        >
          <span>
            <span className="block font-sans text-base font-semibold text-ink">I was invited by a clinic</span>
            <span className="mt-1 block font-sans text-sm text-graphite">Review an invitation as clinic staff.</span>
          </span>
          <span className="rounded-full border border-copper px-2 py-1 font-sans text-[10px] font-bold uppercase text-review">Invite only</span>
        </Link>
        <Link
          href="/onboarding/claim"
          className="block rounded-3xl border border-dashed border-sage bg-surface p-5 transition-transform active:translate-y-px"
        >
          <p className="font-sans text-base font-semibold text-ink">I have a claim code</p>
          <p className="mt-1 font-sans text-sm text-graphite">Link a clinic-created record to your account.</p>
        </Link>
      </div>
    </AuthShell>
  );
}
