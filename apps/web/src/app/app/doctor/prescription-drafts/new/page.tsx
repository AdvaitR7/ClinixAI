"use client";

import { useAuth } from "@/lib/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { PrescriptionItemInput } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { MedicineEditor } from "@/components/medicine-editor";
import { fetchApi } from "@/lib/api";
import { recordHref } from "@/lib/route-params";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

/** Page 20 — direct prescription composition (SCREEN_CATALOG §7, Figma 61:149). */
export default function NewPrescriptionPage() {
  return (
    <Suspense fallback={<WorkspaceShell workspace="Doctor" title="New prescription" nav={nav}><Skeleton className="h-40 rounded-2xl" /></WorkspaceShell>}>
      <NewPrescriptionForm />
    </Suspense>
  );
}

function NewPrescriptionForm() {
  const router = useRouter();
  const { getToken } = useAuth();
  const params = useSearchParams();
  const encounterId = params.get("encounterId");
  const patientId = params.get("patientId");

  const [items, setItems] = useState<PrescriptionItemInput[]>([{ medicine_name: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Creates the draft, then continues to the saved draft, its preview, or the final review. */
  async function save(next: "review" | "preview" | "finalize" = "review") {
    const cleaned = items.filter((i) => i.medicine_name.trim());
    if (cleaned.length === 0) {
      setError("Add at least one medicine name.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<{ id: string }>(
        token,
        `/doctor/encounters/${encounterId}/prescription-drafts`,
        {
          method: "POST",
          body: JSON.stringify({ source: "DIRECT_ENTRY", items: cleaned }),
        },
      );
      router.replace(recordHref(
        "/app/doctor/prescription-drafts",
        "draftId",
        res.id,
        next === "finalize" ? { finalize: "1" } : {},
        next === "preview" ? "/preview" : "",
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

  if (!encounterId || !patientId) {
    return (
      <WorkspaceShell workspace="Doctor" title="New prescription" nav={nav}>
        <section className="clear-card border-critical p-5">
          <p className="font-sans text-sm font-semibold text-critical">
            Missing consultation context.
          </p>
          <p className="mt-1 font-sans text-xs text-clear-secondary">
            Direct prescription drafts must be initiated from an active patient consultation encounter.
          </p>
        </section>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Direct prescription entry" nav={nav}>
      <header className="clear-card border-clear-divider p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-clear-action">Direct Entry Draft</p>
            <h2 className="mt-1 font-sans text-lg font-bold text-clear-ink">Prescription authoring</h2>
            <p className="mt-1 font-sans tabular-nums text-xs text-clear-secondary">
              Encounter: {encounterId.slice(0, 8)}… · Patient: {patientId.slice(0, 8)}…
            </p>
          </div>
          <span className="rounded-full border border-clear-divider bg-clear-selection px-2.5 py-1 font-sans text-xs font-bold uppercase text-clear-action">
            Draft
          </span>
        </div>
      </header>

      <div className="space-y-4">
        <MedicineEditor items={items} onChange={setItems} />

        {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void save("preview")}
            disabled={busy}
            className="min-h-[54px] rounded-[1.25rem] border border-clear-divider bg-clear-surface px-4 font-sans text-sm font-semibold uppercase tracking-wider text-clear-action disabled:opacity-60"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => void save("finalize")}
            disabled={busy}
            className="min-h-[54px] rounded-[1.25rem] bg-clear-action px-4 font-sans text-sm font-semibold uppercase tracking-wider text-white transition-transform active:translate-y-px disabled:opacity-60"
          >
            Finalize prescription
          </button>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="min-h-[54px] w-full rounded-[1.25rem] border border-clear-divider bg-clear-surface px-4 font-sans text-sm font-semibold uppercase tracking-wider text-clear-ink disabled:opacity-60"
        >
          {busy ? "Saving draft…" : "Save draft for review →"}
        </button>
        <p className="font-sans text-xs text-clear-secondary">Finalizing opens the final review first; nothing is finalized until you confirm there.</p>
      </div>
    </WorkspaceShell>
  );
}
