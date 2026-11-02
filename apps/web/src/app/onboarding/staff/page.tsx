"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";
import { useApiData } from "@/lib/api";
import { useApiWrite } from "@/lib/staff";

const permissions = [
  ["Schedule & appointments", "View, book, reschedule, arrival and payment status"],
  ["Patient operations", "Demographics, claim invitation and contact tasks"],
  ["Follow-up coordination", "Scheduling and contact status for assigned tasks"],
] as const;

type Preview = { practice_name: string; role: "RECEPTION" | "ASSISTANT"; state: "OPEN" | "EXPIRED" | "REVOKED" | "USED"; expires_at: string | null };

const UNAVAILABLE = {
  EXPIRED: ["Expired", "This invitation has expired", "Ask the practice owner to resend it. Your account and any existing access are unchanged."],
  REVOKED: ["Revoked", "This invitation was withdrawn", "The practice cancelled this invitation. No staff access was granted."],
  USED: ["Used", "This invitation was already used", "Open your workspace to continue."],
} as const;

/** Page 2c — reviews a practice invitation and accepts or declines the specific membership. */
export default function StaffOnboardingPage() {
  return <Suspense fallback={null}><StaffInvitation /></Suspense>;
}

function StaffInvitation() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const { status } = useAuth();
  const write = useApiWrite();
  const preview = useApiData<Preview>(token && status === "signed-in" ? `/practice-invitations/${token}` : null);
  const [agreed, setAgreed] = useState(false);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Accepts or declines; accepting opens the staff workspace. */
  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      await write(`/practice-invitations/${token}/${action}`, "POST", action === "accept" ? { contact: contact.trim() } : {});
      router.replace(action === "accept" ? "/app/staff" : "/onboarding/role");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete this step.");
      setBusy(false);
    }
  }

  const data = preview.status === "ready" ? preview.data : null;
  const unavailable = data && data.state !== "OPEN" ? UNAVAILABLE[data.state] : null;

  return (
    <AuthShell
      eyebrow="Clinic staff onboarding · invite only"
      title="Review your invitation"
      orientation="Verify your account, review the practice and role, then accept the membership."
      tone="doctor"
    >
      <section className="clinix-doctor-card border-copper p-4">
        <p className="clinix-label text-copper">Role assignment</p>
        <p className="mt-2 font-sans text-sm font-semibold text-surface">Clinic Staff cannot be selected at public sign-up.</p>
        <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/75">Access begins only from a practice invitation you accept. Existing patient or doctor access is not replaced.</p>
      </section>

      {!token && <p role="status" className="mt-8 font-sans text-sm text-surface">No invitation link was provided. Open the link sent by your practice.</p>}
      {token && status !== "signed-in" && (
        <Link href="/sign-in" className="mt-8 block min-h-12 rounded-[1.25rem] bg-copper px-4 py-4 text-center font-sans text-sm font-semibold uppercase text-ink">Sign in to review invitation</Link>
      )}
      {preview.status === "error" && <p role="alert" className="mt-8 font-sans text-sm text-surface">No membership found for this link. {preview.error}</p>}

      {data && (
        <section className="mt-8">
          <p className="clinix-label text-copper">Invitation review</p>
          <div className="mt-3 rounded-[1.75rem] border-[5px] border-copper bg-graphite p-4">
            <p className="clinix-label text-copper">Practice membership</p>
            <p className="mt-3 font-sans text-xl font-semibold text-surface">{data.practice_name}</p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="clinix-label text-copper">Role</p>
              <span className="mt-2 inline-flex rounded-full bg-copper px-4 py-2 font-sans text-[10px] font-bold uppercase text-ink">{data.role === "ASSISTANT" ? "Clinical assistant" : "Receptionist"}</span>
            </div>
          </div>
        </section>
      )}

      {unavailable && (
        <section role="status" className="clinix-doctor-card mt-8 border-copper p-4">
          <p className="clinix-label text-copper">{unavailable[0]}</p>
          <p className="mt-2 font-sans text-sm font-semibold text-surface">{unavailable[1]}</p>
          <p className="mt-1 font-sans text-xs text-doctor-muted/75">{unavailable[2]}</p>
        </section>
      )}

      {data?.state === "OPEN" && (
        <>
          <section className="mt-8">
            <p className="clinix-label text-copper">Permission summary</p>
            <div className="clinix-doctor-card mt-3 space-y-2 border-copper p-4">
              <h2 className="font-sans text-lg font-semibold text-surface">What membership allows</h2>
              {permissions.map(([title, copy]) => (
                <div key={title} className="rounded-2xl border border-evidence p-3">
                  <p className="font-sans text-sm font-semibold text-surface">{title}</p>
                  <p className="mt-1 font-sans text-[11px] text-doctor-muted/70">{copy}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-copper p-3">
                <p className="font-sans text-sm font-semibold text-surface">Clinical authority</p>
                <p className="mt-1 font-sans text-[11px] text-doctor-muted/70">No diagnosis, prescribing, AI analysis, or unrestricted history.</p>
              </div>
            </div>
          </section>
          <label className="mt-6 block font-sans text-xs text-surface">
            Email or mobile this invitation was sent to
            <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" className="mt-2 min-h-11 w-full rounded-xl border border-copper bg-ink px-3 text-sm" />
          </label>
          <label className="mt-4 flex min-h-11 items-start gap-3 font-sans text-xs text-surface">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5" />
            I understand this membership is limited to operational access.
          </label>
          {error && <p role="alert" className="mt-3 font-sans text-xs text-critical">{error}</p>}
          <button type="button" disabled={!agreed || busy || contact.trim().length < 3} onClick={() => void respond("accept")} className="mt-6 min-h-[58px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink disabled:cursor-not-allowed disabled:opacity-55">
            Accept practice membership
          </button>
          <button type="button" disabled={busy} onClick={() => void respond("decline")} className="mt-3 min-h-11 w-full font-sans text-sm font-medium text-evidence">Decline invitation</button>
        </>
      )}
      <Link href="/onboarding/role" className="mt-5 block min-h-11 text-center font-sans text-sm font-medium text-evidence">Back to role select</Link>
    </AuthShell>
  );
}
