"use client";


import { useRouteParam } from "@/lib/route-params";

import { createIdentityObjectUrl, useAuth } from "@/lib/auth";

import { useEffect, useRef, useState } from "react";
import type { PrescriptionItemInput, PrescriptionView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MedicineEditor } from "@/components/medicine-editor";
import { fetchApi, fetchApiBlob, useApiData } from "@/lib/api";
import { openOrSharePdf } from "@/lib/native";

const nav = [
  { label: "Desk", href: "/app/doctor" },
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
  const params = { prescriptionId: useRouteParam("prescriptionId") };
  const { getToken } = useAuth();
  const state = useApiData<PrescriptionView>(
    params.prescriptionId ? `/doctor/prescriptions/${params.prescriptionId}` : null,
  );

  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<PrescriptionItemInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pdfUrls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of pdfUrls.current) URL.revokeObjectURL(url);
    pdfUrls.current.clear();
  }, []);

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

  /** Renders the prescription PDF and opens a temporary account-scoped URL. */
  async function print() {
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const blob = await fetchApiBlob(
        token,
        `/doctor/prescriptions/${params.prescriptionId}/render`,
        { method: "POST" },
      );
      const url = createIdentityObjectUrl(blob);
      pdfUrls.current.add(url);
      await openOrSharePdf(blob, url, `prescription-${params.prescriptionId}.pdf`);
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
        <section className="clear-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      </WorkspaceShell>
    );
  }

  const rx = state.data;
  const current = rx.current_version;

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription record" nav={nav}>
      <header className="clear-card border-clear-divider p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-clear-action">Immutable record</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-clear-ink">Version {current.version_number}</h2>
            <p className="mt-1 font-sans tabular-nums text-xs text-clear-secondary">
              Finalized by {current.finalized_by} · {fmt(current.finalized_at)}
            </p>
          </div>
          <StatusBadge status={rx.status} />
        </div>
      </header>

      {!amending && (
        <section className="clear-card p-5">
          <div className="flex items-center justify-between border-b border-clear-divider pb-3">
            <p className="clinix-label text-clear-action">Prescribed medicines</p>
            <span className="font-sans tabular-nums text-xs text-clear-secondary">{current.items.length} items</span>
          </div>
          <ul className="mt-3 space-y-3">
            {current.items.map((it, i) => (
              <li key={i} className="rounded-xl border border-clear-divider bg-clear-canvas p-3.5">
                <p className="font-sans text-sm font-semibold text-clear-ink">{it.medicine_name}</p>
                <p className="mt-1 font-sans text-xs text-clear-secondary">
                  {[it.strength, it.dose, it.route, it.frequency, it.timing, it.duration]
                    .filter(Boolean)
                    .join(" · ") || "No details"}
                </p>
                {it.instructions && (
                  <p className="mt-1.5 font-sans text-xs text-clear-secondary">{it.instructions}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {amending && (
        <section className="clear-card border-clear-divider p-5">
          <div className="border-b border-clear-divider pb-3">
            <p className="clinix-label text-clear-action">Amend prescription</p>
            <h3 className="mt-1 font-sans text-base font-bold text-clear-ink">Authoring Version {current.version_number + 1}</h3>
          </div>
          <div className="mt-4">
            <label className="block font-sans text-xs font-semibold uppercase tracking-wider text-clear-secondary">
              Reason for amendment *
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Clinical reason for this revision"
              className="mt-1.5 min-h-[46px] w-full rounded-xl border border-clear-divider bg-clear-surface px-3 font-sans text-sm text-clear-ink outline-none focus:border-clear-action"
            />
          </div>
          <div className="mt-5">
            <MedicineEditor items={items} onChange={setItems} />
          </div>
        </section>
      )}

      {rx.versions.length > 1 && !amending && (
        <section className="clear-card p-5">
          <p className="clinix-label text-clear-action">Version history</p>
          <ul className="mt-3 space-y-2">
            {rx.versions.map((v) => (
              <li key={v.version_number} className="flex items-center justify-between border-t border-clear-divider py-2 font-sans text-xs">
                <span className="text-clear-ink">
                  <span className="font-bold text-clear-action">v{v.version_number}</span>
                  {v.amendment_reason ? ` — ${v.amendment_reason}` : " — Initial finalization"}
                </span>
                <span className="font-sans tabular-nums text-xs text-clear-secondary">{fmt(v.finalized_at)}</span>
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
            className="min-h-12 flex-1 rounded-[1.25rem] border border-clear-divider bg-clear-surface font-sans text-xs font-semibold uppercase text-clear-ink"
          >
            Cancel amendment
          </button>
          <button
            type="button"
            onClick={amend}
            disabled={busy}
            className="min-h-12 flex-1 rounded-[1.25rem] bg-clear-action font-sans text-xs font-semibold uppercase text-white transition-transform active:translate-y-px disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save new version"}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={print}
            className="min-h-12 flex-1 rounded-[1.25rem] border border-clear-divider bg-clear-surface font-sans text-xs font-semibold uppercase tracking-wider text-clear-ink transition-transform active:translate-y-px"
          >
            Print / PDF
          </button>
          <button
            type="button"
            onClick={beginAmend}
            className="min-h-12 flex-1 rounded-[1.25rem] bg-clear-action font-sans text-xs font-semibold uppercase tracking-wider text-white transition-transform active:translate-y-px"
          >
            Amend prescription
          </button>
        </div>
      )}
    </WorkspaceShell>
  );
}
