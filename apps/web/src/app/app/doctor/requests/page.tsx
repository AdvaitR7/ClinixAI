"use client";

import { useRef, useState } from "react";
import type { RemovalRequestView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { formatDateTime } from "@/lib/privacy";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { StatusBadge } from "@/components/status-badge";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
];
const card = "rounded-[22px] border border-copper bg-graphite p-4";
const label = "text-[9px] uppercase text-copper";

type Outcome = "APPROVED" | "PARTIALLY_APPROVED" | "DENIED";
const FILTERS = [
  { label: "All", match: () => true },
  { label: "Open", match: (r: RemovalRequestView) => r.status === "OPEN" || r.status === "ROUTED" },
  { label: "Partial", match: (r: RemovalRequestView) => r.status === "PARTIALLY_APPROVED" },
  { label: "Resolved", match: (r: RemovalRequestView) => r.status === "APPROVED" || r.status === "DENIED" },
];
const OPTIONS: { value: Outcome; title: string; text: string }[] = [
  { value: "APPROVED", title: "APPROVE REMOVAL", text: "Remove the requested records from permitted patient-facing or active views where allowed." },
  { value: "PARTIALLY_APPROVED", title: "PARTIAL APPROVAL", text: "Approve part of the request while retaining identified professional records." },
  { value: "DENIED", title: "RETAIN REQUIRED RECORD", text: "Retain the requested record because professional or legal obligations require it." },
];

/** Record removal & retention requests (SCR-049): the addressed doctor reviews and decides. */
export default function RemovalRequestsPage() {
  const requests = useApiData<RemovalRequestView[]>("/doctor/record-removal-requests");
  const [filter, setFilter] = useState(FILTERS[1]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = requests.status === "ready" ? requests.data : [];
  const visible = rows.filter(filter.match);
  const selected = rows.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const open = rows.filter(FILTERS[1].match).length;

  return (
    <WorkspaceShell workspace="Doctor" title="Record removal & retention" nav={nav} focused hideHeading>
      <div>
        <p className={label}>Practice settings · record governance</p>
        <h1 className="mt-4 text-[30px] leading-tight">Record removal & retention</h1>
        <p className="mt-2 text-xs leading-relaxed text-surface/80">Review patient requests against professional and legal retention obligations. Audit history is never silently erased.</p>
      </div>
      <section className={card}>
        <p className={label}>Request center</p>
        <h2 className="mt-2 text-2xl">{open} open {open === 1 ? "request" : "requests"}</h2>
        <p className="mt-1 text-xs text-surface/70">{rows.length - open} decided</p>
      </section>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Request filters">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" aria-pressed={filter.label === f.label} onClick={() => setFilter(f)} className={`min-h-9 rounded-full border px-3 text-[10px] ${filter.label === f.label ? "border-copper bg-copper text-ink" : "border-copper/60"}`}>{f.label}</button>
        ))}
      </div>
      {requests.status === "loading" && <p role="status" className="text-sm">Loading requests…</p>}
      {requests.status === "error" && <div role="alert" className={card}><p className="text-sm">{requests.error}</p><button type="button" onClick={() => void requests.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>}
      {requests.status === "ready" && visible.length === 0 && <p className={`${card} text-sm`}>No requests in this view.</p>}
      {visible.length > 1 && (
        <ul className="space-y-2" aria-label="Requests">
          {visible.map((r) => (
            <li key={r.id}>
              <button type="button" aria-current={selected?.id === r.id} onClick={() => setSelectedId(r.id)} className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border px-3 text-left text-xs ${selected?.id === r.id ? "border-copper" : "border-copper/40"}`}>
                <span>{r.patient_name ?? "Patient"} · {formatDateTime(r.requested_at)}</span><StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <RequestDetail key={selected.id} request={selected} onResolved={() => void requests.refresh()} />}
    </WorkspaceShell>
  );
}

/** One request with its decision form, confirmation step (SCR-050) and audit history. */
function RequestDetail({ request, onResolved }: { request: RemovalRequestView; onResolved: () => void }) {
  const { getToken } = useAuth();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const decided = request.status !== "OPEN" && request.status !== "ROUTED";
  const needsReason = outcome !== null && outcome !== "APPROVED";
  const ready = outcome !== null && (!needsReason || reason.trim().length > 0);

  /** Per-record outcome for a partial decision: patient-facing copy goes, the professional record stays. */
  const decisions = outcome === "PARTIALLY_APPROVED"
    ? [
        { resource_type: request.resource_type, resource_id: request.resource_id, label: "Patient-facing copy", decision: "REMOVE" as const },
        { resource_type: request.resource_type, resource_id: request.resource_id, label: "Professional record", decision: "RETAIN" as const },
      ]
    : undefined;

  /** Records the decision only after the confirmation dialog; failures keep the form. */
  async function confirm() {
    if (!outcome || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, `/doctor/record-removal-requests/${request.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ outcome, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(decisions ? { decisions } : {}) }),
      });
      setConfirming(false);
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be confirmed. Nothing was recorded.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const history = [
    { at: request.requested_at, text: `${request.patient_name ?? "Patient"} submitted request` },
    ...(request.routed_at ? [{ at: request.routed_at, text: request.routing_note ? `Routed to responsible doctor — ${request.routing_note}` : "Routed to responsible doctor" }] : []),
    ...(request.resolved_at ? [{ at: request.resolved_at, text: `Decision recorded: ${request.status.replaceAll("_", " ").toLowerCase()}` }] : []),
  ];
  const chosen = OPTIONS.find((o) => o.value === outcome);

  return (
    <>
      <section className={card}>
        <div className="flex items-start justify-between gap-2"><h2 className="text-xl">{request.patient_name ?? "Patient"}</h2><StatusBadge status={request.status} /></div>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-4"><dt className="text-copper">Record</dt><dd>{request.resource_type.toLowerCase()}{request.resource_id ? " · specific record" : ""}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-copper">Requested</dt><dd>{formatDateTime(request.requested_at)}</dd></div>
        </dl>
        {request.reason && <blockquote className="mt-3 rounded-2xl border border-copper/40 p-3 text-xs">“{request.reason}”</blockquote>}
      </section>
      {decided ? (
        <section className={card}>
          <p className={label}>Decision</p>
          <p className="mt-2 text-sm">{request.status.replaceAll("_", " ")}</p>
          {request.resolution_note && <p className="mt-2 text-xs">{request.resolution_note}</p>}
        </section>
      ) : (
        <section className="space-y-3">
          <h2 className={label}>Doctor decision</h2>
          <div role="radiogroup" aria-label="Decision" className="space-y-2">
            {OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)} className={`w-full rounded-[18px] border p-3 text-left ${outcome === o.value ? "border-copper bg-copper/10" : "border-copper/40"}`}>
                <span className="block text-[10px]">{o.title}</span><span className="mt-1 block text-xs">{o.text}</span>
              </button>
            ))}
          </div>
          <label htmlFor="removal-resolution" className={`${label} block`}>Written reason{needsReason ? " · required" : ""}</label>
          <textarea id="removal-resolution" rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-2xl border border-copper/60 bg-ink p-3 text-sm text-surface" />
          {outcome === "PARTIALLY_APPROVED" && (
            <div className={card}>
              <h3 className="text-base">Partial approval scope</h3>
              <p className="mt-2 text-xs">Patient-facing copy: remove. Professional record: retain.</p>
            </div>
          )}
          <button ref={reviewRef} type="button" disabled={!ready} onClick={() => { setError(null); setConfirming(true); }} className="min-h-12 w-full rounded-[18px] bg-copper px-3 text-xs text-ink disabled:opacity-50">REVIEW & CONFIRM DECISION</button>
          <p className="text-[10px] text-surface/70">No request is resolved until the decision is explicitly confirmed.</p>
        </section>
      )}
      <section className="space-y-2">
        <h2 className={label}>Request audit history</h2>
        {history.map((h, i) => <p key={i} className="rounded-2xl border border-copper/40 p-3 text-xs"><span className="text-copper">{formatDateTime(h.at)}</span> · {h.text}</p>)}
      </section>
      {confirming && chosen && (
        <ClinicalReviewDialog titleId="removal-confirm-title" busy={busy} returnFocusRef={reviewRef} onClose={() => { if (!busy) setConfirming(false); }}>
          <h2 id="removal-confirm-title" className="text-xl">{outcome === "APPROVED" ? "Confirm removal?" : outcome === "PARTIALLY_APPROVED" ? "Confirm partial approval?" : "Confirm retention?"}</h2>
          <p className="mt-3 text-sm">The patient will see this outcome{reason.trim() ? " and your written reason" : ""}. Required audit and retention history remains.</p>
          <p className="mt-3 text-sm">{chosen.title}: {request.patient_name ?? "Patient"} · {request.resource_type.toLowerCase()}</p>
          {reason.trim() && <p className="mt-3 rounded-xl border border-copper/40 p-3 text-xs">{reason.trim()}</p>}
          <p className="mt-3 text-xs">Recorded: decision maker, timestamp, per-record action and written reason. Confirming resolves this request; later changes create a new audit event.</p>
          {error && <p role="alert" className="mt-3 text-sm text-copper">{error}</p>}
          <button type="button" onClick={() => void confirm()} disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-copper px-3 text-sm text-ink disabled:opacity-50">{busy ? "RECORDING…" : "CONFIRM DECISION"}</button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-copper text-sm disabled:opacity-50">RETURN TO REQUEST</button>
        </ClinicalReviewDialog>
      )}
    </>
  );
}
