"use client";

import Link from "next/link";
import { useState } from "react";
import type { DoctorDirectoryEntry } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/patients", disabled: true },
];

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
      <header><p className="clinix-label text-copper">Clinic record · Patient directory</p><h1 className="mt-2 font-sans text-[28px] font-semibold text-surface">Patient directory</h1></header>
      <section className="clinix-doctor-card border-copper p-4">
        <p className="clinix-label text-copper">Access boundary</p>
        <p className="mt-2 font-sans text-xs leading-5 text-doctor-muted/75">
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
          className="min-h-[54px] min-w-0 flex-1 rounded-[1.125rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm text-surface placeholder:text-doctor-muted/50"
        />
        <Link href="/app/doctor/patients/new" className="grid min-h-[54px] shrink-0 place-items-center rounded-[1.125rem] bg-copper px-4 font-sans text-sm font-semibold text-ink">
          Add
        </Link>
      </div>

      <div className="flex gap-2" aria-label="Directory filters">
        {["recent", "upcoming", "follow-ups", "unclaimed"].map((value) => (
          <button key={value} type="button" disabled={value === "follow-ups"} title={value === "follow-ups" ? "Follow-up service is not available" : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-full border px-3 font-sans text-xs font-semibold capitalize disabled:opacity-35 ${filter === value ? "border-copper bg-copper text-ink" : "border-white/10 text-doctor-muted/75"}`}>{value}</button>
        ))}
      </div>

      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-52 rounded-[1.35rem]" />
          <Skeleton className="h-52 rounded-[1.35rem]" />
        </div>
      )}
      {state.status === "error" && <div role="alert" className="font-sans text-sm text-surface"><p>{state.error}</p><button type="button" onClick={() => state.refresh()} className="mt-2 min-h-11 text-copper underline">Retry directory</button></div>}
      {state.status === "ready" && state.data.length === 0 && (
        <section className="clinix-doctor-card p-5">
          <p className="font-sans text-sm font-semibold text-surface">No patients found</p>
          <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/65">Clear the search or add a clinic-managed patient record.</p>
        </section>
      )}
      {state.status === "ready" && state.data.length > 0 && (
        <>
          <section className="clinix-doctor-card flex items-center justify-between p-4">
            <div>
              <p className="clinix-label text-copper">Directory summary</p>
              <p className="mt-1 font-sans text-sm text-doctor-muted/70">Records matching current access</p>
            </div>
            <p className="font-mono text-2xl font-bold text-surface">{state.data.length}</p>
          </section>
          <ul className="space-y-3">
            {state.data.map((patient) => (
              <li key={patient.patient_id}>
                <Link href={`/app/doctor/patients/${patient.patient_id}/context`} className="block min-h-44 rounded-[22px] border border-copper bg-graphite p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-copper font-sans text-sm font-bold text-ink">
                        {patient.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-sans text-lg font-semibold text-surface">{patient.full_name}</p>
                        <p className="mt-1 break-all font-mono text-xs text-doctor-muted/65">{patient.patient_id} · Mobile ending {patient.phone.slice(-4) || "not recorded"}</p>
                      </div>
                    </div>
                    <StatusBadge status={patient.status} />
                  </div>
                  <p className="mt-3 font-sans text-xs text-surface">Next: {patient.next_appointment_at ? new Date(patient.next_appointment_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "No appointment scheduled"}</p>
                  <p className="mt-2 font-sans text-xs text-doctor-muted">Allergy status not confirmed</p>
                  <p className="mt-3 font-sans text-xs text-evidence">Open workspace →</p>
                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                    <div>
                      <p className="clinix-label text-doctor-muted/45">Relationship</p>
                      <p className="mt-1 font-sans text-xs text-surface">{patient.relationship_status === "ACTIVE" ? "In your care" : patient.relationship_status ?? "Not recorded"}</p>
                    </div>
                    <div>
                      <p className="clinix-label text-doctor-muted/45">Last seen</p>
                      <p className="mt-1 font-mono text-xs text-surface">
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

      <Link href="/app/doctor/patients/new" className="clinix-doctor-card flex min-h-24 items-center justify-between border-copper p-5 font-sans text-sm font-semibold text-surface">
        Create unclaimed patient record <span aria-hidden="true" className="text-xl text-copper">→</span>
      </Link>
    </WorkspaceShell>
  );
}
