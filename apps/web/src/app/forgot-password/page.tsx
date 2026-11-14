"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

/** Requests a password recovery email without revealing whether an account exists. */
export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Requests recovery without revealing whether the email belongs to an account. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch {
      setError("We could not send a recovery link. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow="Account recovery" title="Reset your password" orientation="Enter your email and we’ll send a secure reset link if an account matches.">
      {sent ? (
        <p role="status" className="rounded-2xl border border-sage bg-surface p-5 font-sans text-sm leading-6 text-ink">If an account matches that email, a recovery link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div><label htmlFor="email" className="font-sans text-sm font-medium text-ink">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="clinix-field mt-2 font-sans text-sm" /></div>
          <FormError message={error} />
          <button type="submit" disabled={busy} className="min-h-[57px] w-full rounded-[18px] bg-botanical font-sans text-sm font-bold uppercase text-surface disabled:opacity-60">{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <Link href="/sign-in" className="mt-3 flex min-h-11 items-center justify-center font-sans text-xs font-semibold uppercase text-clear-info">Back to sign in</Link>
    </AuthShell>
  );
}
