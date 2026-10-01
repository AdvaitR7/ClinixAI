"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useMe } from "@/lib/api";

function workspacePath(role: string): string {
  if (role === "DOCTOR") return "/app/doctor";
  if (role === "CLINIC_STAFF") return "/app/staff";
  return "/app/patient";
}

/** Post-login router: resolves the default workspace from GET /me. */
export default function AfterSignInPage() {
  const router = useRouter();
  const state = useMe();

  useEffect(() => {
    if (state.status === "needs-onboarding") router.replace("/onboarding/role");
    else if (state.status === "ready") router.replace(workspacePath(state.me.role));
  }, [state, router]);

  return (
    <AuthShell
      eyebrow="CliniX"
      title="Opening your workspace"
      orientation="Checking your account and loading the right workspace."
    >
      <div className="space-y-3" aria-hidden="true">
        <div className="h-12 animate-pulse rounded-xl bg-hairline" />
        <div className="h-12 animate-pulse rounded-xl bg-hairline" />
      </div>
    </AuthShell>
  );
}
