"use client";


import { useRouteParam } from "@/lib/route-params";

import Link from "next/link";

import { FollowupDetail } from "@/components/followups";
import { WorkspaceShell } from "@/components/workspace-shell";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/followups", active: true },
];

/** Page 21a for doctors, including the clinical outcome field. */
export default function DoctorFollowupDetailPage() {
  const id = useRouteParam("id");
  return (
    <WorkspaceShell workspace="Doctor" title="Follow-up task" nav={nav} focused hideHeading>
      <Link href="/app/doctor/followups" className="min-h-11 text-xs text-clear-info">← Worklist</Link>
      <FollowupDetail id={id} isDoctor />
    </WorkspaceShell>
  );
}
