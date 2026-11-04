"use client";


import { useRouteParam } from "@/lib/route-params";

import Link from "next/link";

import type { PrescriptionDraftView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

/** Printable preview of the saved draft; clearly not a finalized record and never changes the draft. */
export default function PrescriptionPreviewPage() {
  const draftId = useRouteParam("draftId");
  const state = useApiData<PrescriptionDraftView>(draftId ? `/doctor/prescription-drafts/${draftId}` : null);
  const back = recordHref("/app/doctor/prescription-drafts", "draftId", draftId);
  return (
    <WorkspaceShell workspace="Doctor" title="Prescription preview" nav={nav}>
      {state.status === "loading" && <Skeleton className="h-40 rounded-2xl" />}
      {state.status === "error" && (
        <section role="alert" className="clinix-doctor-card p-5 font-sans text-sm text-critical">
          <p>{state.error}</p>
          <button type="button" onClick={() => void state.refresh()} className="mt-2 min-h-11 text-xs font-semibold text-copper underline">Retry preview</button>
        </section>
      )}
      {state.status === "ready" && (
        <>
          <div className="flex flex-wrap gap-3 print:hidden">
            <Link href={back} className="flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-doctor-panel font-sans text-xs font-semibold uppercase text-surface">Back to draft</Link>
            <button type="button" onClick={() => window.print()} className="min-h-12 flex-1 rounded-2xl bg-copper font-sans text-xs font-semibold uppercase text-ink">Print preview</button>
          </div>
          <article aria-label="Printable prescription preview" className="rounded-2xl border border-copper bg-white p-6 font-sans text-ink">
            <p className="text-[11px] font-bold uppercase tracking-widest text-critical">
              {state.data.status === "APPROVED" ? "Finalized draft" : "Draft preview — not a finalized prescription"}
            </p>
            <h2 className="mt-3 text-2xl font-bold">{state.data.patient_name || "Patient name unavailable"}</h2>
            <p className="mt-1 text-xs">Provenance: {state.data.source} · Saved medicines: {state.data.items.length}</p>
            <ol className="mt-5 space-y-4">
              {state.data.items.map((item, index) => (
                <li key={item.id} className="border-t border-ink/20 pt-3">
                  <p className="text-sm font-semibold">{index + 1}. {item.medicine_name}</p>
                  <p className="mt-1 break-words text-xs">{[item.strength, item.dose, item.route, item.frequency, item.timing, item.duration].filter(Boolean).join(" · ") || "No dosing fields entered"}</p>
                  {item.instructions && <p className="mt-1 break-words text-xs">{item.instructions}</p>}
                  {item.needs_review && <p className="mt-1 text-xs font-bold text-critical">Unconfirmed — compare with the source before finalizing.</p>}
                </li>
              ))}
            </ol>
            <p className="mt-6 text-[11px]">Shows the last saved draft. Unsaved edits appear only after saving.</p>
          </article>
        </>
      )}
    </WorkspaceShell>
  );
}
