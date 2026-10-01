"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useMe } from "@/lib/api";

function workspacePath(role: string): string {
  if (role === "DOCTOR") return "/app/doctor";
  if (role === "CLINIC_STAFF") return "/app/staff";
  return "/app/patient";
}

/** Page 5 — Settings (SCREEN_CATALOG §7): single-entitlement switcher. */
export default function SettingsPage() {
  const router = useRouter();
  const state = useMe();

  useEffect(() => {
    if (state.status === "needs-onboarding") router.replace("/onboarding/role");
  }, [state, router]);

  return (
    <AuthShell
      eyebrow="Settings"
      title="Account"
      orientation="Manage your account and switch workspaces."
    >
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-12 animate-pulse rounded-xl bg-hairline" />
          <div className="h-12 animate-pulse rounded-xl bg-hairline" />
        </div>
      )}
      {state.status === "ready" && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Current workspace
            </p>
            <p className="mt-1 font-sans text-base font-semibold">{state.me.role}</p>
            <p className="mt-1 font-mono text-xs text-graphite">{state.me.profile_id}</p>
            {state.me.role === "DOCTOR" && state.me.verification_status && (
              <p className="mt-2 font-sans text-sm">
                Verification:{" "}
                <span className="font-semibold text-review">{state.me.verification_status}</span>
              </p>
            )}
          </section>
          <Link
            href={workspacePath(state.me.role)}
            className="block rounded-full bg-botanical px-4 py-3 text-center font-sans text-base font-semibold text-surface transition-transform active:translate-y-px"
          >
            Open {state.me.role} workspace
          </Link>
          <p className="font-sans text-sm text-graphite">
            One account holds one workspace for now. More workspaces arrive in
            later phases.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
