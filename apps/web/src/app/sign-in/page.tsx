"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

const inputClass = "clinix-field mt-2 font-sans text-sm";

/** Signs in with email and password while preserving the existing auth shell. */
export default function SignInPage() {
  const router = useRouter();
  const { signIn, status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (status === "signed-in") router.replace("/after-sign-in");
    else if (status === "recovery") router.replace("/reset-password");
  }, [router, status]);

  /** Validates the form, signs in, and routes through database role resolution. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/after-sign-in");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "email_not_confirmed"
        ? "Confirm your email before signing in. You can resend the confirmation from sign up."
        : "We could not sign you in. Check your email and password, then try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "signed-in" || status === "recovery") {
    return <AuthShell eyebrow="Secure access" title="Loading your account" orientation="Checking your secure session."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
  }

  return (
    <AuthShell eyebrow="Secure access" title="Sign in" orientation="Give your credentials to sign in to your account.">
      <div className="mb-6 flex rounded-2xl border border-sage bg-canvas p-1" role="tablist" aria-label="Authentication modes">
        <span role="tab" aria-selected="true" className="flex-1 rounded-xl bg-botanical py-2.5 text-center font-sans text-xs font-bold uppercase tracking-wider text-surface shadow-sm">Sign in</span>
        <Link href="/sign-up" role="tab" aria-selected="false" className="flex-1 rounded-xl py-2.5 text-center font-sans text-xs font-semibold uppercase tracking-wider text-graphite hover:text-ink">Sign up</Link>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="email" className="font-sans text-sm font-medium text-ink">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="password" className="font-sans text-sm font-medium text-ink">Password</label>
          <div className="relative mt-2">
            <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="clinix-field font-sans text-sm pr-16" />
            <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-1 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center px-2 font-sans text-xs font-bold uppercase text-clear-info">{showPassword ? "Hide" : "Show"}</button>
          </div>
          <Link href="/forgot-password" className="mt-1 flex min-h-11 items-center justify-end font-sans text-xs font-semibold uppercase text-clear-info">Forgot password?</Link>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="min-h-[57px] w-full rounded-[18px] bg-botanical font-sans text-sm font-bold uppercase text-surface shadow-[0_5px_14px_rgba(18,53,44,0.14)] hover:bg-botanical disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="mt-5 grid grid-cols-3 gap-4" aria-label="Unavailable sign-in providers">
        {[["f", "Facebook"], ["G", "Google"], ["●", "Apple"]].map(([mark, label]) => (
          <button key={label} type="button" disabled title={`${label} sign in is unavailable`} className="min-h-[52px] rounded-[15px] border border-sage bg-surface font-sans text-lg font-bold text-graphite opacity-45">
            <span aria-hidden="true">{mark}</span><span className="sr-only">{label} sign in unavailable</span>
          </button>
        ))}
      </div>
    </AuthShell>
  );
}
