"use client";

import Link from "next/link";
import { useState } from "react";
import type { DetailedTimelineItem, TimelineFilter } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient/timeline", active: true },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/care" },
  { label: "You", href: "/settings" },
];

const FILTER_OPTIONS: Array<{ label: string; value: TimelineFilter }> = [
  { label: "All", value: "ALL" },
  { label: "Doctor Visits", value: "DOCTOR_VISITS" },
  { label: "AI Check-ins", value: "AI_CHECKINS" },
  { label: "Lab Reports", value: "LAB_REPORTS" },
  { label: "Prescriptions", value: "PRESCRIPTIONS" },
];

export default function PatientTimelinePage() {
  const [selectedFilter, setSelectedFilter] = useState<TimelineFilter>("ALL");

  const queryPath =
    selectedFilter === "ALL"
      ? "/patients/self/timeline"
      : `/patients/self/timeline?filter=${selectedFilter}`;

  const state = useApiData<{ entries: DetailedTimelineItem[] }>(queryPath);

  return (
    <WorkspaceShell workspace="patient" title="Health Timeline" nav={nav}>
      <div className="mx-auto max-w-[393px] pb-24">
        {/* Eyebrow & Headline */}
        <p className="font-sans text-[9px] font-semibold tracking-widest text-graphite uppercase">
          PATIENT RECORD · LONGITUDINAL VIEW
        </p>
        <h1 className="mt-1 font-sans text-[30px] font-bold leading-tight text-ink">
          Health timeline
        </h1>
        <p className="mt-1.5 font-sans text-xs leading-relaxed text-graphite">
          Encounters grouped into chapters, with provenance and source links preserved.
        </p>

        {/* Count summary */}
        {state.status === "ready" && (
          <p className="mt-2 font-mono text-[10px] font-semibold text-botanical">
            {state.data.entries.length} entries · All recorded history
          </p>
        )}

        {/* Filter Pills */}
        <div className="mt-5">
          <p className="font-sans text-[10px] font-semibold tracking-wider text-graphite uppercase">
            FILTER RECORDS
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((f) => {
              const active = selectedFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setSelectedFilter(f.value)}
                  className={`rounded-full px-3.5 py-1.5 font-sans text-xs font-semibold transition-colors ${
                    active
                      ? "bg-botanical text-surface shadow-sm"
                      : "border border-sage bg-surface text-graphite hover:bg-canvas"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Loading State */}
        {state.status === "loading" && (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        )}

        {/* Error State */}
        {state.status === "error" && (
          <div className="mt-8 rounded-2xl bg-critical/10 p-5 text-center">
            <p className="font-sans text-xs font-semibold text-critical">
              {state.error}
            </p>
            <button
              type="button"
            onClick={() => void state.refresh()}
              className="mt-3 rounded-lg bg-critical px-4 py-1.5 font-sans text-xs font-semibold text-surface"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {state.status === "ready" && state.data.entries.length === 0 && (
          <div className="mt-10 rounded-2xl border border-dashed border-sage bg-surface p-8 text-center">
            <p className="font-sans text-sm font-semibold text-ink">
              No entries match this filter
            </p>
            <p className="mt-1 font-sans text-xs text-graphite">
              Try selecting &ldquo;All&rdquo; or starting a new symptom check-in.
            </p>
            <Link
              href="/app/patient/checkin"
              className="mt-4 inline-block rounded-xl bg-botanical px-5 py-2 font-sans text-xs font-semibold text-surface"
            >
              Start check-in
            </Link>
          </div>
        )}

        {/* Vertical Evidence Spine & Chronological Cards */}
        {state.status === "ready" && state.data.entries.length > 0 && (
          <div className="relative mt-8">
            {/* The Vertical Evidence Spine Line */}
            <div
              className="absolute bottom-4 left-[46px] top-4 w-[2px] rounded-full bg-sage/55"
              aria-hidden="true"
            />

            <div className="space-y-6">
              {state.data.entries.map((item, idx) => {
                const prevItem = state.data.entries[idx - 1];
                const showChapter = !prevItem || prevItem.chapter !== item.chapter;

                return (
                  <div key={item.id} className="relative">
                    {/* Chapter Header */}
                    {showChapter && (
                      <p className="mb-4 font-sans text-[11px] font-bold tracking-wider text-botanical uppercase">
                        {item.chapter}
                      </p>
                    )}

                    <div className="flex items-start gap-3">
                      {/* Left: Date & Spine Dot */}
                      <div className="flex w-[48px] shrink-0 items-center justify-between pt-3">
                        <div className="text-center font-sans text-[11px] font-semibold leading-tight text-graphite">
                          <p>{item.date_formatted.split(" ")[0]}</p>
                          <p className="text-[10px] text-graphite/70">
                            {item.date_formatted.split(" ")[1]}
                          </p>
                        </div>
                        {/* Dot on Spine */}
                        <div
                          className={`z-10 size-3 rounded-full border-2 border-surface ${
                            item.is_ai_derived
                              ? "bg-evidence shadow-[0_0_6px_rgba(165,195,255,0.6)]"
                              : item.provenance === "DOCTOR_AUTHORED"
                              ? "bg-botanical"
                              : item.provenance === "SOURCE_DOCUMENT_DERIVED"
                              ? "bg-copper"
                              : "bg-sage"
                          }`}
                        />
                      </div>

                      {/* Right: Card */}
                      <div
                        className={`flex-1 rounded-[20px] p-4 shadow-sm transition-all ${
                          item.is_ai_derived
                            ? "border-2 border-dashed border-evidence/60 bg-evidence/5"
                            : "border border-sage/60 bg-surface"
                        }`}
                      >
                        {/* Header Row: Label & Provenance Chip */}
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-[9px] font-semibold tracking-wider text-graphite uppercase">
                            {item.type.replace("_", " ")}
                          </span>

                          <span
                            className={`rounded-full px-2 py-0.5 font-sans text-[8px] font-bold tracking-wider uppercase ${
                              item.provenance === "AI_DERIVED"
                                ? "border border-evidence bg-evidence/20 text-botanical"
                                : item.provenance === "DOCTOR_AUTHORED"
                                ? "border border-evidence-blue text-evidence"
                                : item.provenance === "SOURCE_DOCUMENT_DERIVED"
                                ? "border border-copper text-copper"
                                : "border border-sage text-graphite"
                            }`}
                          >
                            {item.provenance.replace("_", " ")}
                          </span>
                        </div>

                        {/* Title & Summary */}
                        <h2 className="mt-2 font-sans text-base font-semibold text-ink">
                          {item.title}
                        </h2>
                        <p className="mt-1 font-sans text-xs leading-relaxed text-graphite">
                          {item.summary}
                        </p>

                        {/* Card Deep Link */}
                        <div className="mt-3 flex items-center justify-between border-t border-hairline/60 pt-2">
                          {item.type === "AI_CHECKIN" && typeof item.metadata?.ai_session_id === "string" ? (
                            <Link href={recordHref("/app/patient/timeline/checkins", "sessionId", item.metadata.ai_session_id)} className="inline-flex min-h-11 items-center font-sans text-[10px] font-semibold text-evidence">View details &amp; sources →</Link>
                          ) : (
                            <span className="font-sans text-[10px] font-semibold text-evidence">View details &amp; sources →</span>
                          )}
                          <span className="font-sans text-lg text-botanical/60">›</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend Banner */}
        <div className="mt-10 rounded-[16px] bg-surface p-3.5 text-center shadow-sm">
          <p className="font-sans text-[10px] font-medium text-graphite">
            Provenance is always labeled: Patient-asserted · Doctor-authored · AI-derived
          </p>
        </div>
      </div>
    </WorkspaceShell>
  );
}
