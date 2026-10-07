"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { PrescriptionItemInput } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { MedicineEditor } from "@/components/medicine-editor";
import { fetchApi } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

/** Page 20 — direct prescription composition (SCREEN_CATALOG §7). */
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
      const res = await fetchApi<{ id: string }>(
        token,
        `/doctor/encounters/${encounterId}/prescription-drafts`,
        {
          method: "POST",
          body: JSON.stringify({ source: "DIRECT_ENTRY", items: cleaned }),
        },
      );
      router.replace(`/app/doctor/prescription-drafts/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

  if (!encounterId || !patientId) {
    return (
      <WorkspaceShell workspace="Doctor" title="New prescription" nav={nav}>
        <p className="font-sans text-sm text-critical">
          Missing consultation context. Start from a patient&apos;s consultation.
        </p>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell workspace="Doctor" title="New prescription" nav={nav}>
      <MedicineEditor items={items} onChange={setItems} />

      {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-full bg-botanical px-4 py-3 font-sans text-base font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save draft"}
      </button>
    </WorkspaceShell>
  );
}
