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
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MedicineEditor } from "@/components/medicine-editor";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceDoc, setSourceDoc] = useState<DocumentView | null>(null);
  const initialized = useRef(false);

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
    if (state.status === "ready" && !initialized.current) {
      initialized.current = true;
      setItems(
        state.data.items.map((i) => ({
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
  }, [state.status]);

  async function save() {
    const cleaned = items.filter((i) => i.medicine_name.trim());
    if (cleaned.length === 0) {
      setError("Add at least one medicine.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/prescription-drafts/${params.draftId}`, {
        method: "PATCH",
        body: JSON.stringify({ items: cleaned }),
      });
      await state.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
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
          body: "{}",
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
      <MedicineEditor items={items} onChange={setItems} />
      {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}
      {!finalized && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl border border-white/10 bg-doctor-panel font-sans text-xs font-semibold uppercase tracking-wider text-surface disabled:opacity-60"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl bg-copper font-sans text-xs font-semibold uppercase tracking-wider text-ink transition-transform active:translate-y-px disabled:opacity-60"
          >
            Finalize prescription
          </button>
        </div>
      )}

      {/* Finalization Confirmation Modal (Figma 61:215) */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="finalize-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
        >
          <div className="w-full max-w-sm rounded-[1.75rem] border border-copper bg-doctor-panel p-6 shadow-2xl">
            <span className="rounded-full border border-copper/50 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-copper">
              Final Review
            </span>
            <h3 id="finalize-dialog-title" className="mt-2 font-sans text-xl font-bold text-surface">
              Finalize this prescription?
            </h3>
            <p className="mt-2 font-sans text-xs leading-5 text-doctor-muted/75">
              Finalizing locks this prescription into an authoritative, immutable record (Version 1).
              Any subsequent modifications require creating a new revision.
            </p>
            <div className="mt-4 space-y-2 rounded-xl bg-black/30 p-3 font-sans text-xs text-doctor-muted/80">
              <p className="flex items-center gap-2"><span>✓</span> Structured items verified ({items.length} medicines)</p>
              <p className="flex items-center gap-2"><span>✓</span> Authoritative clinical sign-off</p>
            </div>
            <div className="mt-6 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl border border-white/10 font-sans text-xs font-semibold text-surface"
              >
                Return to draft
              </button>
              <button
                type="button"
                onClick={finalize}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl bg-copper font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
              >
                {busy ? "Finalizing…" : "Confirm finalize"}
              </button>
            </div>
          </div>
        </div>
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
