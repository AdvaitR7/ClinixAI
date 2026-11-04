"use client";

import { Fragment, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";
import { useMe } from "@/lib/api";
import { workspacePathForRole } from "@/lib/workspace-routing";

/** Holds a protected route until the Supabase browser session is restored. */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, isLoaded, identityVersion } = useAuth();

  useEffect(() => {
    if (isLoaded && status === "signed-out") router.replace("/sign-in");
    else if (status === "recovery") router.replace("/reset-password");
  }, [isLoaded, router, status]);

  if (status === "signed-in") return <Fragment key={identityVersion}>{children}</Fragment>;
  if (status === "error") {
    return <AuthShell eyebrow="Secure access" title="Authentication unavailable" orientation="Check the browser auth configuration and try again."><span /></AuthShell>;
  }
  return <AuthShell eyebrow="CliniX" title="Loading your account" orientation="Checking your secure session."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
}

type WorkspaceAccessProps = { role?: "PATIENT" | "DOCTOR" | "CLINIC_STAFF"; children: ReactNode };

/** Restricts app routes to a supported database profile and optional workspace role. */
export function RequireWorkspace(props: WorkspaceAccessProps) {
  return <RequireSession><WorkspaceAccess {...props} /></RequireSession>;
}

/** Resolves profile access inside the identity-scoped protected subtree. */
function WorkspaceAccess({ role, children }: WorkspaceAccessProps) {
  const router = useRouter();
  const state = useMe();
  const applicationRole = state.status === "ready" ? state.me.role : null;
  const destination = applicationRole ? workspacePathForRole(applicationRole) : null;

  useEffect(() => {
    if (state.status === "signed-out") router.replace("/sign-in");
    else if (state.status === "needs-onboarding") router.replace("/onboarding/role");
    else if (role && destination && state.status === "ready" && applicationRole !== role) router.replace(destination);
  }, [applicationRole, destination, role, router, state.status]);

  if (state.status === "ready" && !destination) {
    return <AuthShell eyebrow="CliniX" title="Access unavailable" orientation="This account does not have an authorized CliniX workspace."><span /></AuthShell>;
  }
  if (state.status === "ready" && destination && (!role || state.me.role === role)) return children;
  if (state.status === "error") {
    return <AuthShell eyebrow="CliniX" title="Workspace unavailable" orientation="We could not confirm your application access."><button type="button" onClick={() => void state.refresh()} className="min-h-12 w-full rounded-2xl bg-botanical px-4 font-sans text-sm font-semibold text-surface">Try again</button></AuthShell>;
  }
  return <AuthShell eyebrow="CliniX" title="Loading your workspace" orientation="Checking your application access."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
}

/** Allows onboarding only before Fastify has resolved an application profile. */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  return <RequireSession><OnboardingAccess>{children}</OnboardingAccess></RequireSession>;
}

/** Prevents existing patients, doctors, and staff from entering another role's form. */
function OnboardingAccess({ children }: { children: ReactNode }) {
  const router = useRouter();
  const state = useMe();
  const destination = state.status === "ready" ? workspacePathForRole(state.me.role) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (state.status === "needs-onboarding") return children;
  if (state.status === "ready" && !destination) {
    return <AuthShell eyebrow="CliniX" title="Access unavailable" orientation="This account does not have an authorized CliniX workspace."><span /></AuthShell>;
  }
  if (state.status === "error") {
    return <AuthShell eyebrow="CliniX" title="Account unavailable" orientation="We could not confirm your application profile."><button type="button" onClick={() => void state.refresh()} className="min-h-12 w-full rounded-2xl bg-botanical px-4 font-sans text-sm font-semibold text-surface">Try again</button></AuthShell>;
  }
  return <AuthShell eyebrow="CliniX" title="Loading your account" orientation="Checking your application profile."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
}

/** Allows the staff workspace for CLINIC_STAFF profiles or any account holding an active staff membership. */
export function RequireStaffWorkspace({ children }: { children: ReactNode }) {
  return <RequireSession><StaffAccess>{children}</StaffAccess></RequireSession>;
}

/** Staff access derives from database memberships, never from a client-supplied role. */
function StaffAccess({ children }: { children: ReactNode }) {
  const router = useRouter();
  const state = useMe();
  const isStaff = state.status === "ready" && (state.me.role === "CLINIC_STAFF" || (state.me.memberships ?? []).some((m) => m.role === "RECEPTION" || m.role === "ASSISTANT"));
  const destination = state.status === "ready" ? workspacePathForRole(state.me.role) : null;

  useEffect(() => {
    if (state.status === "signed-out") router.replace("/sign-in");
    else if (state.status === "needs-onboarding") router.replace("/onboarding/role");
    else if (state.status === "ready" && !isStaff && destination) router.replace(destination);
  }, [destination, isStaff, router, state.status]);

  if (isStaff) return children;
  if (state.status === "error") {
    return <AuthShell eyebrow="CliniX" title="Workspace unavailable" orientation="We could not confirm your application access."><button type="button" onClick={() => void state.refresh()} className="min-h-12 w-full rounded-2xl bg-botanical px-4 font-sans text-sm font-semibold text-surface">Try again</button></AuthShell>;
  }
  return <AuthShell eyebrow="CliniX" title="Loading your workspace" orientation="Checking your application access."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
}
