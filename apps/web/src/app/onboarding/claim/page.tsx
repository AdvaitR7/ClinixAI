"use client";

import { useAuth } from "@/lib/auth";
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
      const accessToken = await getToken();
      if (!accessToken) throw new Error("Not signed in");
      await fetchApi<{ patient_id: string }>(accessToken, "/patient-claims", {
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
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="claim-code" className="font-sans text-sm font-medium text-ink">One-time claim code</label>
          <input
            id="claim-code"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter claim code"
            autoComplete="off"
            className="clinix-field mt-2 font-mono text-base tracking-wider"
          />
        </div>
        <p className="rounded-2xl bg-sage/15 p-4 font-sans text-xs leading-5 text-graphite">
          The code links only the clinic record it was issued for. It cannot be reused after a successful claim.
        </p>
        <button
          type="submit"
          disabled={busy || token.trim().length < 8}
          className="min-h-[58px] w-full rounded-[1.25rem] bg-botanical px-4 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
        >
          {busy ? "Linking…" : "Link record"}
        </button>
        <FormError message={error} />
      </form>
    </AuthShell>
  );
}
