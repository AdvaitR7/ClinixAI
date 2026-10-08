"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PrescriptionDraftView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts", active: true },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

const STATUS_FILTERS = [null, "DRAFT", "NEEDS_REVIEW", "APPROVED"] as const;

/** Safety ambiguity first: NEEDS_REVIEW with risk flags → NEEDS_REVIEW → DRAFT → rest. */
function rank(d: PrescriptionDraftView): number {
  const risk = Array.isArray(d.risk_flags) && d.risk_flags.length > 0;
  if (d.status === "NEEDS_REVIEW" && risk) return 0;
  if (d.status === "NEEDS_REVIEW") return 1;
  if (d.status === "DRAFT") return 2;
  return 3;
}

/** Page 19 — Prescription draft queue (SCREEN_CATALOG §7). */
export default function DraftsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const state = useApiData<PrescriptionDraftView[]>("/doctor/prescription-drafts");
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function del(id: string) {
    setBusy(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/prescription-drafts/${id}`, { method: "DELETE" });
      await state.refresh();
    } finally {
      setBusy(null);
    }
  }

  const ranked = (state.status === "ready" ? state.data : [])
    .filter((d) => !filter || d.status === filter)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription drafts" nav={nav}>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f ?? "all"}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 font-sans text-xs font-semibold ${
              filter === f ? "border-copper text-copper" : "border-hairline text-graphite"
            }`}
          >
            {f ?? "All"}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && <p className="font-sans text-sm text-critical">{state.error}</p>}

      {state.status === "ready" &&
        (ranked.length === 0 ? (
          <p className="font-sans text-sm text-graphite">No prescription drafts.</p>
        ) : (
          <ul className="space-y-3">
            {ranked.map((d) => {
              const reviewCount = d.items.filter((i) => i.needs_review).length;
              const flags = Array.isArray(d.risk_flags) ? (d.risk_flags as string[]) : [];
              return (
                <li key={d.id} className="rounded-2xl border border-hairline bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-sans text-sm font-semibold">{d.patient_name}</p>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="mt-1 font-sans text-xs text-graphite">
                    {d.source} · {d.items.length} medicine{d.items.length === 1 ? "" : "s"}
                  </p>
                  {d.overall_confidence != null && (
                    <div className="mt-2">
                      <ConfidenceBadge value={d.overall_confidence} />
                    </div>
                  )}
                  {reviewCount > 0 && (
                    <p className="mt-1 font-sans text-xs font-semibold text-review">
                      {reviewCount} field{reviewCount === 1 ? "" : "s"} need{reviewCount === 1 ? "s" : ""} review
                    </p>
                  )}
                  {flags.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {flags.map((f, i) => (
                        <li key={i} className="font-sans text-xs font-semibold text-critical">
                          ⚠ {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/app/doctor/prescription-drafts/${d.id}`)}
                      className="rounded-full bg-botanical px-4 py-1.5 font-sans text-xs font-semibold text-surface"
                    >
                      Review
                    </button>
                    {d.status !== "APPROVED" && (
                      <button
                        type="button"
                        disabled={busy === d.id}
                        onClick={() => {
                          if (window.confirm("Delete this draft?")) void del(d.id);
                        }}
                        className="rounded-full border border-hairline px-4 py-1.5 font-sans text-xs font-semibold text-critical disabled:opacity-60"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </WorkspaceShell>
  );
}
