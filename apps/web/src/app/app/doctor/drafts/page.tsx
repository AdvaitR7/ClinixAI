"use client";

import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PrescriptionDraftView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor" },
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

/** Page 19 — Prescription draft queue (SCREEN_CATALOG §7, Figma 59:2). */
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

  const rawList = state.status === "ready" ? state.data : [];
  const needsReviewCount = rawList.filter((d) => d.status === "NEEDS_REVIEW").length;
  const highRiskCount = rawList.filter((d) => Array.isArray(d.risk_flags) && d.risk_flags.length > 0).length;

  const ranked = rawList
    .filter((d) => !filter || d.status === filter)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));

  return (
    <WorkspaceShell workspace="Doctor" title="Prescription draft queue" nav={nav}>
      {/* Metrics summary banner (Figma 59:2) */}
      <section className="grid grid-cols-3 gap-2.5">
        <div className="clinix-doctor-card p-3 text-center">
          <p className="font-mono text-xl font-bold text-surface">{rawList.length}</p>
          <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wider text-copper">Total drafts</p>
        </div>
        <div className="clinix-doctor-card p-3 text-center">
          <p className="font-mono text-xl font-bold text-surface">{needsReviewCount}</p>
          <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wider text-copper">Needs review</p>
        </div>
        <div className="clinix-doctor-card p-3 text-center">
          <p className="font-mono text-xl font-bold text-critical">{highRiskCount}</p>
          <p className="mt-1 font-sans text-[9px] font-bold uppercase tracking-wider text-critical">High ambiguity</p>
        </div>
      </section>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2" aria-label="Filter drafts by status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f ?? "all"}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-10 rounded-full border px-4 font-sans text-xs font-semibold ${
              filter === f ? "border-copper bg-copper text-ink" : "border-white/10 text-doctor-muted/75"
            }`}
          >
            {f ? f.replace(/_/g, " ") : "All drafts"}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && <p role="alert" className="font-sans text-sm text-critical">{state.error}</p>}

      {state.status === "ready" &&
        (ranked.length === 0 ? (
          <section className="clinix-doctor-card p-6 text-center">
            <p className="font-sans text-sm font-semibold text-surface">No prescription drafts</p>
            <p className="mt-1 font-sans text-xs text-doctor-muted/70">Drafts generated via OCR or direct entry will appear here for review.</p>
          </section>
        ) : (
          <ul className="space-y-3.5">
            {ranked.map((d) => {
              const reviewCount = d.items.filter((i) => i.needs_review).length;
              const flags = Array.isArray(d.risk_flags) ? (d.risk_flags as string[]) : [];
              return (
                <li key={d.id} className="clinix-doctor-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-sans text-base font-bold text-surface">{d.patient_name}</p>
                      <p className="mt-1 font-sans text-xs text-doctor-muted/70">
                        {d.source} draft · {d.items.length} medicine{d.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {d.overall_confidence != null && (
                      <ConfidenceBadge value={d.overall_confidence} />
                    )}
                    {reviewCount > 0 && (
                      <span className="rounded-full border border-review/60 bg-review/15 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-review">
                        {reviewCount} field{reviewCount === 1 ? "" : "s"} need review
                      </span>
                    )}
                  </div>

                  {flags.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-xl border border-critical/30 bg-critical/10 p-2.5">
                      {flags.map((f, i) => (
                        <li key={i} className="font-sans text-xs font-semibold text-critical">
                          ⚠ {f}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5 flex gap-2.5 border-t border-white/5 pt-3.5">
                    <button
                      type="button"
                      onClick={() => router.push(`/app/doctor/prescription-drafts/${d.id}`)}
                      className="min-h-10 flex-1 rounded-xl bg-copper px-4 font-sans text-xs font-semibold uppercase text-ink transition-transform active:translate-y-px"
                    >
                      Review draft →
                    </button>
                    {d.status !== "APPROVED" && (
                      <button
                        type="button"
                        disabled={busy === d.id}
                        onClick={() => {
                          if (window.confirm("Delete this draft?")) void del(d.id);
                        }}
                        className="min-h-10 rounded-xl border border-critical/40 bg-critical/10 px-4 font-sans text-xs font-semibold text-critical disabled:opacity-60"
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
