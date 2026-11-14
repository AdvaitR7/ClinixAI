"use client";

import { useState } from "react";
import { useApiData, useMe } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useApiWrite } from "@/lib/staff";

const nav = [
  { label: "Home", href: "/app/staff" },
  { label: "Requests", href: "/app/staff/requests", active: true },
];

type Request = { id: string; resource_type: string; status: string; requested_at: string; target_doctor_id: string | null; target_doctor_name: string | null };
type Doctor = { doctor_id: string; name: string };

/** Staff route-request screen (SCR-051): staff route a request to another doctor of the practice; they never decide it. */
export default function StaffRequestsPage() {
  const me = useMe();
  const member = me.status === "ready" ? (me.me.memberships ?? []).find((m) => m.role === "RECEPTION" || m.role === "ASSISTANT") : undefined;
  const qs = member ? `?practice_id=${member.practice_id}` : "";
  const requests = useApiData<Request[]>(member ? `/staff/record-removal-requests${qs}` : null);
  const doctors = useApiData<Doctor[]>(member ? `/staff/doctors${qs}` : null);
  const write = useApiWrite();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  /** Routes one request to the chosen practice doctor. */
  async function route(id: string) {
    setError(null);
    try {
      await write(`/record-removal-requests/${id}/route`, "POST", { doctor_id: target[id] });
      await requests.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not route the request.");
    }
  }

  return (
    <WorkspaceShell workspace="Clinic staff" title="Route retention request" nav={nav} focused>
      <section className="rounded-[22px] border border-review bg-surface p-5">
        <p className="text-xs uppercase text-review">Role restricted</p>
        <h2 className="mt-2 text-xl">Decision controls unavailable</h2>
        <p className="mt-3 text-sm leading-relaxed">Clinic staff can route a removal or retention request, but cannot approve, partially approve or retain a record. Those decisions stay with the responsible doctor.</p>
      </section>
      {requests.status === "loading" && member && <p role="status" className="text-sm">Loading requests…</p>}
      {requests.status === "error" && <p role="alert" className="text-sm">{requests.error}</p>}
      {requests.status === "ready" && requests.data.length === 0 && <section className="rounded-[22px] border border-hairline bg-surface p-5"><p className="text-sm">No open requests to route.</p></section>}
      {requests.status === "ready" && requests.data.map((r) => (
        <section key={r.id} className="rounded-[22px] border border-hairline bg-surface p-5">
          <p className="text-sm font-semibold">{r.resource_type.toLowerCase()} request · {r.status.toLowerCase()}</p>
          <p className="mt-1 text-xs text-clear-secondary">Currently with {r.target_doctor_name ?? "a practice doctor"}. No request reason or record content is shown to staff.</p>
          <select aria-label="Route to doctor" value={target[r.id] ?? ""} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })} className="mt-3 min-h-11 w-full rounded-xl border border-hairline bg-canvas px-3 text-sm">
            <option value="">Route to…</option>
            {doctors.status === "ready" && doctors.data.filter((d) => d.doctor_id !== r.target_doctor_id).map((d) => <option key={d.doctor_id} value={d.doctor_id}>{d.name}</option>)}
          </select>
          <button type="button" disabled={!target[r.id]} onClick={() => void route(r.id)} className="mt-2 min-h-11 w-full rounded-2xl border border-ink px-4 text-sm font-semibold disabled:opacity-50">Route request</button>
        </section>
      ))}
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
    </WorkspaceShell>
  );
}
