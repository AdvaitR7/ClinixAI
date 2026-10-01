"use client";

import Link from "next/link";
import { useState } from "react";
import type { DoctorDirectoryEntry } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/patients", disabled: true },
  { label: "Follow-ups", href: "/app/doctor/patients", disabled: true },
];

/** Page 16 — Patient Directory (SCREEN_CATALOG §7). */
export default function DirectoryPage() {
  const [q, setQ] = useState("");
  const [unclaimed, setUnclaimed] = useState(false);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (unclaimed) params.set("filter", "unclaimed");
  const path = `/doctor/patients${params.size ? `?${params.toString()}` : ""}`;

  const state = useApiData<DoctorDirectoryEntry[]>(path);

  return (
    <WorkspaceShell workspace="Doctor" title="Patients" nav={nav}>
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or mobile"
          className="h-11 flex-1 rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
        />
        <button
          type="button"
          onClick={() => setUnclaimed((v) => !v)}
          className={`h-11 rounded-xl border px-3 font-sans text-sm font-semibold ${
            unclaimed ? "border-copper text-copper" : "border-hairline text-graphite"
          }`}
        >
          Unclaimed
        </button>
      </div>

      <Link
        href="/app/doctor/patients/new"
        className="block rounded-full bg-copper px-4 py-3 text-center font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
      >
        Add patient
      </Link>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && (
        <p className="font-sans text-sm text-critical">{state.error}</p>
      )}

      {state.status === "ready" && state.data.length === 0 && (
        <p className="font-sans text-sm text-graphite">No patients found.</p>
      )}

      {state.status === "ready" && state.data.length > 0 && (
        <ul className="space-y-2">
          {state.data.map((p) => (
            <li key={p.patient_id}>
              <Link
                href={`/app/doctor/patients/${p.patient_id}`}
                className="block rounded-2xl border border-hairline bg-surface p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="font-sans text-base font-semibold">{p.full_name}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 font-sans text-sm text-graphite">
                  {p.phone}
                  {p.sex_at_registration ? ` · ${p.sex_at_registration}` : ""}
                </p>
                <p className="mt-1 font-sans text-xs text-graphite">
                  {p.relationship_status === "ACTIVE"
                    ? "In your care"
                    : `Relationship: ${p.relationship_status ?? "—"}`}
                  {p.last_encounter_at
                    ? ` · last seen ${new Date(p.last_encounter_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}`
                    : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceShell>
  );
}
