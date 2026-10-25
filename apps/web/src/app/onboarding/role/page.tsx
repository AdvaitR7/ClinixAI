"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { useMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { workspacePathForRole } from "@/lib/workspace-routing";

/**
 * Page 2 role selector (SCREEN_CATALOG §7: initial Primary UI selector —
 * Patient or Doctor; staff is invitation-only, never here).
 */
export default function RoleSelectPage() {
  const router = useRouter();
  const { status: authStatus, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const state = useMe();
  const applicationRole = state.status === "ready" ? state.me.role : null;

  /** Lets a new account sign out before it creates a clinical profile. */
  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try { await signOut(); }
    catch { setSignOutError("Could not sign out. Please try again."); }
    finally { setSigningOut(false); }
  }

  useEffect(() => {
    if (authStatus === "recovery" || state.status === "recovery") router.replace("/reset-password");
    else if (state.status === "ready") {
      const destination = workspacePathForRole(applicationRole ?? "");
      if (destination) router.replace(destination);
    } else if (state.status === "signed-out") router.replace("/sign-in");
  }, [applicationRole, authStatus, router, state.status]);

  if (authStatus === "error") {
    return <AuthShell eyebrow="Onboarding" title="Authentication unavailable" orientation="Check the browser auth configuration and try again."><span /></AuthShell>;
  }
  if (authStatus === "recovery" || state.status === "recovery") {
    return <AuthShell eyebrow="Account recovery" title="Reset your password" orientation="Complete password recovery to continue."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
  }
  if (state.status === "error") {
    return <AuthShell eyebrow="Onboarding" title="Account unavailable" orientation="We could not confirm your application profile. Try again shortly."><button type="button" onClick={() => void state.refresh()} className="font-sans text-xs font-semibold uppercase text-evidence">Try again</button></AuthShell>;
  }
  if (state.status === "ready" && !workspacePathForRole(state.me.role)) {
    return <AuthShell eyebrow="CliniX" title="Access unavailable" orientation="This account does not have an authorized CliniX workspace."><span /></AuthShell>;
  }

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
              Set up your professional profile and clinical workspace.
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
      <FormError message={signOutError} />
      <button type="button" disabled={signingOut} onClick={() => void handleSignOut()} className="mt-5 block w-full text-center font-sans text-xs font-semibold uppercase text-evidence disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out"}</button>
    </AuthShell>
  );
}
