"use client";

import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace-shell";
import type { StaffRole } from "@/lib/staff";

type Active = "home" | "schedule" | "patients" | "intake" | "followups";

/**
 * Staff navigation dock (FigCraft frame 5844). Four destinations in a fixed order;
 * Schedule and Patients are operational anchors on the dashboard, never clinical views.
 */
export function StaffShell({
  role,
  active,
  title,
  children,
}: {
  role: StaffRole | null;
  active: Active;
  title: string;
  children: ReactNode;
}) {
  const third = role === "ASSISTANT"
    ? { key: "intake" as const, label: "Intake", href: "/app/staff#intake" }
    : { key: "patients" as const, label: "Patients", href: "/app/staff#schedule" };
  const nav = [
    { label: "Home", href: "/app/staff", key: "home" },
    { label: "Schedule", href: "/app/staff#schedule", key: "schedule" },
    { label: third.label, href: third.href, key: third.key },
    { label: "Follow-ups", href: "/app/staff/followups", key: "followups" },
  ].map(({ key, ...item }) => ({ ...item, active: key === active }));
  return (
    <WorkspaceShell workspace="Doctor staff" title={title} nav={nav} focused hideHeading>
      {children}
    </WorkspaceShell>
  );
}
