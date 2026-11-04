"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AccessLedger, ConsentView, LedgerCategory, RelationshipView, RemovalRequestView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";
import { careNav, expiryText, formatDateTime, privacyCard, privacyLabel, scopeSummary } from "@/lib/privacy";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PatientVisitHeader } from "@/components/patient-visit-header";
import { VaultDialog } from "@/components/vault-dialog";
import { StatusBadge } from "@/components/status-badge";

const FILTERS: { label: string; value: LedgerCategory | null; count: keyof AccessLedger["counts"] }[] = [
  { label: "All", value: null, count: "all" },
  { label: "Clinical", value: "CLINICAL", count: "clinical" },
  { label: "Admin", value: "ADMIN", count: "admin" },
  { label: "AI audit", value: "AI", count: "ai" },
];
const RECORD_TYPES = [
  { value: "DOCUMENT", label: "Uploaded document or report" },
  { value: "ENCOUNTER", label: "Consultation or check-in" },
  { value: "PRESCRIPTION", label: "Prescription" },
];

/** Privacy & access ledger (SCR-021); suspense boundary for the post-share notice. */
export default function PrivacyPage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading privacy…</p>}><Privacy /></Suspense>;
}

/** Shows who may see what, the append-only access history, and removal-request tracking. */
function Privacy() {
  const query = useSearchParams();
  const consents = useApiData<ConsentView[]>("/patients/self/consents");
  const [ledgerKey, setLedgerKey] = useState(0);
  const [counts, setCounts] = useState<AccessLedger["counts"] | null>(null);

  return (
    <WorkspaceShell workspace="Patient" title="Privacy & access" nav={careNav()} focused flowNavigation hideHeading
      headerContent={<PatientVisitHeader backHref="/app/patient/care" action={<span />} />}>
      <div>
        <p className={privacyLabel}>Patient record · privacy control</p>
        <h1 className="mt-4 text-[30px] leading-tight">Privacy & access</h1>
        <p className="mt-2 text-xs leading-relaxed text-graphite">Control what is shared, why, and for how long. Every access stays visible in the ledger.</p>
      </div>
      {query.get("shared") && <p role="status" className="rounded-2xl border border-sage bg-surface p-4 text-xs">Sharing permission created.</p>}
      <Permissions consents={consents} activeCount={consents.status === "ready" ? consents.data.filter((c) => c.status === "ACTIVE").length : null} totalEvents={counts?.all ?? null} onChanged={() => { void consents.refresh(); setLedgerKey((n) => n + 1); }} />
      <Ledger key={ledgerKey} onCounts={setCounts} />
      <Removals />
    </WorkspaceShell>
  );
}

/** Active permissions with revoke, followed by past (expired / revoked) ones. */
function Permissions({ consents, activeCount, totalEvents, onChanged }: { consents: ReturnType<typeof useApiData<ConsentView[]>>; activeCount: number | null; totalEvents: number | null; onChanged: () => void }) {
  const { getToken } = useAuth();
  const [revoking, setRevoking] = useState<ConsentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /** Revokes future access after explicit confirmation. */
  async function revoke() {
    if (!revoking || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, `/patients/self/consents/${revoking.id}/revoke`, { method: "POST", body: "{}" });
      setRevoking(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revoking could not be confirmed. Access may still be active.");
    } finally {
      setBusy(false);
    }
  }

  if (consents.status === "loading") return <p role="status" className="text-sm text-graphite">Loading permissions…</p>;
  if (consents.status === "error") return <div role="alert" className={privacyCard}><p className="text-sm">{consents.error}</p><button type="button" onClick={() => void consents.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>;
  const active = consents.data.filter((c) => c.status === "ACTIVE");
  const past = consents.data.filter((c) => c.status !== "ACTIVE");

  return (
    <>
      <section className={`${privacyCard} ring-[5px] ring-sage/25`}>
        <p className={privacyLabel}>Consent status</p>
        <h2 className="mt-2 text-lg">{activeCount ?? 0} active sharing {activeCount === 1 ? "permission" : "permissions"}</h2>
        {totalEvents !== null && <p className="mt-1 text-xs text-graphite">{totalEvents} ledger events · append-only</p>}
      </section>
      <section className="space-y-4">
        <h2 className={privacyLabel}>Active sharing</h2>
        {active.length === 0 && <p className={`${privacyCard} text-sm text-graphite`}>Nothing is shared. Doctors see only records they wrote themselves.</p>}
        {active.map((c) => (
          <article key={c.id} className={privacyCard}>
            <h3 className="text-base">Dr. {c.doctor_name}</h3>
            <dl className="mt-3 space-y-2 border-t border-sage pt-3 text-xs">
              <div className="flex justify-between gap-4"><dt className="text-graphite">Purpose</dt><dd className="text-right">{c.purpose}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-graphite">Records</dt><dd className="text-right">{scopeSummary(c)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-graphite">Expiry</dt><dd>{expiryText(c)}</dd></div>
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={recordHref("/app/patient/care/share", "doctorId", c.doctor_id)} className="grid min-h-11 place-items-center rounded-full border border-sage px-3 text-xs">Change scope</Link>
              <button type="button" onClick={(e) => { triggerRef.current = e.currentTarget; setError(null); setRevoking(c); }} className="min-h-11 rounded-full border border-critical px-3 text-xs text-critical">Revoke</button>
            </div>
          </article>
        ))}
        <Link href="/app/patient/care" className="block min-h-11 text-center text-xs text-evidence">+ Add another doctor or encounter share</Link>
      </section>
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className={privacyLabel}>Expired and revoked</h2>
          {past.map((c) => <p key={c.id} className="rounded-2xl border border-hairline bg-surface p-3 text-xs">Dr. {c.doctor_name} · {scopeSummary(c)} · {expiryText(c)}</p>)}
        </section>
      )}
      {revoking && (
        <VaultDialog titleId="revoke-title" returnFocusRef={triggerRef} busy={busy} onClose={() => setRevoking(null)}>
          <h2 id="revoke-title" className="text-xl">Revoke Dr. {revoking.doctor_name}&apos;s access?</h2>
          <p className="mt-3 text-sm leading-relaxed">The doctor loses access to {scopeSummary(revoking)} immediately. Records the doctor already wrote are not erased. The revocation is added to your ledger.</p>
          {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
          <button type="button" onClick={() => void revoke()} disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-critical px-3 text-sm text-surface disabled:opacity-50">{busy ? "REVOKING…" : "Revoke access"}</button>
          <button type="button" onClick={() => setRevoking(null)} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-sage text-sm disabled:opacity-50">Keep sharing</button>
        </VaultDialog>
      )}
    </>
  );
}

/** Read-only, append-only access history with category filters and paging. */
function Ledger({ onCounts }: { onCounts: (counts: AccessLedger["counts"]) => void }) {
  const { getToken } = useAuth();
  const [category, setCategory] = useState<LedgerCategory | null>(null);
  const [events, setEvents] = useState<AccessLedger["events"]>([]);
  const [counts, setCounts] = useState<AccessLedger["counts"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  /** Loads one ledger page; the first page replaces the list, later pages append. */
  const load = useCallback(async (from: string | null, signal?: AbortSignal) => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return;
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (from) params.set("cursor", from);
      const page = await fetchApi<AccessLedger>(token, `/patients/self/access-ledger${params.size ? `?${params}` : ""}`, { signal });
      if (signal?.aborted) return;
      setEvents((cur) => (from ? [...cur, ...page.events] : page.events));
      setCounts(page.counts);
      onCounts(page.counts);
      setCursor(page.next_cursor);
      setStatus("ready");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Ledger unavailable");
      setStatus("error");
    }
  }, [category, getToken, onCounts]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(null, controller.signal); });
    return () => controller.abort();
  }, [load]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className={privacyLabel}>Access ledger</h2>
        <p className="mt-2 text-lg">Every access, permanently visible</p>
        <p className="mt-2 inline-block rounded-full bg-surface px-3 py-2 text-[10px] text-graphite">IMMUTABLE · READ ONLY · APPEND-ONLY</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ledger filters">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" aria-pressed={category === f.value} onClick={() => { setEvents([]); setCursor(null); setCategory(f.value); }} className={`min-h-11 rounded-full border px-3 text-[10px] ${category === f.value ? "border-botanical bg-botanical text-surface" : "border-sage"}`}>{f.label}{counts ? ` · ${counts[f.count]}` : ""}</button>
        ))}
      </div>
      {status === "error" && <div role="alert" className={privacyCard}><p className="text-sm">{error}</p><button type="button" onClick={() => void load(null)} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>}
      {status === "ready" && events.length === 0 && <p className={`${privacyCard} text-sm text-graphite`}>No access events yet.</p>}
      {events.map((e) => (
        <article key={e.id} className={privacyCard}>
          <div className="flex items-start justify-between gap-2">
            <span className="rounded-full border border-sage px-2 py-1 text-[9px] uppercase">{e.category === "AI" ? "AI inference audit" : `${e.category.toLowerCase()} access`}</span>
            <time dateTime={e.timestamp} className="text-[10px] text-graphite">{formatDateTime(e.timestamp)}</time>
          </div>
          <h3 className="mt-3 text-base">{e.actor.display_name}</h3>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4"><dt className="text-graphite">Action</dt><dd className="text-right">{e.action} · {e.resource_label}</dd></div>
            {e.purpose && <div className="flex justify-between gap-4"><dt className="text-graphite">Purpose</dt><dd className="text-right">{e.purpose}</dd></div>}
            {e.consent_id && <div className="flex justify-between gap-4"><dt className="text-graphite">Basis</dt><dd>Your consent</dd></div>}
          </dl>
          <Link href={recordHref("/app/patient/privacy/access", "eventId", e.id)} className="mt-1 inline-flex min-h-11 items-center text-[10px] font-semibold text-botanical">View receipt →</Link>
        </article>
      ))}
      {status === "loading" && <p role="status" className="text-xs text-graphite">Loading ledger…</p>}
      {cursor && status === "ready" && <button type="button" onClick={() => void load(cursor)} className="min-h-11 w-full rounded-xl border border-sage text-xs">Load older events</button>}
    </section>
  );
}

/** Removal requests: tracking and a request form. A request never deletes anything by itself. */
function Removals() {
  const { getToken } = useAuth();
  const requests = useApiData<RemovalRequestView[]>("/patients/self/record-removal-requests");
  const circle = useApiData<RelationshipView[]>("/patients/self/doctors");
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [type, setType] = useState(RECORD_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const doctors = circle.status === "ready" ? circle.data : [];

  /** Submits the request and refreshes tracking; failures keep the form text. */
  async function submit() {
    if (busy || !doctorId) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, "/patients/self/record-removal-requests", {
        method: "POST",
        body: JSON.stringify({ target_actor_type: "DOCTOR", target_actor_id: doctorId, resource_type: type, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      setOpen(false);
      setReason("");
      await requests.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be confirmed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className={privacyLabel}>Record removal requests</h2>
      {requests.status === "error" && <p role="alert" className="text-sm text-critical">{requests.error}</p>}
      {requests.status === "ready" && requests.data.length === 0 && <p className={`${privacyCard} text-sm text-graphite`}>No removal requests.</p>}
      {requests.status === "ready" && requests.data.map((r) => (
        <article key={r.id} className={privacyCard}>
          <div className="flex items-start justify-between gap-2"><h3 className="text-base">Dr. {r.target_doctor_name ?? "doctor"}</h3><StatusBadge status={r.status} /></div>
          <p className="mt-2 text-xs text-graphite">{RECORD_TYPES.find((t) => t.value === r.resource_type)?.label ?? r.resource_type} · requested {formatDateTime(r.requested_at)}</p>
          {r.reason && <p className="mt-2 text-xs">Your reason: {r.reason}</p>}
          {r.resolution_note && <p className="mt-2 text-xs">Doctor&apos;s reason: {r.resolution_note}</p>}
          {r.decisions.length > 0 && <ul className="mt-2 space-y-1 text-xs">{r.decisions.map((d, i) => <li key={i}>{d.label ?? d.resource_type}: {d.decision === "REMOVE" ? "removal approved" : "retained"}</li>)}</ul>}
          {r.status !== "OPEN" && r.status !== "ROUTED" && <p className="mt-2 text-[10px] text-graphite">The decision is recorded. Changes to what appears in your views are applied separately.</p>}
        </article>
      ))}
      <button ref={triggerRef} type="button" onClick={() => { setError(null); setOpen(true); }} disabled={doctors.length === 0} className="min-h-11 w-full rounded-xl border border-sage text-xs disabled:opacity-50">Request record removal</button>
      {doctors.length === 0 && circle.status === "ready" && <p className="text-[10px] text-graphite">Add a doctor to your care circle to send a request.</p>}
      {open && (
        <VaultDialog titleId="removal-title" returnFocusRef={triggerRef} busy={busy} onClose={() => setOpen(false)}>
          <h2 id="removal-title" className="text-xl">Request record removal</h2>
          <p className="mt-2 text-xs leading-relaxed text-graphite">This sends a request to the doctor. Doctors may need to retain professional records; you will see their decision and reason.</p>
          <label htmlFor="removal-doctor" className="mt-4 block text-xs">Doctor</label>
          <select id="removal-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="clinix-field mt-1 text-sm">
            <option value="">Choose a doctor</option>
            {doctors.map((d) => <option key={d.doctor_id} value={d.doctor_id}>Dr. {d.doctor_name}</option>)}
          </select>
          <label htmlFor="removal-type" className="mt-3 block text-xs">Record type</label>
          <select id="removal-type" value={type} onChange={(e) => setType(e.target.value)} className="clinix-field mt-1 text-sm">
            {RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label htmlFor="removal-reason" className="mt-3 block text-xs">Reason (optional)</label>
          <textarea id="removal-reason" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className="clinix-field mt-1 text-sm" />
          {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
          <button type="button" onClick={() => void submit()} disabled={busy || !doctorId} className="mt-4 min-h-12 w-full rounded-xl bg-botanical px-3 text-sm text-surface disabled:opacity-50">{busy ? "SENDING…" : "Send request"}</button>
        </VaultDialog>
      )}
    </section>
  );
}
