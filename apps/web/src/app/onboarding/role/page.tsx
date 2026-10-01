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
          className="block rounded-2xl border border-hairline bg-surface p-5 transition-transform active:translate-y-px"
        >
          <p className="font-sans text-base font-semibold">I am a patient</p>
          <p className="mt-1 font-sans text-sm text-graphite">
            Keep your health vault, check in on concerns, and book doctors.
          </p>
        </Link>
        <Link
          href="/onboarding/doctor"
          className="block rounded-2xl border border-hairline bg-surface p-5 transition-transform active:translate-y-px"
        >
          <p className="font-sans text-base font-semibold">I am a doctor</p>
          <p className="mt-1 font-sans text-sm text-graphite">
            Set up your professional profile and verification.
          </p>
        </Link>
        <Link
          href="/onboarding/staff"
          className="block rounded-2xl border border-hairline bg-surface p-5 transition-transform active:translate-y-px"
        >
          <p className="font-sans text-base font-semibold">I was invited by a clinic</p>
          <p className="mt-1 font-sans text-sm text-graphite">
            Accept a practice invitation as clinic staff.
          </p>
        </Link>
      </div>
    </AuthShell>
  );
}
