import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

/**
 * Page 2c — Clinic Staff Invitation stub (SCREEN_CATALOG §7). Real practice
 * membership tables + invitation flow are Phase 7; this renders the
 * role-badged accept shape without granting access.
 */
export default function StaffOnboardingPage() {
  return (
    <AuthShell
      eyebrow="Clinic staff invitation"
      title="Accept your practice invitation"
      orientation="Staff access is invitation-only. Invitations are managed by your practice in a later phase."
    >
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Invitation
        </p>
        <p className="mt-1 font-sans text-base font-semibold">[practice name]</p>
        <div className="mt-3 flex gap-2">
          <span className="rounded-full border border-hairline px-3 py-1 font-sans text-xs font-semibold">
            Receptionist
          </span>
          <span className="rounded-full border border-hairline px-3 py-1 font-sans text-xs font-semibold">
            Clinical Assistant / Nurse
          </span>
        </div>
        <p className="mt-3 font-sans text-sm text-graphite">
          The offered role, permitted and prohibited actions, and accept or
          decline controls appear here once practice invitations are live.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 h-11 w-full cursor-not-allowed rounded-full bg-botanical px-4 font-sans text-base font-semibold text-surface opacity-50"
        >
          Accept invitation (coming soon)
        </button>
      </section>
      <Link href="/onboarding/role" className="mt-4 inline-block font-sans text-sm font-medium text-botanical">
        Back to role select
      </Link>
    </AuthShell>
  );
}
