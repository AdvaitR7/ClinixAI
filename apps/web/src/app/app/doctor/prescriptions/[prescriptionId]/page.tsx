"use client";

import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { PrescriptionItemInput, PrescriptionView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MedicineEditor } from "@/components/medicine-editor";
import { fetchApi, fetchApiBlob, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 20 (finalized) — prescription record: provenance, amend, print (SCREEN_CATALOG §7). */
export default function PrescriptionPage() {
  const params = useParams<{ prescriptionId: string }>();
  const { getToken } = useAuth();
  const state = useApiData<PrescriptionView>(
    params.prescriptionId ? `/doctor/prescriptions/${params.prescriptionId}` : null,
  );

  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<PrescriptionItemInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function beginAmend() {
    if (state.status === "ready") {
      setItems(
        state.data.current_version.items.map((i) => ({
          medicine_name: i.medicine_name,
          strength: i.strength ?? undefined,
          dose: i.dose ?? undefined,
          route: i.route ?? undefined,
          frequency: i.frequency ?? undefined,
          timing: i.timing ?? undefined,
          duration: i.duration ?? undefined,
          instructions: i.instructions ?? undefined,
        })),
      );
    }
    setAmending(true);
    setReason("");
    setError(null);
  }

  async function amend() {
    const cleaned = items.filter((i) => i.medicine_name.trim());
    if (!reason.trim() || cleaned.length === 0) {
      setError("Enter a reason and at least one medicine.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/prescriptions/${params.prescriptionId}/amend`, {
        method: "POST",
        body: JSON.stringify({ reason, items: cleaned }),
      });
      setAmending(false);
      await state.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Amendment failed");
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const blob = await fetchApiBlob(
        token,
        `/doctor/prescriptions/${params.prescriptionId}/render`,
        { method: "POST" },
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render PDF");
    }
  }

  if (state.status === "loading") {
    return (
      <WorkspaceShell workspace="Doctor" title="Prescription" nav={nav}>
        <Skeleton className="h-40 rounded-2xl" />
      </WorkspaceShell>
    );
  }

  if (state.status === "error") {
    return (
      <WorkspaceShell workspace="Doctor" title="Prescription" nav={nav}>
        <p className="font-sans text-sm text-critical">{state.error}</p>
      </WorkspaceShell>
    );
  }

  const rx = state.data;
  const current = rx.current_version;

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription" nav={nav}>
      <header className="rounded-2xl bg-botanical p-5 text-surface">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-sans text-sm font-semibold">Version {current.version_number}</p>
            <p className="mt-1 font-sans text-xs text-sage">
              Finalized by {current.finalized_by} · {fmt(current.finalized_at)}
            </p>
          </div>
          <StatusBadge status={rx.status} />
        </div>
      </header>

      {!amending && (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
            Medicines
          </p>
          <ul className="mt-3 space-y-3">
            {current.items.map((it, i) => (
              <li key={i} className="rounded-xl border border-hairline p-3">
                <p className="font-sans text-sm font-semibold">{it.medicine_name}</p>
                <p className="mt-1 font-sans text-sm text-graphite">
                  {[it.strength, it.dose, it.route, it.frequency, it.timing, it.duration]
                    .filter(Boolean)
                    .join(" · ") || "No details"}
                </p>
                {it.instructions && (
                  <p className="mt-1 font-sans text-xs text-graphite">{it.instructions}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {amending && (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-sm font-semibold">New version</p>
          <label className="mt-2 block font-sans text-sm font-medium">Reason for change</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base"
          />
          <div className="mt-4">
            <MedicineEditor items={items} onChange={setItems} />
          </div>
        </section>
      )}

      {rx.versions.length > 1 && !amending && (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
            Version history
          </p>
          <ul className="mt-2 space-y-2">
            {rx.versions.map((v) => (
              <li key={v.version_number} className="flex items-center justify-between font-sans text-sm">
                <span>
                  v{v.version_number}
                  {v.amendment_reason ? ` — ${v.amendment_reason}` : ""}
                </span>
                <span className="font-mono text-xs text-graphite">{fmt(v.finalized_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}

      {amending ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setAmending(false)}
            className="flex-1 rounded-full border border-hairline px-4 py-3 font-sans text-base font-semibold text-graphite"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={amend}
            disabled={busy}
            className="flex-1 rounded-full bg-botanical px-4 py-3 font-sans text-base font-semibold text-surface disabled:opacity-60"
          >
            Create new version
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={print}
            className="flex-1 rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite"
          >
            Print / PDF
          </button>
          <button
            type="button"
            onClick={beginAmend}
            className="flex-1 rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical"
          >
            Amend
          </button>
        </div>
      )}
    </WorkspaceShell>
  );
}
