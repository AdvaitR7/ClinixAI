"use client";

import { WorkspaceShell } from "@/components/workspace-shell";

const nav = [
  { label: "Home", href: "/app/staff" },
  { label: "Requests", href: "/app/staff/requests", active: true },
];

/** Staff route-request screen (SCR-051). Practice members can route within their practice through the API; this screen has no routing controls yet. */
export default function StaffRequestsPage() {
  return (
    <WorkspaceShell workspace="Clinic staff" title="Route retention request" nav={nav} focused>
      <section className="rounded-[22px] border border-review bg-surface p-5">
        <p className="text-[9px] uppercase text-review">Role restricted</p>
        <h2 className="mt-2 text-xl">Decision controls unavailable</h2>
        <p className="mt-3 text-sm leading-relaxed">Clinic staff can route a removal or retention request, but cannot approve, partially approve or retain a record. Those decisions stay with the responsible doctor.</p>
      </section>
      <section className="rounded-[22px] border border-hairline bg-surface p-5">
        <h2 className="text-lg">Routing controls are not built yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-graphite">The API lets an active practice member route a request to another doctor of the same practice. No request details are shown on this screen until routing controls are designed.</p>
      </section>
    </WorkspaceShell>
  );
}
