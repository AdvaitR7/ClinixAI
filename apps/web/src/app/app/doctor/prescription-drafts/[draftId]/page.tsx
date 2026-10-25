"use client";

import { useAuth } from "@/lib/auth";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  DocumentView,
  PrescriptionDraftView,
  PrescriptionItemInput,
  PrescriptionView,
} from "@clinix/schemas";
import { patchPrescriptionDraftSchema } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MedicineEditor } from "@/components/medicine-editor";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

/** Page 20 — draft review + finalization (SCREEN_CATALOG §7, Figma 61:2 & 61:215). */
export default function PrescriptionDraftPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const state = useApiData<PrescriptionDraftView>(
    params.draftId ? `/doctor/prescription-drafts/${params.draftId}` : null,
  );

  const [items, setItems] = useState<PrescriptionItemInput[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [reviewedItems, setReviewedItems] = useState<PrescriptionItemInput[] | null>(null);
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

  // OCR drafts: load the source image beside the extracted fields.
  useEffect(() => {
    if (!sourceDocId) return;
    void (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        setSourceDoc(await fetchApi<DocumentView>(token, `/doctor/documents/${sourceDocId}`));
      } catch {
        setSourceDoc(null);
      }
    })();
  }, [sourceDocId, getToken]);

  useEffect(() => {
    if (loadedItems && !initialized.current) {
      initialized.current = true;
      setItems(
        loadedItems.map((i) => ({
          medicine_name: i.medicine_name,
          strength: i.strength,
          dose: i.dose,
          route: i.route,
          frequency: i.frequency,
          timing: i.timing,
          duration: i.duration,
          instructions: i.instructions,
        })),
      );
    }
  }, [loadedItems]);

  /** Saves every visible row before allowing the clinician to review the saved snapshot. */
  async function save(review = false) {
    setSaved(false);
    const parsed = patchPrescriptionDraftSchema.safeParse({ items });
    if (!parsed.success || items.some((item) => !item.medicine_name.trim())) {
      setError("Check every medicine name and field length before saving.");
      return;
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
      setSaved(true);
      if (review) {
        const saved = await fetchApi<PrescriptionDraftView>(token, `/doctor/prescription-drafts/${params.draftId}`);
        if (saved.status === "APPROVED") throw new Error("This draft has already been finalized. Reopen it to view the prescription.");
        setItems(saved.items);
        setReviewedItems(saved.items);
        setConfirming(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

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
          body: JSON.stringify({ reviewed_items: reviewedItems }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      router.replace(`/app/doctor/prescriptions/${res.id}`);
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
        <section className="clinix-doctor-card p-5">
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
        <MedicineEditor items={items} onChange={(next) => {
          setItems(next);
          setSaved(false);
        }} />
      </fieldset>
      {saved && <p role="status" className="font-sans text-sm text-doctor-muted">Draft saved.</p>}
      {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}
      {!finalized && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => save()}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl border border-white/10 bg-doctor-panel font-sans text-xs font-semibold uppercase tracking-wider text-surface disabled:opacity-60"
          >
            Save draft
          </button>
          <button
            ref={finalizeButton}
            type="button"
            onClick={() => save(true)}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl bg-copper font-sans text-xs font-semibold uppercase tracking-wider text-ink transition-transform active:translate-y-px disabled:opacity-60"
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
            <span className="rounded-full border border-copper/50 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-copper">
              Final Review
            </span>
            <h3 id="finalize-dialog-title" className="mt-5 font-sans text-[28px] leading-tight font-semibold text-surface">
              Finalize prescription?
            </h3>
            <p className="mt-2 font-sans text-xs leading-5 text-doctor-muted/75">
              Confirm the doctor-authored record before it becomes finalized.
            </p>
            <section className="mt-6 rounded-[22px] border border-copper bg-graphite p-4 font-sans text-xs text-surface">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xl">{draft.patient_name}</h4>
                <span className="rounded-full border border-evidence px-3 py-2 text-[10px]">Version 1</span>
              </div>
              <dl className="mt-4 space-y-2">
                <div className="flex gap-3"><dt className="w-20 text-copper">Source</dt><dd>{draft.source}</dd></div>
                <div className="flex gap-3"><dt className="w-20 text-copper">Medicines</dt><dd>{reviewedItems?.length}</dd></div>
              </dl>
            </section>
            <div className="mt-6 space-y-3 rounded-[22px] border border-copper bg-graphite p-4 font-sans text-xs text-surface">
              <p>Saved medicines ({reviewedItems?.length})</p>
              <ul className="max-h-60 space-y-2 overflow-y-auto">
                {reviewedItems?.map((item, index) => (
                  <li key={index} className="whitespace-pre-wrap break-words">
                    <strong className="text-surface">{item.medicine_name}</strong>
                    <p>{[item.strength, item.dose, item.route, item.frequency, item.timing, item.duration, item.instructions].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </div>
            <section className="mt-6 rounded-[22px] border border-evidence bg-graphite p-4 font-sans text-xs leading-5 text-surface">
              <h4 className="text-lg">Edits become amendments</h4>
              <p className="mt-2">Finalization preserves this version. Later corrections create a dated amendment or a new version; the original cannot be silently replaced.</p>
            </section>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={finalize}
                disabled={busy}
                className="min-h-[60px] rounded-[18px] bg-copper font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
              >
                {busy ? "Finalizing…" : "Finalize prescription"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="min-h-[52px] rounded-[18px] border border-copper font-sans text-xs font-semibold text-surface"
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
      <header className="clinix-doctor-card border-copper p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-copper">Draft review</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-surface">{draft.patient_name}</h2>
            <p className="mt-1 font-mono text-xs text-doctor-muted/65">Provenance: {draft.source}</p>
          </div>
          <StatusBadge status={draft.status} />
        </div>
      </header>

      {finalized ? (
        <section className="clinix-doctor-card p-5">
          <p className="font-sans text-sm text-doctor-muted/80">
            This draft has been finalized and can no longer be edited directly.
          </p>
        </section>
      ) : sourceDoc ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="clinix-doctor-card p-4 md:sticky md:top-4 md:self-start">
            <p className="clinix-label text-copper">
              Source document
            </p>
            {sourceDoc.view_url && sourceDoc.mime_type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceDoc.view_url}
                alt="Source prescription"
                className="mt-3 w-full rounded-2xl border border-white/10"
              />
            ) : sourceDoc.view_url ? (
              <a
                href={sourceDoc.view_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-sans text-xs font-semibold text-copper hover:underline"
              >
                Open source document in new tab →
              </a>
            ) : (
              <p className="mt-3 font-sans text-xs text-doctor-muted/60">Source preview unavailable.</p>
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
