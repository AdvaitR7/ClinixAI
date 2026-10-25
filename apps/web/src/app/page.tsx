"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth";

/** Routes the static app entry after the browser session has loaded. */
export default function Home() {
  const router = useRouter();
  const { status, error } = useAuth();

  useEffect(() => {
    if (status === "recovery") router.replace("/reset-password");
    else if (status === "signed-in") router.replace("/after-sign-in");
    else if (status === "signed-out") router.replace("/sign-in");
  }, [router, status]);

  if (status === "error") return <AuthShell eyebrow="Secure access" title="Authentication unavailable" orientation={error ?? "Check the browser auth configuration and try again."}><span /></AuthShell>;
  return <AuthShell eyebrow="CliniX" title="Loading your account" orientation="Checking your secure session."><div className="h-12 animate-pulse rounded-xl bg-hairline" aria-hidden="true" /></AuthShell>;
}
