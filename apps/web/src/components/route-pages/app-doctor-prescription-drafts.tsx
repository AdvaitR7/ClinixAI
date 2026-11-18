"use client";


import { useRouteParam } from "@/lib/route-params";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type {
  DocumentView,
  PrescriptionDraftView,
  PrescriptionView,
} from "@clinix/schemas";
import { patchPrescriptionDraftSchema } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MedicineEditor, type EditorItem } from "@/components/medicine-editor";
import { PrescriptionSafetyPanel } from "@/components/prescription-safety-panel";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { fetchApi, useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";
import { doctorNav } from "@/lib/workspace-nav";

const nav = doctorNav("drafts");

/** Keeps only the persisted medicine fields; review state travels separately. */
function plain(item: EditorItem) {
  const { medicine_name, strength, dose, route, frequency, timing, duration, instructions } = item;
  return { medicine_name, strength, dose, route, frequency, timing, duration, instructions };
}

/** Page 20 — draft review + finalization (SCREEN_CATALOG §7, Figma 61:2 & 61:215). */
export default function PrescriptionDraftPage() {
  return (
    <Suspense fallback={<WorkspaceShell workspace="Doctor" title="Prescription draft" nav={nav}><Skeleton className="h-40 rounded-2xl" /></WorkspaceShell>}>
      <PrescriptionDraft />
    </Suspense>
  );
}

/** Maps a saved draft line into editor state, exposing its stored flag and OCR confidence. */
function toEditorItem(i: PrescriptionDraftView["items"][number]): EditorItem {
  const confidence = (i.field_confidence as { confidence?: unknown } | null)?.confidence;
  return { ...plain(i), needs_review: i.needs_review, reviewed: false, confidence: typeof confidence === "number" ? confidence : null };
}

function PrescriptionDraft() {
  const params = { draftId: useRouteParam("draftId") };
  const router = useRouter();
  const openFinalReview = useSearchParams().get("finalize") === "1";
  const { getToken } = useAuth();
  const state = useApiData<PrescriptionDraftView>(
    params.draftId ? `/doctor/prescription-drafts/${params.draftId}` : null,
  );

  const [items, setItems] = useState<EditorItem[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [reviewedItems, setReviewedItems] = useState<EditorItem[] | null>(null);
  const [checks, setChecks] = useState({ source: false, safety: false, preview: false });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceTry, setSourceTry] = useState(0);
  const autoStarted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sourceDoc, setSourceDoc] = useState<DocumentView | null>(null);
  const initialized = useRef(false);
  const finalizeButton = useRef<HTMLButtonElement>(null);
  const loadedItems = state.status === "ready" ? state.data.items : null;

  const sourceDocId =
    state.status === "ready" && state.data.source === "OCR"
      ? state.data.source_document_id
      : null;

  // OCR drafts: load the source image beside the extracted fields; a failure stays visible with a retry.
  useEffect(() => {
    if (!sourceDocId) return;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        setSourceDoc(await fetchApi<DocumentView>(token, `/doctor/documents/${sourceDocId}`));
        setSourceError(null);
      } catch (err) {
        setSourceDoc(null);
        setSourceError(err instanceof Error ? err.message : "Could not load the source document");
      }
    })();
  }, [sourceDocId, sourceTry, getToken]);

  useEffect(() => {
    if (loadedItems && !initialized.current) {
      initialized.current = true;
      setItems(loadedItems.map(toEditorItem));
    }
  }, [loadedItems]);

  /** Saves every visible row, reloads the stored review flags, and returns the saved draft (null on failure). */
  async function persist(): Promise<PrescriptionDraftView | null> {
    setSaved(false);
    const payload = items.map((item) => ({ ...plain(item), ...(item.needs_review ? { reviewed: !!item.reviewed } : {}) }));
    const parsed = patchPrescriptionDraftSchema.safeParse({ items: payload });
    if (!parsed.success || items.some((item) => !item.medicine_name.trim())) {
      setError("Check every medicine name and field length before saving.");
      return null;
    }
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/prescription-drafts/${params.draftId}`, {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      });
      const latest = await fetchApi<PrescriptionDraftView>(token, `/doctor/prescription-drafts/${params.draftId}`);
      if (latest.status === "APPROVED") throw new Error("This draft has already been finalized. Reopen it to view the prescription.");
      setItems(latest.items.map(toEditorItem));
      setSaved(true);
      return latest;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Saves, then opens the final review only when no extracted line is still unconfirmed. */
  async function save(review = false) {
    const latest = await persist();
    if (!latest || !review) return;
    const open = latest.items.filter((item) => item.needs_review).length;
    if (open) {
      setError(`Confirm ${open} flagged medicine${open === 1 ? "" : "s"} against the source before finalizing.`);
      return;
    }
    setReviewedItems(latest.items.map(toEditorItem));
    setChecks({ source: false, safety: false, preview: false });
    setConfirming(true);
  }

  /** Saves the visible edits, then opens the printable preview of the saved draft. */
  async function preview() {
    if (await persist()) router.push(recordHref("/app/doctor/prescription-drafts", "draftId", params.draftId, {}, "/preview"));
  }

  // Direct entry's FINALIZE hands over here: save and open the same final review.
  useEffect(() => {
    if (openFinalReview && items.length && !autoStarted.current && state.status === "ready" && state.data.status !== "APPROVED") {
      autoStarted.current = true;
      void save(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFinalReview, items.length, state.status]);

  /** Finalizes only the persisted snapshot displayed in the confirmation. */
  async function finalize() {
    if (!reviewedItems) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<PrescriptionView>(
        token,
        `/doctor/prescription-drafts/${params.draftId}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({ reviewed_items: reviewedItems.map(plain) }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      router.replace(recordHref("/app/doctor/prescriptions", "prescriptionId", res.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finalization failed");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return (
      <WorkspaceShell workspace="Doctor" title="Prescription draft" nav={nav}>
        <Skeleton className="h-40 rounded-2xl" />
      </WorkspaceShell>
    );
  }

  if (state.status === "error") {
    return (
      <WorkspaceShell workspace="Doctor" title="Prescription draft" nav={nav}>
        <section className="clear-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      </WorkspaceShell>
    );
  }

  const draft = state.data;
  const finalized = draft.status === "APPROVED";

  const editor = (
    <>
      <fieldset disabled={busy || confirming} className="min-w-0">
        <MedicineEditor
          items={items}
          blankItem={{ medicine_name: "", needs_review: draft.source !== "DIRECT_ENTRY" }}
          onChange={(next) => {
            setItems(next);
            setSaved(false);
          }}
        />
      </fieldset>
      <PrescriptionSafetyPanel patientId={draft.patient_id} riskFlags={draft.risk_flags} overallConfidence={draft.overall_confidence} />
      {saved && <p role="status" className="font-sans text-sm text-clear-secondary">Draft saved.</p>}
      {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}
      {!finalized && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => save()}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl border border-clear-divider bg-clear-surface font-sans text-xs font-semibold uppercase tracking-wider text-clear-ink disabled:opacity-60"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void preview()}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl border border-clear-divider bg-clear-surface font-sans text-xs font-semibold uppercase tracking-wider text-clear-action disabled:opacity-60"
          >
            Preview
          </button>
          <button
            ref={finalizeButton}
            type="button"
            onClick={() => save(true)}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl bg-clear-action font-sans text-xs font-semibold uppercase tracking-wider text-white transition-transform active:translate-y-px disabled:opacity-60"
          >
            Finalize prescription
          </button>
        </div>
      )}

      {/* Finalization Confirmation Modal (Figma 61:215) */}
      {confirming && (
        <ClinicalReviewDialog
          titleId="finalize-dialog-title"
          busy={busy}
          returnFocusRef={finalizeButton}
          onClose={() => setConfirming(false)}
        >
          <div>
            <span className="rounded-full border border-clear-divider px-2.5 py-1 font-sans text-xs font-bold uppercase text-clear-action">
              Final Review
            </span>
            <h3 id="finalize-dialog-title" className="mt-5 font-sans text-[28px] leading-tight font-semibold text-clear-ink">
              Finalize prescription?
            </h3>
            <p className="mt-2 font-sans text-xs leading-5 text-clear-secondary">
              Confirm the doctor-authored record before it becomes finalized.
            </p>
            <section className="mt-6 rounded-[22px] border border-clear-divider bg-clear-surface p-4 font-sans text-xs text-clear-ink">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xl">{draft.patient_name}</h4>
                <span className="rounded-full border border-clear-info px-3 py-2 text-xs">Version 1</span>
              </div>
              <dl className="mt-4 space-y-2">
                <div className="flex gap-3"><dt className="w-20 text-clear-action">Source</dt><dd>{draft.source}</dd></div>
                <div className="flex gap-3"><dt className="w-20 text-clear-action">Medicines</dt><dd>{reviewedItems?.length}</dd></div>
              </dl>
            </section>
            <div className="mt-6 space-y-3 rounded-[22px] border border-clear-divider bg-clear-surface p-4 font-sans text-xs text-clear-ink">
              <p>Saved medicines ({reviewedItems?.length})</p>
              <ul className="max-h-60 space-y-2 overflow-y-auto">
                {reviewedItems?.map((item, index) => (
                  <li key={index} className="whitespace-pre-wrap break-words">
                    <strong className="text-clear-ink">{item.medicine_name}</strong>
                    <p>{[item.strength, item.dose, item.route, item.frequency, item.timing, item.duration, item.instructions].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </div>
            <section aria-label="Before finalizing" className="mt-6 space-y-1 rounded-[22px] border border-clear-divider bg-clear-surface p-4 font-sans text-xs text-clear-ink">
              <h4 className="text-lg">Before finalizing</h4>
              {draft.source === "OCR" && (
                <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-clear-action" checked={checks.source} onChange={(e) => setChecks({ ...checks, source: e.target.checked })} />Medicines match the original source</label>
              )}
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-clear-action" checked={checks.safety} onChange={(e) => setChecks({ ...checks, safety: e.target.checked })} />Allergies and current medicines reviewed with the patient</label>
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-clear-action" checked={checks.preview} onChange={(e) => setChecks({ ...checks, preview: e.target.checked })} />Printable preview checked</label>
              <Link href={recordHref("/app/doctor/prescription-drafts", "draftId", params.draftId, {}, "/preview")} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-clear-action underline">Open full printable preview →</Link>
            </section>
            <section className="mt-6 rounded-[22px] border border-clear-info bg-clear-surface p-4 font-sans text-xs leading-5 text-clear-ink">
              <h4 className="text-lg">Edits become amendments</h4>
              <p className="mt-2">Finalization preserves this version. Later corrections create a dated amendment or a new version; the original cannot be silently replaced.</p>
            </section>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={finalize}
                disabled={busy || !checks.safety || !checks.preview || (draft.source === "OCR" && !checks.source)}
                className="min-h-[60px] rounded-[18px] bg-clear-action font-sans text-xs font-semibold uppercase text-white disabled:opacity-60"
              >
                {busy ? "Finalizing…" : "Finalize prescription"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="min-h-[52px] rounded-[18px] border border-clear-divider font-sans text-xs font-semibold text-clear-ink"
              >
                Return to draft
              </button>
            </div>
          </div>
        </ClinicalReviewDialog>
      )}
    </>
  );

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription draft review" nav={nav}>
      <header className="clear-card border-clear-divider p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-clear-action">Draft review</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-clear-ink">{draft.patient_name}</h2>
            <p className="mt-1 font-sans tabular-nums text-xs text-clear-secondary">Provenance: {draft.source}</p>
          </div>
          <StatusBadge status={draft.status} />
        </div>
      </header>

      {finalized ? (
        <section className="clear-card p-5">
          <p className="font-sans text-sm text-clear-secondary">
            This draft has been finalized and can no longer be edited directly.
          </p>
        </section>
      ) : sourceDocId ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="clear-card p-4 md:sticky md:top-4 md:self-start">
            <p className="clinix-label text-clear-action">
              Source document
            </p>
            {sourceError ? (
              <div role="alert" className="mt-3 font-sans text-xs text-critical">
                <p>Source unavailable: {sourceError}</p>
                <button type="button" onClick={() => { setSourceError(null); setSourceTry((n) => n + 1); }} className="mt-1 min-h-11 font-semibold text-clear-action underline">Retry source</button>
              </div>
            ) : !sourceDoc ? (
              <p role="status" className="mt-3 font-sans text-xs text-clear-secondary">Loading source…</p>
            ) : sourceDoc.view_url && sourceDoc.mime_type.startsWith("image/") ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceDoc.view_url} alt="Source prescription" className="mt-3 w-full rounded-2xl border border-clear-divider" />
                <a href={sourceDoc.view_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center font-sans text-xs font-semibold text-clear-action hover:underline">Open original source →</a>
              </>
            ) : sourceDoc.view_url ? (
              <a
                href={sourceDoc.view_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-sans text-xs font-semibold text-clear-action hover:underline"
              >
                Open original source →
              </a>
            ) : (
              <p className="mt-3 font-sans text-xs text-clear-secondary">Source preview unavailable.</p>
            )}
          </div>
          <div className="space-y-6">{editor}</div>
        </div>
      ) : (
        <div className="space-y-6">{editor}</div>
      )}
    </WorkspaceShell>
  );
}
