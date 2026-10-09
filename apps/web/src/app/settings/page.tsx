"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Skeleton } from "@/components/skeleton";
import { useMe } from "@/lib/api";

function workspacePath(role: string): string {
  if (role === "DOCTOR") return "/app/doctor";
  if (role === "CLINIC_STAFF") return "/app/staff";
  return "/app/patient";
}

const unavailableSettings = [
  ["Notifications", "Notification preferences are not configured yet."],
  ["Active practice", "Practice switching arrives with clinic memberships."],
  ["Export account data", "Account-level export is not available yet."],
  ["Delete account", "Contact support until the deletion workflow is available."],
] as const;

/** Page 5 — derived Settings surface; only current workspace is functional. */
export default function SettingsPage() {
  const router = useRouter();
  const state = useMe();

  useEffect(() => {
    if (state.status === "needs-onboarding") router.replace("/onboarding/role");
  }, [state, router]);

  return (
    <AuthShell
      eyebrow="Settings"
      title="Account & workspace"
      orientation="Review your current CliniX access and account options."
    >
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-36 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      )}
      {state.status === "ready" && (
        <div className="space-y-6">
          <section className="clinix-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="clinix-label text-botanical">Current workspace</p>
                <p className="mt-2 font-sans text-xl font-semibold text-ink">
                  {state.me.role.replace(/_/g, " ")}
                </p>
                <p className="mt-1 font-mono text-xs text-graphite">{state.me.profile_id}</p>
              </div>
              <span className="rounded-full border border-sage px-3 py-1 font-sans text-[10px] font-bold uppercase text-botanical">
                Active
              </span>
            </div>
            {state.me.role === "DOCTOR" && state.me.verification_status && (
              <div className="mt-4 rounded-2xl bg-review/10 p-3">
                <p className="font-sans text-xs text-review">
                  Verification: <span className="font-bold">{state.me.verification_status}</span>
                </p>
              </div>
            )}
            <Link
              href={workspacePath(state.me.role)}
              className="mt-5 block min-h-12 rounded-[1.125rem] bg-botanical px-4 py-3 text-center font-sans text-sm font-semibold text-surface"
            >
              Open current workspace
            </Link>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="clinix-label text-graphite">Account options</h2>
              <span className="rounded-full border border-hairline px-2 py-1 font-sans text-[9px] font-bold uppercase text-graphite">Unavailable</span>
            </div>
            <div className="overflow-hidden rounded-3xl border border-sage bg-surface">
              {unavailableSettings.map(([label, copy], index) => (
                <div
                  key={label}
                  aria-disabled="true"
                  className={`flex min-h-20 items-center justify-between gap-4 px-5 py-4 opacity-60 ${index ? "border-t border-hairline" : ""}`}
                >
                  <div>
                    <p className="font-sans text-sm font-semibold text-ink">{label}</p>
                    <p className="mt-1 font-sans text-xs leading-5 text-graphite">{copy}</p>
                  </div>
                  <span aria-hidden="true" className="font-sans text-xl text-sage">›</span>
                </div>
              ))}
            </div>
          </section>

          <p className="font-sans text-xs leading-5 text-graphite">
            One account holds one workspace for now. Disabled rows do not save or submit data.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
