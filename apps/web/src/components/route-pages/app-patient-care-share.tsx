"use client";


import { useRouteParam } from "@/lib/route-params";

import { Suspense, useEffect, useRef, useState } from "react";
import {useRouter, useSearchParams} from "next/navigation";
import type { ConsentCreate, ConsentExpiry, ConsentPreview, ConsentView, DoctorOption } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { careNav, privacyCard, privacyLabel, scopeLabel } from "@/lib/privacy";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PatientVisitHeader } from "@/components/patient-visit-header";
import { VaultDialog } from "@/components/vault-dialog";

const EXPIRIES: { value: ConsentExpiry; label: string; text: string }[] = [
  { value: "7_DAYS", label: "7 DAYS", text: "Access ends automatically after 7 days." },
  { value: "30_DAYS", label: "30 DAYS", text: "Access ends automatically after 30 days." },
  { value: "UNTIL_WITHDRAWN", label: "UNTIL WITHDRAWN", text: "Access stays until you revoke it on the privacy screen." },
];

/** Consent scope picker (SCR-020); wraps query-driven context in a suspense boundary. */
export default function ShareScopePage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading…</p>}><ScopePicker /></Suspense>;
}

/** Lets the patient choose record groups, purpose and expiry, then review before granting consent. */
function ScopePicker() {
  const doctorId = useRouteParam("doctorId");
  const query = useSearchParams();
  const encounterId = query.get("encounterId");
  const fromBooking = query.get("from") === "book";
  const router = useRouter();
  const { getToken } = useAuth();
  const doctors = useApiData<DoctorOption[]>("/doctors");
  const doctor = doctors.status === "ready" ? doctors.data.find((d) => d.doctor_id === doctorId) : undefined;
  const [preview, setPreview] = useState<ConsentPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ConsentExpiry>("7_DAYS");
  const [purpose, setPurpose] = useState(encounterId ? "Consultation follow-up" : "");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await fetchApi<ConsentPreview>(token, "/patients/self/consents/preview", {
          method: "POST",
          body: JSON.stringify({ doctor_id: doctorId, ...(encounterId ? { encounter_id: encounterId } : {}) }),
          signal: controller.signal,
        });
        setPreview(data);
        setPicked(data.suggested_scopes.filter((s) => s.recommended && s.available).map((s) => s.resource_type));
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Could not load sharing options.");
      }
    })();
    return () => controller.abort();
  }, [doctorId, encounterId, getToken]);

  /** Whole-group scopes, or the linked encounter when one is carried in from a check-in result. */
  function scopes(): ConsentCreate["scopes"] {
    return picked.map((type) => ({
      resource_type: type as ConsentCreate["scopes"][number]["resource_type"],
      ...(encounterId && (type === "ENCOUNTER" || type === "CHECKIN_PACKET") ? { resource_id: encounterId } : {}),
    }));
  }

  /** Creates the consent only after the review dialog, then returns to booking or the privacy screen. */
  async function confirm() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      const created = await fetchApi<ConsentView>(token, "/patients/self/consents", {
        method: "POST",
        body: JSON.stringify({ doctor_id: doctorId, purpose: purpose.trim(), expiry, scopes: scopes() } satisfies ConsentCreate),
      });
      router.replace(fromBooking
        ? `/app/patient/book?doctorId=${encodeURIComponent(doctorId)}&consentId=${encodeURIComponent(created.id)}`
        : "/app/patient/privacy?shared=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing could not be confirmed. Nothing was shared.");
      saving.current = false;
      setBusy(false);
    }
  }

  const ready = picked.length > 0 && purpose.trim().length > 0;
  const expiryInfo = EXPIRIES.find((e) => e.value === expiry)!;
  const closeHref = fromBooking ? `/app/patient/book?doctorId=${doctorId}` : "/app/patient/care";

  return (
    <WorkspaceShell workspace="Patient" title="Choose what to share" nav={careNav()} focused hideHeading
      headerContent={<PatientVisitHeader backHref={closeHref} action={<a href={closeHref} className="inline-flex min-h-11 items-center text-xs">Close</a>} />}>
      <div>
        <p className={privacyLabel}>Consent · record sharing</p>
        <h1 className="mt-4 text-[30px] leading-tight">Choose what to share</h1>
        <p className="mt-2 text-xs leading-relaxed text-graphite">Nothing is shared until you review the recipient, purpose, scope and expiry.</p>
      </div>
      <section className={privacyCard}>
        <p className={privacyLabel}>Recipient</p>
        <h2 className="mt-2 text-lg">{doctor ? `Dr. ${doctor.name}` : doctors.status === "error" ? "Doctor unavailable" : "Loading doctor…"}</h2>
        {doctor && <p className="mt-1 text-xs text-graphite">{doctor.speciality ?? "Speciality unavailable"} · {doctor.verification_status ?? "Verification unknown"}</p>}
      </section>
      <section className={privacyCard}>
        <label htmlFor="share-purpose" className={privacyLabel}>Purpose</label>
        <input id="share-purpose" value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Migraine follow-up consultation" className="clinix-field mt-2 text-sm" />
      </section>
      <section>
        <h2 className={`${privacyLabel} mb-3`}>Share scope</h2>
        {loadError && <p role="alert" className="text-sm text-critical">{loadError}</p>}
        {!preview && !loadError && <p role="status" className="text-sm text-graphite">Loading sharing options…</p>}
        <div className="space-y-2">
          {preview?.suggested_scopes.map((scope) => (
            <label key={scope.resource_type} className={`flex min-h-14 items-start gap-3 rounded-xl border p-3 text-xs ${scope.available ? "border-sage" : "border-hairline text-graphite/60"}`}>
              <input type="checkbox" className="mt-1 size-5" disabled={!scope.available} checked={picked.includes(scope.resource_type)}
                onChange={(e) => setPicked((cur) => e.target.checked ? [...cur, scope.resource_type] : cur.filter((t) => t !== scope.resource_type))} />
              <span><span className="block text-sm">{scope.label}</span>{!scope.available && <span className="mt-1 block">{scope.unavailable_reason ?? "Unavailable"}</span>}</span>
            </label>
          ))}
        </div>
      </section>
      <section className={privacyCard}>
        <h2 className={privacyLabel}>Access expiry</h2>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Access expiry">
          {EXPIRIES.map((item) => (
            <button key={item.value} type="button" aria-pressed={expiry === item.value} onClick={() => setExpiry(item.value)} className={`min-h-11 rounded-full border px-1 text-xs ${expiry === item.value ? "border-botanical bg-botanical text-surface" : "border-sage"}`}>{item.label}</button>
          ))}
        </div>
        <p className="mt-3 text-xs text-graphite">{expiryInfo.text}</p>
      </section>
      <button ref={reviewRef} type="button" disabled={!ready} onClick={() => { setError(null); setReviewing(true); }} className="min-h-[54px] w-full rounded-[20px] bg-botanical px-4 text-sm text-surface disabled:opacity-50">REVIEW & CONFIRM SHARE</button>
      {reviewing && (
        <VaultDialog titleId="share-review-title" returnFocusRef={reviewRef} busy={busy} fullScreen onClose={() => setReviewing(false)}>
          <h2 id="share-review-title" className="text-xl">Confirm sharing</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className={privacyLabel}>Recipient</dt><dd>{doctor ? `Dr. ${doctor.name}` : "Doctor"}</dd></div>
            <div><dt className={privacyLabel}>Purpose</dt><dd>{purpose.trim()}</dd></div>
            <div><dt className={privacyLabel}>Records</dt><dd>{picked.map((t) => scopeLabel(t, Boolean(encounterId) && (t === "ENCOUNTER" || t === "CHECKIN_PACKET"))).join(" · ")}</dd></div>
            <div><dt className={privacyLabel}>Expiry</dt><dd>{expiryInfo.label.toLowerCase()}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-graphite">You can revoke this any time. Revoking stops future access; it does not erase records the doctor already wrote.</p>
          {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
          <button type="button" onClick={() => void confirm()} disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-botanical px-3 text-sm text-surface disabled:opacity-50">{busy ? "SHARING…" : "Confirm and share"}</button>
          <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-sage text-sm disabled:opacity-50">Back to edit</button>
        </VaultDialog>
      )}
    </WorkspaceShell>
  );
}
