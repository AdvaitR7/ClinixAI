"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { workspacePathForRole } from "@/lib/workspace-routing";

/** Post-login router: resolves the default workspace from GET /me. */
export default function AfterSignInPage() {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const state = useMe();
  const applicationRole = state.status === "ready" ? state.me.role : null;

  useEffect(() => {
    if (authStatus === "recovery" || state.status === "recovery") router.replace("/reset-password");
    else if (authStatus === "error") return;
    else if (state.status === "signed-out") router.replace("/sign-in");
    else if (state.status === "needs-onboarding") router.replace("/onboarding/role");
    else if (state.status === "ready") {
      const destination = workspacePathForRole(applicationRole ?? "");
      if (destination) router.replace(destination);
    }
  }, [applicationRole, authStatus, router, state.status]);

  if (authStatus === "error") {
    return <AuthShell eyebrow="CliniX" title="Authentication unavailable" orientation="Check the browser auth configuration and try again."><span /></AuthShell>;
  }
  if (state.status === "ready" && !workspacePathForRole(state.me.role)) {
    return <AuthShell eyebrow="CliniX" title="Access unavailable" orientation="This account does not have an authorized CliniX workspace."><span /></AuthShell>;
  }

  return (
    <AuthShell
      eyebrow="CliniX"
      title="Opening your workspace"
      orientation="Checking your account and loading the right workspace."
    >
      {state.status === "error" ? <div><p role="alert" className="font-sans text-sm text-critical">We could not load your account. Please try again.</p><button type="button" onClick={() => void state.refresh()} className="mt-4 font-sans text-xs font-semibold uppercase text-clear-info">Try again</button></div> : (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-12 animate-pulse rounded-xl bg-hairline" />
          <div className="h-12 animate-pulse rounded-xl bg-hairline" />
        </div>
      )}
    </AuthShell>
  );
}
