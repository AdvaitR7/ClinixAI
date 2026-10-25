"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

const inputClass = "clinix-field mt-2 font-sans text-sm";

/** Creates an email/password account and starts confirmation when enabled. */
export default function SignUpPage() {
  const router = useRouter();
  const { signUp, resendConfirmation, status } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signed-in") router.replace("/after-sign-in");
    else if (status === "recovery") router.replace("/reset-password");
  }, [router, status]);

  /** Validates registration details before creating the Supabase account. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const hasSession = await signUp(email.trim(), password, displayName.trim());
      if (hasSession) router.replace("/onboarding/role");
      else setConfirmationSent(true);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "weak_password"
        ? "Choose a stronger password and try again."
        : "We could not create your account. Check your details or try signing in.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "signed-in" || status === "recovery") {
    return <AuthShell eyebrow="Secure account" title="Loading your account" orientation="Checking your secure session."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
  }

  return (
    <AuthShell eyebrow="Secure account" title="Sign up" orientation="Create your account, then choose the patient or doctor workspace to set up.">
      <div className="mb-6 flex rounded-2xl border border-sage bg-canvas p-1" role="tablist" aria-label="Authentication modes">
        <Link href="/sign-in" role="tab" aria-selected="false" className="flex-1 rounded-xl py-2.5 text-center font-sans text-xs font-semibold uppercase tracking-wider text-graphite hover:text-ink">Sign in</Link>
        <span role="tab" aria-selected="true" className="flex-1 rounded-xl bg-botanical py-2.5 text-center font-sans text-xs font-bold uppercase tracking-wider text-surface shadow-sm">Sign up</span>
      </div>
      {confirmationSent ? (
        <div className="rounded-2xl border border-sage bg-surface p-5 font-sans text-sm leading-6 text-ink">
          <p role="status">Check your email for a confirmation link. Open it in this browser to finish creating your account.</p>
          <button type="button" disabled={busy} onClick={async () => {
            setError(null);
            setBusy(true);
            try { await resendConfirmation(email.trim()); }
            catch { setError("We could not resend the confirmation email. Try again shortly."); }
            finally { setBusy(false); }
          }} className="mt-4 font-sans text-xs font-bold uppercase text-evidence">Resend confirmation</button>
          <FormError message={error} />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="display-name" className="font-sans text-sm font-medium text-ink">Name</label>
            <input id="display-name" type="text" autoComplete="name" maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="email" className="font-sans text-sm font-medium text-ink">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="font-sans text-sm font-medium text-ink">Password</label>
            <div className="relative mt-2">
              <input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="clinix-field font-sans text-sm pr-16" />
              <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 font-sans text-[10px] font-bold uppercase text-evidence">{showPassword ? "Hide" : "Show"}</button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="font-sans text-sm font-medium text-ink">Confirm password</label>
            <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={inputClass} />
          </div>
          <FormError message={error} />
          <button type="submit" disabled={busy} className="min-h-[57px] w-full rounded-[18px] bg-botanical font-sans text-sm font-bold uppercase text-surface shadow-[0_5px_14px_rgba(18,53,44,0.14)] disabled:opacity-60">{busy ? "Creating account…" : "Create account"}</button>
        </form>
      )}
      <p className="mt-6 text-center font-sans text-xs leading-5 text-graphite">CliniX is for adults aged 18 and over and is not for emergency care.</p>
      <div className="mt-5 grid grid-cols-3 gap-4" aria-label="Unavailable sign-up providers">
        {[["f", "Facebook"], ["G", "Google"], ["A", "Apple"]].map(([mark, label]) => (
          <button key={label} type="button" disabled title={`${label} sign up is unavailable`} className="min-h-[52px] rounded-[15px] border border-sage bg-surface font-sans text-lg font-bold text-graphite opacity-45">
            <span aria-hidden="true">{mark}</span><span className="sr-only">{label} sign up unavailable</span>
          </button>
        ))}
      </div>
    </AuthShell>
  );
}
