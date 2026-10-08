"use client";

import { useAuth } from "@clerk/nextjs";
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
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

/** Page 20 — draft review + finalization (SCREEN_CATALOG §7). */
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
        <p className="font-sans text-sm text-critical">{state.error}</p>
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
            className="flex-1 rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite disabled:opacity-60"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="flex-1 rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical disabled:opacity-60"
          >
            Finalize
          </button>
        </div>
      )}
      {confirming && (
        <section className="rounded-2xl border border-review bg-surface p-5">
          <p className="font-sans text-sm font-semibold text-review">
            Finalize this prescription? It becomes an immutable record (Version 1). Later changes
            create a new version, never an edit.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-full border border-hairline px-4 py-2 font-sans text-sm font-semibold text-graphite"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={finalize}
              disabled={busy}
              className="flex-1 rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
            >
              Confirm finalize
            </button>
          </div>
        </section>
      )}
    </>
  );

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription draft" nav={nav}>
      <header className="rounded-2xl bg-botanical p-5 text-surface">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-sans text-lg font-semibold">{draft.patient_name}</p>
            <p className="mt-1 font-sans text-xs text-sage">Source: {draft.source}</p>
          </div>
          <StatusBadge status={draft.status} />
        </div>
      </header>

      {finalized ? (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-sm text-graphite">
            This draft has been finalized and can no longer be edited.
          </p>
        </section>
      ) : sourceDoc ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="md:sticky md:top-4 md:self-start">
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Source document
            </p>
            {sourceDoc.view_url && sourceDoc.mime_type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceDoc.view_url}
                alt="Source prescription"
                className="mt-2 w-full rounded-2xl border border-hairline"
              />
            ) : sourceDoc.view_url ? (
              <a
                href={sourceDoc.view_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block font-sans text-sm font-semibold text-copper"
              >
                Open source document →
              </a>
            ) : (
              <p className="mt-2 font-sans text-sm text-graphite">Source preview unavailable.</p>
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
