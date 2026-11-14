"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

/** Updates a password only after the recovery callback establishes a session. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { status, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Saves a new password using only a valid recovery session. */
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
      await updatePassword(password);
      router.replace("/after-sign-in");
    } catch {
      setError("We could not update your password. Request a new recovery link and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow="Account recovery" title="Choose a new password" orientation="Use a new password to secure your account.">
      {status === "recovery" ? (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="password" className="font-sans text-sm font-medium text-ink">New password</label>
            <div className="relative mt-2">
              <input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="clinix-field font-sans text-sm pr-16" />
              <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 font-sans text-xs font-bold uppercase text-clear-info">{showPassword ? "Hide" : "Show"}</button>
            </div>
          </div>
          <div><label htmlFor="confirm-password" className="font-sans text-sm font-medium text-ink">Confirm password</label><input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="clinix-field mt-2 font-sans text-sm" /></div>
          <FormError message={error} />
          <button type="submit" disabled={busy} className="min-h-[57px] w-full rounded-[18px] bg-botanical font-sans text-sm font-bold uppercase text-surface disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button>
        </form>
      ) : status === "loading" ? (
        <div role="status" className="h-12 animate-pulse rounded-xl bg-hairline" />
      ) : (
        <div className="space-y-4"><p role="alert" className="font-sans text-sm leading-6 text-critical">This recovery link is invalid or expired. Request a new one to continue.</p><a href="/forgot-password" className="flex min-h-11 items-center justify-center font-sans text-xs font-semibold uppercase text-clear-info">Request another link</a></div>
      )}
    </AuthShell>
  );
}
