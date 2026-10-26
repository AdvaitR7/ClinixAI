"use client";

import { useAuth } from "@/lib/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { PrescriptionItemInput } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { MedicineEditor } from "@/components/medicine-editor";
import { fetchApi } from "@/lib/api";

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
      const base = `/app/doctor/prescription-drafts/${res.id}`;
      router.replace(next === "preview" ? `${base}/preview` : next === "finalize" ? `${base}?finalize=1` : base);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

  if (!encounterId || !patientId) {
    return (
      <WorkspaceShell workspace="Doctor" title="New prescription" nav={nav}>
        <section className="clinix-doctor-card border-critical p-5">
          <p className="font-sans text-sm font-semibold text-critical">
            Missing consultation context.
          </p>
          <p className="mt-1 font-sans text-xs text-doctor-muted/70">
            Direct prescription drafts must be initiated from an active patient consultation encounter.
          </p>
        </section>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Direct prescription entry" nav={nav}>
      <header className="clinix-doctor-card border-copper p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-copper">Direct Entry Draft</p>
            <h2 className="mt-1 font-sans text-lg font-bold text-surface">Prescription authoring</h2>
            <p className="mt-1 font-mono text-xs text-doctor-muted/65">
              Encounter: {encounterId.slice(0, 8)}… · Patient: {patientId.slice(0, 8)}…
            </p>
          </div>
          <span className="rounded-full border border-copper/50 bg-copper/10 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-copper">
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
            className="min-h-[54px] rounded-[1.25rem] border border-copper bg-doctor-panel px-4 font-sans text-sm font-semibold uppercase tracking-wider text-copper disabled:opacity-60"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => void save("finalize")}
            disabled={busy}
            className="min-h-[54px] rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase tracking-wider text-ink transition-transform active:translate-y-px disabled:opacity-60"
          >
            Finalize prescription
          </button>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="min-h-[54px] w-full rounded-[1.25rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm font-semibold uppercase tracking-wider text-surface disabled:opacity-60"
        >
          {busy ? "Saving draft…" : "Save draft for review →"}
        </button>
        <p className="font-sans text-xs text-doctor-muted/70">Finalizing opens the final review first; nothing is finalized until you confirm there.</p>
      </div>
    </WorkspaceShell>
  );
}
