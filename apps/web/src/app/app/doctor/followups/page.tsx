"use client";

import { FollowupWorklist } from "@/components/followups";
import { WorkspaceShell } from "@/components/workspace-shell";
import { doctorNav } from "@/lib/workspace-nav";

const nav = doctorNav("followups");

/** Page 21 for doctors: their own follow-up obligations. */
export default function DoctorFollowupsPage() {
  return (
    <WorkspaceShell workspace="Doctor" title="Follow-ups" nav={nav} focused hideHeading>
      <FollowupWorklist base="/app/doctor/followups" />
    </WorkspaceShell>
  );
}
