"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useApiData } from "@/lib/api";
import { StaffShell } from "@/components/staff-shell";
import { StatusBadge } from "@/components/status-badge";
import { clinicDate, clinicTime, useApiWrite } from "@/lib/staff";

const card = "rounded-[18px] border border-copper bg-graphite p-4";
const label = "text-[9px] uppercase text-copper";
const STATUSES = ["UNPAID", "REQUESTED", "PAID", "WAIVED"] as const;

type Receipt = {
  patient_name: string;
  scheduled_start: string;
  payment_status: string;
  fee_inr: number | null;
  events: { old_status: string | null; new_status: string; by: string; note: string | null; at: string }[];
};

/** Page 23e — operational payment receipt with manual status update (FigCraft frame 5929). */
export default function ReceiptPage() {
  return <Suspense fallback={null}><ReceiptContent /></Suspense>;
}

function ReceiptContent() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const practiceId = useSearchParams().get("practice_id");
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const receipt = useApiData<Receipt>(`/staff/appointments/${appointmentId}/receipt${qs}`);
  const write = useApiWrite();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = receipt.status === "ready" ? receipt.data : null;

  /** Records the new manual payment status and reloads the receipt. */
  async function update(status: (typeof STATUSES)[number]) {
    setBusy(true);
    setError(null);
    try {
      await write(`/staff/appointments/${appointmentId}/payment-status${qs}`, "POST", { payment_status: status, ...(note.trim() ? { reference_note: note.trim() } : {}) });
      setNote("");
      await receipt.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell role={null} active="schedule" title="Payment receipt">
      <Link href="/app/staff" className="min-h-11 text-xs text-evidence">← Back to dashboard</Link>
      <div>
        <p className={label}>Clinic operations · payment receipt</p>
        <h1 className="mt-2 text-[28px] leading-tight">Payment receipt</h1>
      </div>
      {receipt.status === "loading" && <p role="status" className="text-sm">Loading receipt…</p>}
      {receipt.status === "error" && <div role="alert" className={card}><p className="text-sm">{receipt.error}</p></div>}
      {r && (
        <>
          <section className={card}>
            <div className="flex justify-between gap-2">
              <p className="text-sm font-semibold">{r.patient_name || "Patient"} · {clinicTime(r.scheduled_start)}</p>
              <StatusBadge status={r.payment_status} />
            </div>
            <p className="mt-1 text-xs text-surface/75">{r.fee_inr !== null ? `Fee ₹${r.fee_inr}` : "Fee not published"} · Recorded manually by clinic staff</p>
          </section>
          <section className={card} aria-labelledby="upd">
            <p id="upd" className={label}>Update payment status</p>
            <input aria-label="Reference note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Reference note (optional)" className="mt-2 min-h-11 w-full rounded-xl border border-copper/60 bg-ink px-3 text-sm" />
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s} type="button" disabled={busy || s === r.payment_status} onClick={() => void update(s)} className="min-h-11 rounded-full border border-copper px-4 text-xs disabled:opacity-50">{s.charAt(0) + s.slice(1).toLowerCase()}</button>
              ))}
            </div>
          </section>
          {r.events.length > 0 && (
            <section aria-labelledby="hist">
              <h2 id="hist" className={label}>History</h2>
              <ul className="mt-2 space-y-2">
                {r.events.map((e, i) => (
                  <li key={i} className={card}>
                    <p className="text-xs">{(e.old_status ?? "—").toLowerCase()} → {e.new_status.toLowerCase()} · {e.by}</p>
                    <p className="text-[10px] text-copper">{clinicDate(e.at)} {clinicTime(e.at)}{e.note ? ` · ${e.note}` : ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-[18px] border border-copper bg-surface p-4 text-ink">
            <p className="text-xs">Operational record only. No clinical details, diagnosis or prescription content is shown.</p>
          </section>
        </>
      )}
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
    </StaffShell>
  );
}
