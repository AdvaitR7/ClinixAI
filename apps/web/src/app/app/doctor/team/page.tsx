"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiData, useMe } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { clinicDate, useApiWrite, type TeamMember } from "@/lib/staff";

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
const ROLE = { OWNER: "Owner", DOCTOR: "Doctor", RECEPTION: "Receptionist", ASSISTANT: "Clinical assistant" } as const;

type Pending = { kind: "role" | "end"; member: TeamMember };

/** Page 25 — practice team and memberships, with role-change (25a) and end-membership (25b) confirmations. */
export default function TeamPage() {
  const me = useMe();
  const manager = me.status === "ready" ? (me.me.memberships ?? []).find((m) => m.role === "OWNER" || m.role === "DOCTOR") : undefined;
  const practiceId = manager?.practice_id ?? null;
  const team = useApiData<TeamMember[]>(practiceId ? `/practices/${practiceId}/members` : null);
  const write = useApiWrite();
  const [contact, setContact] = useState("");
  const [role, setRole] = useState<"RECEPTION" | "ASSISTANT">("RECEPTION");
  const [invite, setInvite] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [newRole, setNewRole] = useState<"RECEPTION" | "ASSISTANT">("RECEPTION");
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practiceName, setPracticeName] = useState("");

  /** Runs a membership write, surfaces failures, and reloads the team. */
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPending(null);
      setReason("");
      await team.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Change failed.");
    } finally {
      setBusy(false);
    }
  }

  const base = `/practices/${practiceId}`;

  return (
    <WorkspaceShell workspace="Doctor" title="Practice team" nav={nav} focused hideHeading>
      <div>
        <p className={label}>Practice owner · team</p>
        <h1 className="mt-2 text-[28px] leading-tight">Practice team</h1>
        <p className="mt-1 text-xs text-clear-secondary">Staff access starts only when an invited person accepts. Ending a membership keeps history.</p>
      </div>
      {me.status === "ready" && !manager && (
        <section className={card}>
          <p className="text-sm font-semibold">Create your practice</p>
          <input aria-label="Practice name" value={practiceName} onChange={(e) => setPracticeName(e.target.value)} className={`${field} mt-3`} placeholder="City Clinic" />
          <button type="button" disabled={busy || practiceName.trim().length < 2} onClick={() => void run(async () => { await write("/practices", "POST", { name: practiceName.trim() }); window.location.reload(); })} className="mt-3 min-h-11 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Create practice</button>
        </section>
      )}
      {manager && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{manager.practice_name}</p>
            <Link href="/app/doctor/practice" className="min-h-11 text-xs text-clear-info">Practice settings →</Link>
          </div>
          <section className={card} aria-labelledby="invite-heading">
            <p className={label}>Invite team member</p>
            <h2 id="invite-heading" className="sr-only">Invite</h2>
            <input aria-label="Email or mobile" value={contact} onChange={(e) => setContact(e.target.value)} className={`${field} mt-2`} placeholder="Email or mobile" />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={`${field} mt-2`}>
              <option value="RECEPTION">Receptionist</option>
              <option value="ASSISTANT">Clinical assistant</option>
            </select>
            <button type="button" disabled={busy || contact.trim().length < 3} onClick={() => void run(async () => { const r = await write<{ invite_path: string }>(`${base}/invitations`, "POST", { contact: contact.trim(), role }); setInvite(`${window.location.origin}${r.invite_path}`); setContact(""); })} className="mt-3 min-h-11 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Send invitation</button>
            {invite && <p role="status" className="mt-2 break-all text-xs text-clear-action">Invitation link (shown once): {invite}</p>}
          </section>
          {team.status === "loading" && <p role="status" className="text-sm">Loading team…</p>}
          {team.status === "error" && <p role="alert" className="text-sm">{team.error}</p>}
          {team.status === "ready" && team.data.length === 0 && <div className={card}><p className="text-sm font-semibold">No team members yet</p><p className="mt-1 text-xs text-clear-secondary">Invite a receptionist or clinical assistant. Nothing is granted automatically.</p></div>}
          {team.status === "ready" && (
            <ul className="space-y-3" aria-label="Team members">
              {team.data.map((m) => (
                <li key={m.member_id} className={card}>
                  <div className="flex justify-between gap-2">
                    <p className="text-sm font-semibold">{m.display_name ?? m.contact_hint ?? "Invited member"} · {ROLE[m.role]}</p>
                    <span className="rounded-full border border-clear-divider px-2 py-0.5 text-xs uppercase">{m.status}</span>
                  </div>
                  {m.status === "FORMER" && <p className="mt-1 text-xs text-clear-secondary">Ended {m.ended_at ? clinicDate(m.ended_at) : ""} · {m.end_reason}. History preserved.</p>}
                  {m.role !== "OWNER" && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {m.status === "ACTIVE" && <>
                        <button type="button" onClick={() => { setPending({ kind: "role", member: m }); setNewRole(m.role === "ASSISTANT" ? "RECEPTION" : "ASSISTANT"); }} className="min-h-11 rounded-full border border-clear-divider px-3">Change role</button>
                        <button type="button" disabled={busy} onClick={() => void run(() => write(`${base}/members/${m.member_id}/suspend`, "POST"))} className="min-h-11 rounded-full border border-clear-divider px-3">Suspend</button>
                      </>}
                      {m.status === "SUSPENDED" && <button type="button" disabled={busy} onClick={() => void run(() => write(`${base}/members/${m.member_id}/restore`, "POST"))} className="min-h-11 rounded-full border border-clear-divider px-3">Restore access</button>}
                      {(m.status === "ACTIVE" || m.status === "SUSPENDED") && <button type="button" onClick={() => setPending({ kind: "end", member: m })} className="min-h-11 rounded-full border border-critical px-3 text-critical">End membership</button>}
                      {(m.status === "INVITED" || m.status === "EXPIRED") && <>
                        <button type="button" disabled={busy} onClick={() => void run(async () => { const r = await write<{ invite_path: string }>(`${base}/members/${m.member_id}/resend`, "POST"); setInvite(`${window.location.origin}${r.invite_path}`); })} className="min-h-11 rounded-full border border-clear-divider px-3">Resend</button>
                        <button type="button" disabled={busy} onClick={() => void run(() => write(`${base}/members/${m.member_id}/revoke`, "POST"))} className="min-h-11 rounded-full border border-critical px-3 text-critical">Revoke</button>
                      </>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pending && (
            <section role="dialog" aria-modal="true" aria-label={pending.kind === "role" ? "Confirm role change" : "End membership"} className="rounded-[18px] border-2 border-clear-divider bg-clear-surface p-4">
              {pending.kind === "role" ? (
                <>
                  <p className="text-sm font-semibold">Confirm role change</p>
                  <select aria-label="New role" value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)} className={`${field} mt-2`}>
                    <option value="RECEPTION">Receptionist</option>
                    <option value="ASSISTANT">Clinical assistant</option>
                  </select>
                  <p className="mt-2 text-xs text-clear-secondary">{newRole === "ASSISTANT" ? "Permissions expand: intake vitals and Ready-for-Doctor." : "Permissions narrow: arrival and operations only."}</p>
                  <button type="button" disabled={busy} onClick={() => void run(() => write(`${base}/members/${pending.member.member_id}/role`, "PATCH", { role: newRole, confirm_permission_change: true }))} className="mt-3 min-h-11 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Confirm change</button>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">End membership</p>
                  <label className="mt-2 block text-xs">Effective date<input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={`${field} mt-1`} /></label>
                  <label className="mt-2 block text-xs">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} mt-1`} /></label>
                  <p className="mt-2 text-xs text-clear-secondary">Access ends. History is preserved and open tasks become unassigned.</p>
                  <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => write(`${base}/members/${pending.member.member_id}/end`, "POST", { reason: reason.trim(), effective_date: effective }))} className="mt-3 min-h-11 w-full rounded-2xl border border-critical px-4 text-sm font-semibold text-critical">End membership</button>
                </>
              )}
              <button type="button" onClick={() => setPending(null)} className="mt-2 min-h-11 w-full text-xs text-clear-info">Cancel</button>
            </section>
          )}
          {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        </>
      )}
    </WorkspaceShell>
  );
}
