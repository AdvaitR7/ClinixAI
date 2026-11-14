"use client";

import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace-shell";
import type { StaffRole } from "@/lib/staff";

type Active = "home" | "schedule" | "patients" | "intake" | "followups";

/**
 * Staff navigation dock (FigCraft frame 5844). Four destinations in a fixed order;
 * Schedule, Patients and Intake open the operational view (FigCraft frame 5953), never clinical views.
 */
export function StaffShell({
  role,
  active,
  title,
  children,
  appearance = "legacy",
}: {
  role: StaffRole | null;
  active: Active;
  title: string;
  children: ReactNode;
  /** Temporary migration switch forwarded to WorkspaceShell. */
  appearance?: "legacy" | "clear";
}) {
  const third = role === "ASSISTANT"
    ? { key: "intake" as const, label: "Intake", href: "/app/staff/schedule?tab=intake" }
    : { key: "patients" as const, label: "Patients", href: "/app/staff/schedule?tab=patients" };
  const nav = [
    { label: "Home", href: "/app/staff", key: "home" },
    { label: "Schedule", href: "/app/staff/schedule", key: "schedule" },
    { label: third.label, href: third.href, key: third.key },
    { label: "Follow-ups", href: "/app/staff/followups", key: "followups" },
  ].map(({ key, ...item }) => ({ ...item, active: key === active }));
  return (
    <WorkspaceShell workspace="Doctor staff" title={title} nav={nav} focused hideHeading appearance={appearance}>
      {children}
    </WorkspaceShell>
  );
}
