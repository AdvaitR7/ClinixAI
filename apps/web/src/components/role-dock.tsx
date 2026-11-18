"use client";

import { WorkspaceDock } from "@/components/workspace-shell";
import { useMe } from "@/lib/api";
import { dockForMe } from "@/lib/workspace-nav";

/**
 * Role-aware dock for screens shared by every role (notifications, settings) that are not wrapped
 * in a workspace shell. Renders nothing until the role is known, so it never shows wrong destinations.
 *
 * @param active - Label of the destination to mark current, if any.
 */
export function RoleDock({ active }: { active?: string }) {
  const state = useMe();
  if (state.status !== "ready") return null;
  const dock = dockForMe(state.me);
  if (!dock) return null;
  return <WorkspaceDock workspace={dock.workspace} nav={dock.items.map((item) => ({ ...item, active: item.label === active }))} />;
}
