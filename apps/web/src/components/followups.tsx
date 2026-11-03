"use client";

import Link from "next/link";
import { useState } from "react";
import { useApiData } from "@/lib/api";
import { clinicDate, useApiWrite, type FollowupView } from "@/lib/staff";

const card = "rounded-[18px] border border-copper bg-graphite p-4";
const label = "text-[9px] uppercase text-copper";

/** Whether a follow-up is past due today (IST day start). */
function overdue(f: FollowupView): boolean {
  return f.status === "OPEN" && new Date(f.due_at).getTime() < new Date().setHours(0, 0, 0, 0);
}

/** Page 21 — follow-up worklist, shared by doctors and staff with identical sections. */
export function FollowupWorklist({ base, practiceId }: { base: string; practiceId?: string | null }) {
  const qs = practiceId ? `&practice_id=${practiceId}` : "";
  const [status, setStatus] = useState<"OPEN" | "COMPLETED">("OPEN");
  const list = useApiData<FollowupView[]>(`/followups?status=${status}${qs}`);
  const rows = list.status === "ready" ? list.data : [];
  const late = rows.filter(overdue);
  const upcoming = rows.filter((r) => !overdue(r));

  /** Renders one row linking to the task detail. */
  const row = (f: FollowupView) => (
    <li key={f.id}>
      <Link href={`${base}/${f.id}${practiceId ? `?practice_id=${practiceId}` : ""}`} className={`${card} block`}>
        <p className="text-sm font-semibold">{f.patient_name || "Patient"} · {f.contact_status.toLowerCase()}</p>
        <p className="text-xs text-surface/75">{f.reason}</p>
        <p className="text-[10px] text-copper">Due {clinicDate(f.due_at)}</p>
      </Link>
    </li>
  );

  return (
    <>
      <div>
        <p className={label}>Follow-ups</p>
        <h1 className="mt-2 text-[28px] leading-tight">Follow-up worklist</h1>
        <p className="mt-1 text-xs text-surface/75">A follow-up is a task, not a booked visit. Completing one does not mean the visit was attended.</p>
      </div>
      <div className="flex gap-2" role="group" aria-label="Follow-up filter">
        {(["OPEN", "COMPLETED"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`min-h-11 rounded-full border px-3 text-[10px] ${status === s ? "border-copper bg-copper text-ink" : "border-copper/60"}`}>{s === "OPEN" ? "Open" : "Completed"}</button>
        ))}
      </div>
      {list.status === "loading" && <p role="status" className="text-sm">Loading follow-ups…</p>}
      {list.status === "error" && <div role="alert" className={card}><p className="text-sm">Could not load follow-ups</p><button type="button" onClick={() => void list.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Try again</button></div>}
      {list.status === "ready" && rows.length === 0 && <div className={card}><p className="text-sm font-semibold">No follow-ups {status === "OPEN" ? "due" : "completed"}</p><p className="mt-1 text-xs text-surface/75">Follow-ups appear here when a doctor sets one on a consultation.</p></div>}
      {late.length > 0 && <section><p className="text-[9px] uppercase text-critical">Overdue</p><ul className="mt-2 space-y-2">{late.map(row)}</ul></section>}
      {upcoming.length > 0 && <section><p className={label}>{status === "OPEN" ? "Upcoming" : "Completed"}</p><ul className="mt-2 space-y-2">{upcoming.map(row)}</ul></section>}
    </>
  );
}

/** Page 21a — task detail. Staff may assign, record contact and complete; only doctors write the outcome. */
export function FollowupDetail({ id, practiceId, isDoctor }: { id: string; practiceId?: string | null; isDoctor: boolean }) {
  const qs = practiceId ? `?practice_id=${practiceId}` : "";
  const detail = useApiData<FollowupView>(`/followups/${id}${qs}`);
  const write = useApiWrite();
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = detail.status === "ready" ? detail.data : null;

  /** Runs a write and refreshes the task; failures stay visible. */
  async function run(path: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await write(`${path}${qs}`, method, body);
      await detail.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {detail.status === "loading" && <p role="status" className="text-sm">Loading task…</p>}
      {detail.status === "error" && <div role="alert" className={card}><p className="text-sm">{detail.error}</p></div>}
      {f && (
        <>
          <div>
            <p className={label}>Follow-up task · {f.status.toLowerCase()}</p>
            <h1 className="mt-2 text-[28px] leading-tight">{f.patient_name || "Patient"}</h1>
            <p className="mt-1 text-xs text-surface/75">{f.reason}</p>
            <p className="text-[10px] text-copper">Due {clinicDate(f.due_at)}</p>
          </div>
          <section className={card}>
            <p className={label}>Contact status</p>
            <div className="mt-2 flex gap-2">
              {(["UNREACHED", "REACHED"] as const).map((s) => (
                <button key={s} type="button" disabled={busy || f.status !== "OPEN"} aria-pressed={f.contact_status === s} onClick={() => void run(`/followups/${f.id}`, "PATCH", { contact_status: s })} className={`min-h-11 rounded-full border px-4 text-xs ${f.contact_status === s ? "border-copper bg-copper text-ink" : "border-copper/60"}`}>{s === "REACHED" ? "Reached" : "Unreached"}</button>
              ))}
            </div>
          </section>
          <section className={card}>
            <p className={label}>Clinical outcome</p>
            {isDoctor ? (
              <>
                <textarea aria-label="Clinical outcome" value={outcome || f.outcome || ""} onChange={(e) => setOutcome(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-copper/60 bg-ink p-3 text-sm" />
                <button type="button" disabled={busy || !outcome} onClick={() => void run(`/followups/${f.id}`, "PATCH", { outcome })} className="mt-2 min-h-11 rounded-full border border-copper px-4 text-xs">Save outcome</button>
              </>
            ) : (
              <p className="mt-2 text-xs text-surface/75">Locked. Only the doctor records the clinical outcome.</p>
            )}
          </section>
          {f.status === "OPEN" && (
            <button type="button" disabled={busy} onClick={() => void run(`/followups/${f.id}/complete`, "POST", {})} className="min-h-12 w-full rounded-2xl bg-copper px-4 text-sm font-semibold text-ink disabled:opacity-60">Mark task completed</button>
          )}
          {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        </>
      )}
    </>
  );
}
