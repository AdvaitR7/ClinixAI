"use client";

import { Suspense } from "react";
import { useMe } from "@/lib/api";
import { FollowupWorklist } from "@/components/followups";
import { StaffShell } from "@/components/staff-shell";

/** Page 21 for staff, scoped to the member's first staff practice. */
export default function StaffFollowupsPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}

function Content() {
  const me = useMe();
  const m = me.status === "ready" ? (me.me.memberships ?? []).find((x) => x.role === "RECEPTION" || x.role === "ASSISTANT") : undefined;
  return (
    <StaffShell role={(m?.role as "RECEPTION" | "ASSISTANT") ?? null} active="followups" title="Follow-ups">
      {m ? <FollowupWorklist base="/app/staff/followups" practiceId={m.practice_id} /> : <p role="status" className="text-sm">Loading…</p>}
    </StaffShell>
  );
}
