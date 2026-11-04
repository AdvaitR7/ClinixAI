"use client";

import { FollowupWorklist } from "@/components/followups";
import { WorkspaceShell } from "@/components/workspace-shell";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/followups", active: true },
];

/** Page 21 for doctors: their own follow-up obligations. */
export default function DoctorFollowupsPage() {
  return (
    <WorkspaceShell workspace="Doctor" title="Follow-ups" nav={nav} focused hideHeading>
      <FollowupWorklist base="/app/doctor/followups" />
    </WorkspaceShell>
  );
}
