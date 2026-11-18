"use client";

import Link from "next/link";
import { useState } from "react";
import type { DoctorDirectoryEntry } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";
import { doctorNav } from "@/lib/workspace-nav";

const nav = doctorNav("patients");

/** Page 16 — Patient Directory (SCREEN_CATALOG §7). */
export default function DirectoryPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("recent");
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (filter !== "recent") params.set("filter", filter);
  const state = useApiData<DoctorDirectoryEntry[]>(`/doctor/patients${params.size ? `?${params.toString()}` : ""}`);

  return (
    <WorkspaceShell workspace="Doctor" title="Patient directory" nav={nav} focused hideHeading>
      <header><p className="clinix-label text-clear-action">Clinic record · Patient directory</p><h1 className="mt-2 font-sans text-[28px] font-semibold text-clear-ink">Patient directory</h1></header>
      <section className="clear-card border-clear-divider p-4">
        <p className="clinix-label text-clear-action">Access boundary</p>
        <p className="mt-2 font-sans text-xs leading-5 text-clear-secondary">
          Open only records connected to your care relationship. Access is recorded.
        </p>
      </section>

      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, phone, patient ID"
          aria-label="Search patient directory"
          className="min-h-[54px] min-w-0 flex-1 rounded-[1.125rem] border border-clear-divider bg-clear-surface px-4 font-sans text-sm text-clear-ink placeholder:text-clear-secondary"
        />
        <Link href="/app/doctor/patients/new" className="grid min-h-[54px] shrink-0 place-items-center rounded-[1.125rem] bg-clear-action px-4 font-sans text-sm font-semibold text-white">
          Add
        </Link>
      </div>

      <div className="flex gap-2" aria-label="Directory filters">
        {["recent", "upcoming", "follow-ups", "unclaimed"].map((value) => (
          <button key={value} type="button" disabled={value === "follow-ups"} title={value === "follow-ups" ? "Follow-up service is not available" : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-full border px-3 font-sans text-xs font-semibold capitalize disabled:opacity-35 ${filter === value ? "border-clear-divider bg-clear-action text-white" : "border-clear-divider text-clear-secondary"}`}>{value}</button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-52 rounded-[1.35rem]" />
          <Skeleton className="h-52 rounded-[1.35rem]" />
        </div>
      )}
      {state.status === "error" && <div role="alert" className="font-sans text-sm text-clear-ink"><p>{state.error}</p><button type="button" onClick={() => state.refresh()} className="mt-2 min-h-11 text-clear-action underline">Retry directory</button></div>}
      {state.status === "ready" && state.data.length === 0 && (
        <section className="clear-card p-5">
          <p className="font-sans text-sm font-semibold text-clear-ink">No patients found</p>
          <p className="mt-1 font-sans text-xs leading-5 text-clear-secondary">Clear the search or add a clinic-managed patient record.</p>
        </section>
      )}
      {state.status === "ready" && state.data.length > 0 && (
        <>
          <section className="clear-card flex items-center justify-between p-4">
            <div>
              <p className="clinix-label text-clear-action">Directory summary</p>
              <p className="mt-1 font-sans text-sm text-clear-secondary">Records matching current access</p>
            </div>
            <p className="font-sans tabular-nums text-2xl font-bold text-clear-ink">{state.data.length}</p>
          </section>
          <ul className="space-y-3">
            {state.data.map((patient) => (
              <li key={patient.patient_id}>
                <Link href={recordHref("/app/doctor/patients", "patientId", patient.patient_id, {}, "/context")} className="block min-h-44 rounded-[22px] border border-clear-divider bg-clear-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-clear-action font-sans text-sm font-bold text-white">
                        {patient.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-sans text-lg font-semibold text-clear-ink">{patient.full_name}</p>
                        <p className="mt-1 break-all font-sans tabular-nums text-xs text-clear-secondary">{patient.patient_id} · Mobile ending {patient.phone.slice(-4) || "not recorded"}</p>
                      </div>
                    </div>
                    <StatusBadge status={patient.status} />
                  </div>
                  <p className="mt-3 font-sans text-xs text-clear-ink">Next: {patient.next_appointment_at ? new Date(patient.next_appointment_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "No appointment scheduled"}</p>
                  <p className="mt-2 font-sans text-xs text-clear-secondary">Allergy status not confirmed</p>
                  <p className="mt-3 font-sans text-xs text-clear-info">Open workspace →</p>
                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-clear-divider pt-4">
                    <div>
                      <p className="clinix-label text-clear-secondary">Relationship</p>
                      <p className="mt-1 font-sans text-xs text-clear-ink">{patient.relationship_status === "ACTIVE" ? "In your care" : patient.relationship_status ?? "Not recorded"}</p>
                    </div>
                    <div>
                      <p className="clinix-label text-clear-secondary">Last seen</p>
                      <p className="mt-1 font-sans tabular-nums text-xs text-clear-ink">
                        {patient.last_encounter_at ? new Date(patient.last_encounter_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "Not recorded"}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/app/doctor/patients/new" className="clear-card flex min-h-24 items-center justify-between border-clear-divider p-5 font-sans text-sm font-semibold text-clear-ink">
        Create unclaimed patient record <span aria-hidden="true" className="text-xl text-clear-action">→</span>
      </Link>
    </WorkspaceShell>
  );
}
