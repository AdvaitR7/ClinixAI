"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
  const { id } = useParams<{ id: string }>();
  return (
    <WorkspaceShell workspace="Doctor" title="Follow-up task" nav={nav} focused hideHeading>
      <Link href="/app/doctor/followups" className="min-h-11 text-xs text-evidence">← Worklist</Link>
      <FollowupDetail id={id} isDoctor />
    </WorkspaceShell>
  );
}
