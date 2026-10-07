"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, FormError } from "@/components/auth-shell";
import { fetchApi } from "@/lib/api";

/** Claim a clinic-created record with a one-time code (API §6). */
export default function ClaimPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clerkToken = await getToken();
      if (!clerkToken) throw new Error("Not signed in");
      await fetchApi<{ patient_id: string }>(clerkToken, "/patient-claims", {
        method: "POST",
        body: JSON.stringify({ invite_token: token.trim() }),
      });
      router.replace("/app/patient");
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === "INVITE_USED"
          ? "This code has already been used."
          : code === "INVITE_EXPIRED"
            ? "This code has expired. Ask your clinic for a new one."
            : code === "ACCOUNT_ALREADY_LINKED"
              ? "This account is already linked to a patient record."
              : code === "INVALID_TOKEN"
                ? "Unknown claim code. Check and try again."
                : err instanceof Error
                  ? err.message
                  : "Could not claim the record.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Claim record"
      title="Link your clinic record"
      orientation="Enter the one-time code your clinic gave you to bring an existing record into your vault."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Claim code"
          autoComplete="off"
          className="h-12 w-full rounded-xl border border-hairline bg-surface px-3 font-mono text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
        />
        <button
          type="submit"
          disabled={busy || token.trim().length < 8}
          className="w-full rounded-full bg-botanical px-4 py-3 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
        >
          {busy ? "Linking…" : "Link record"}
        </button>
        <FormError message={error} />
      </form>
    </AuthShell>
  );
}
