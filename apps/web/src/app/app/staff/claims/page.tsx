"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApiData } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { clinicDate, useApiWrite } from "@/lib/staff";

const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";

type Claim = { patient_id: string; patient_name: string; invited_at: string | null; state: "NONE" | "OPEN" | "EXPIRED" | "USED" };

/** Page 23f — unclaimed patients and claim-invitation resend (FigCraft frame 5937). */
export default function ClaimsPage() {
  return <Suspense fallback={null}><ClaimsContent /></Suspense>;
}

function ClaimsContent() {
  const practiceId = useSearchParams().get("practice_id");
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const claims = useApiData<Claim[]>(`/staff/claim-invitations${qs}`);
  const write = useApiWrite();
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Issues a new claim invitation; the one-time link is shown to staff to pass on. */
  async function resend(patientId: string) {
    setError(null);
    try {
      const r = await write<{ invite_token: string }>(`/staff/patients/${patientId}/claim-invites${qs}`, "POST");
      setLink({ id: patientId, url: r.invite_token });
      await claims.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the invitation.");
    }
  }

  const rows = claims.status === "ready" ? claims.data : [];
  return (
    <StaffShell role={null} active="home" title="Claim invitations">
      <Link href="/app/staff" className="min-h-11 text-xs text-clear-info">← Back to dashboard</Link>
      <div>
        <p className={label}>Clinic operations · claim invitations</p>
        <h1 className="mt-2 text-[28px] leading-tight">{rows.length} awaiting claim</h1>
      </div>
      {claims.status === "loading" && <p role="status" className="text-sm">Loading…</p>}
      {claims.status === "error" && <div role="alert" className={card}><p className="text-sm">{claims.error}</p></div>}
      {claims.status === "ready" && rows.length === 0 && <p className={`${card} text-sm`}>No unclaimed patients.</p>}
      <ul className="space-y-3">
        {rows.map((c) => (
          <li key={c.patient_id} className={card}>
            <p className="text-sm font-semibold">{c.patient_name || "Patient"} · {c.state === "NONE" ? "NOT INVITED" : c.state}{c.invited_at ? ` · ${clinicDate(c.invited_at)}` : ""}</p>
            <p className="mt-1 text-xs text-clear-secondary">Contact status and resend only. Staff cannot view or claim the patient&apos;s record.</p>
            <button type="button" onClick={() => void resend(c.patient_id)} className="mt-2 min-h-11 text-xs font-semibold text-clear-action">{c.state === "NONE" ? "Send invitation →" : "Resend invitation →"}</button>
            {link?.id === c.patient_id && <p role="status" className="mt-2 break-all text-xs text-clear-action">Claim code (shown once): {link.url}</p>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
    </StaffShell>
  );
}
