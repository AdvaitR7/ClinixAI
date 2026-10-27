"use client";

import { WorkspaceShell } from "@/components/workspace-shell";

const nav = [
  { label: "Home", href: "/app/staff" },
  { label: "Requests", href: "/app/staff/requests", active: true },
];

/** Staff route-request screen (SCR-051). Routing needs practice membership, which arrives with Phase 7. */
export default function StaffRequestsPage() {
  return (
    <WorkspaceShell workspace="Clinic staff" title="Route retention request" nav={nav} focused>
      <section className="rounded-[22px] border border-review bg-surface p-5">
        <p className="text-[9px] uppercase text-review">Role restricted</p>
        <h2 className="mt-2 text-xl">Decision controls unavailable</h2>
        <p className="mt-3 text-sm leading-relaxed">Clinic staff can route a removal or retention request, but cannot approve, partially approve or retain a record. Those decisions stay with the responsible doctor.</p>
      </section>
      <section className="rounded-[22px] border border-hairline bg-surface p-5">
        <h2 className="text-lg">Routing is not available yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-graphite">Staff access to patient requests requires verified practice membership, which is not set up. No request details are shown until it is.</p>
      </section>
    </WorkspaceShell>
  );
}
