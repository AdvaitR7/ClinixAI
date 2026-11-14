"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiData, useMe } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useApiWrite } from "@/lib/staff";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/followups" },
];
const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";
const field = "min-h-11 w-full rounded-xl border border-clear-divider bg-clear-surface px-3 text-sm";

type Practice = { practice_id: string; name: string; phone: string | null; address: string | null; can_edit: boolean };

/** Page 25d — practice name, phone and address; owner edits, practice doctors read (FigCraft frame 5892). */
export default function PracticeSettingsPage() {
  const me = useMe();
  const manager = me.status === "ready" ? (me.me.memberships ?? []).find((m) => m.role === "OWNER" || m.role === "DOCTOR") : undefined;
  const practice = useApiData<Practice>(manager ? `/practices/${manager.practice_id}` : null);
  return (
    <WorkspaceShell workspace="Doctor" title="Practice settings" nav={nav} focused hideHeading>
      <Link href="/app/doctor/team" className="min-h-11 text-xs text-clear-info">← Practice team</Link>
      <div>
        <p className={label}>Practice owner · settings</p>
        <h1 className="mt-2 text-[28px] leading-tight">{manager?.practice_name ?? "Practice settings"}</h1>
      </div>
      {me.status === "ready" && !manager && <p className={`${card} text-sm`} role="status">You are not a member of a practice.</p>}
      {practice.status === "loading" && manager && <p role="status" className="text-sm">Loading…</p>}
      {practice.status === "error" && <p role="alert" className="text-sm">{practice.error}</p>}
      {practice.status === "ready" && <PracticeForm initial={practice.data} />}
      <section className={card}>
        <p className="text-sm font-semibold">Record governance owner</p>
        <p className="mt-1 text-xs text-clear-secondary">Removal and retention requests route to the owner and authorized doctors. Staff can route a request but cannot decide it.</p>
        <Link href="/app/doctor/requests" className="mt-2 inline-flex min-h-11 items-center text-xs text-clear-info">Open removal requests →</Link>
      </section>
    </WorkspaceShell>
  );
}

/** Practice form seeded once from the loaded record. */
function PracticeForm({ initial }: { initial: Practice }) {
  const write = useApiWrite();
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  /** Saves identity fields (owner only). */
  async function save() {
    setStatus("saving");
    try {
      await write(`/practices/${draft.practice_id}`, "PUT", { name: draft.name, phone: draft.phone ?? undefined, address: draft.address ?? undefined });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className={card}>
      <p className={label}>Practice name and location</p>
      <label className="mt-2 block text-xs">Name<input value={draft.name} disabled={!draft.can_edit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${field} mt-1`} /></label>
      <label className="mt-3 block text-xs">Phone<input value={draft.phone ?? ""} disabled={!draft.can_edit} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={`${field} mt-1`} /></label>
      <label className="mt-3 block text-xs">Address<input value={draft.address ?? ""} disabled={!draft.can_edit} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className={`${field} mt-1`} /></label>
      {draft.can_edit ? (
        <button type="button" disabled={status === "saving" || draft.name.trim().length < 2} onClick={() => void save()} className="mt-3 min-h-12 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Save settings</button>
      ) : (
        <p className="mt-3 text-xs text-clear-secondary">Editable by the practice owner only.</p>
      )}
      {status === "saved" && <p role="status" className="mt-2 text-xs text-clear-action">Saved.</p>}
      {status === "error" && <p role="alert" className="mt-2 text-xs text-critical">Could not save. Nothing changed.</p>}
    </section>
  );
}
