import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

const permissions = [
  ["Schedule & appointments", "View, book, reschedule, arrival and payment status"],
  ["Patient operations", "Demographics, claim invitation and contact tasks"],
  ["Follow-up coordination", "Scheduling and contact status for assigned tasks"],
] as const;

/** Page 2c — invitation preview only; membership persistence is not implemented. */
export default function StaffOnboardingPage() {
  return (
    <AuthShell
      eyebrow="Clinic staff onboarding · invite only"
      title="Review your invitation"
      orientation="Verify your account, review the practice and role, then accept membership when practice invitations are available."
      tone="doctor"
    >
      <section className="clinix-doctor-card border-copper p-4">
        <p className="clinix-label text-copper">Role assignment</p>
        <p className="mt-2 font-sans text-sm font-semibold text-surface">
          Clinic Staff cannot be selected at public sign-up.
        </p>
        <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/75">
          Access begins only from a verified practice invitation.
        </p>
      </section>

      <section className="mt-8">
        <p className="clinix-label text-copper">Invitation review</p>
        <div className="mt-3 rounded-[1.75rem] border-[5px] border-copper bg-graphite p-4">
          <p className="clinix-label text-copper">Practice membership</p>
          <p className="mt-3 font-sans text-xl font-semibold text-surface">Practice unavailable</p>
          <p className="mt-1 font-sans text-xs text-doctor-muted/75">
            No invitation API or practice membership has been configured yet.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="clinix-label text-copper">Role</p>
            <span className="mt-2 inline-flex rounded-full bg-copper px-4 py-2 font-sans text-[10px] font-bold uppercase text-ink">
              Preview only
            </span>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <p className="clinix-label text-copper">Permission summary</p>
        <div className="clinix-doctor-card mt-3 space-y-2 border-copper p-4">
          <h2 className="font-sans text-lg font-semibold text-surface">What membership will allow</h2>
          {permissions.map(([title, copy]) => (
            <div key={title} className="rounded-2xl border border-evidence p-3">
              <p className="font-sans text-sm font-semibold text-surface">{title}</p>
              <p className="mt-1 font-sans text-[11px] text-doctor-muted/70">{copy}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-copper p-3">
            <p className="font-sans text-sm font-semibold text-surface">Clinical authority</p>
            <p className="mt-1 font-sans text-[11px] text-doctor-muted/70">
              No diagnosis, prescribing, AI analysis, or unrestricted history.
            </p>
          </div>
        </div>
      </section>

      <button
        type="button"
        disabled
        className="mt-8 min-h-[58px] w-full cursor-not-allowed rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink opacity-55"
      >
        Accept practice membership — unavailable
      </button>
      <Link href="/onboarding/role" className="mt-5 block min-h-11 text-center font-sans text-sm font-medium text-evidence">
        Back to role select
      </Link>
    </AuthShell>
  );
}
