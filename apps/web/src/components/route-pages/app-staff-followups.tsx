"use client";


import { useRouteParam } from "@/lib/route-params";

import { Suspense } from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import { FollowupDetail } from "@/components/followups";
import { StaffShell } from "@/components/staff-shell";

/** Page 21a for staff: operational task detail with the clinical outcome locked. */
export default function StaffFollowupDetailPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}

function Content() {
  const id = useRouteParam("id");
  const practiceId = useSearchParams().get("practice_id");
  return (
    <StaffShell role={null} active="followups" title="Follow-up task">
      <Link href="/app/staff/followups" className="min-h-11 text-xs text-clear-info">← Worklist</Link>
      <FollowupDetail id={id} practiceId={practiceId} isDoctor={false} />
    </StaffShell>
  );
}
