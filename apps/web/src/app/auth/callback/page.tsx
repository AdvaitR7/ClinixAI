"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

/** Exchanges one-use Supabase email codes in the browser that started PKCE. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { completeCallback } = useAuth();
  const started = useRef(false);
  const [message, setMessage] = useState("Checking your secure link…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const recovery = url.searchParams.get("next") === "/reset-password";
    const hash = new URLSearchParams(url.hash.slice(1));
    const providerError = url.searchParams.get("error") ?? hash.get("error");
    const errorCode = url.searchParams.get("error_code") ?? hash.get("error_code");

    if (!code) {
      queueMicrotask(() => {
        setFailed(true);
        setMessage(errorCode === "otp_expired"
          ? "This link has expired. Request a new one to continue."
          : providerError === "access_denied"
            ? "This sign-in request was cancelled. You can try again."
            : "This link is invalid or has expired. Request a new one to continue.");
      });
      return;
    }

    void completeCallback(code, recovery).then(() => {
      if (window.location.pathname === "/auth/callback") {
        router.replace(recovery ? "/reset-password" : "/after-sign-in");
      }
    }).catch(() => {
      setFailed(true);
      setMessage("This link has expired or was opened on another device. Request a new link in this browser.");
    });
  }, [completeCallback, router]);

  return (
    <AuthShell eyebrow="Secure access" title="Verifying your email" orientation="We’re checking your one-time confirmation link.">
      <p role="status" className="font-sans text-sm leading-6 text-graphite">{message}</p>
      {failed && <a href="/sign-in" className="mt-5 block text-center font-sans text-xs font-semibold uppercase text-evidence">Return to sign in</a>}
      {failed && <div className="mt-3 flex justify-center gap-4 font-sans text-xs font-semibold uppercase text-evidence"><a href="/sign-up">Resend confirmation</a><a href="/forgot-password">Forgot password</a></div>}
    </AuthShell>
  );
}
