import type { MeResponse } from "@clinix/schemas";

/** One destination in a workspace dock. */
export type DockItem = { label: string; href: string };

/** A doctor-workspace dock destination, used to mark the current screen. */
export type DoctorDestination = "desk" | "schedule" | "patients" | "drafts" | "followups";

const DOCTOR_DOCK: (DockItem & { key: DoctorDestination })[] = [
  { key: "desk", label: "Desk", href: "/app/doctor" },
  { key: "schedule", label: "Schedule", href: "/app/doctor/schedule" },
  { key: "patients", label: "Patients", href: "/app/doctor/patients" },
  { key: "drafts", label: "Drafts", href: "/app/doctor/drafts" },
  { key: "followups", label: "Follow-ups", href: "/app/doctor/followups" },
];

/**
 * The single source of the doctor dock, so every doctor screen shows the same five destinations.
 *
 * @param active - Destination to mark current; omit on screens that belong to none of them.
 * @returns Dock items in fixed order, with `active` set on at most one.
 */
export function doctorNav(active?: DoctorDestination): (DockItem & { active?: boolean })[] {
  return DOCTOR_DOCK.map(({ key, ...item }) => (key === active ? { ...item, active: true } : item));
}

/** Bottom padding that keeps scrolling content clear of the fixed dock (dock + gap + safe area). */
export const DOCK_CLEARANCE = "pb-[calc(6.5rem+env(safe-area-inset-bottom))]";

/**
 * Picks the dock for a signed-in account so shared screens (notifications, settings) show the same
 * destinations as the caller's workspace. Returns null when the role has no supported workspace.
 *
 * @param me - The resolved `/me` profile.
 * @returns The dock's accessible workspace name and its destinations, or null.
 */
export function dockForMe(me: MeResponse): { workspace: string; items: DockItem[] } | null {
  if (me.role === "PATIENT") {
    return {
      workspace: "Patient",
      items: [
        { label: "Home", href: "/app/patient" },
        { label: "Timeline", href: "/app/patient/timeline" },
        { label: "Vault", href: "/app/patient/vault" },
        { label: "Visits", href: "/app/patient/appointments" },
        { label: "Care", href: "/app/patient/care" },
        { label: "You", href: "/settings" },
      ],
    };
  }
  if (me.role === "DOCTOR") {
    return { workspace: "Doctor", items: doctorNav() };
  }
  if (me.role === "CLINIC_STAFF") {
    const assistant = (me.memberships ?? []).find((m) => m.role === "RECEPTION" || m.role === "ASSISTANT")?.role === "ASSISTANT";
    return {
      workspace: "Doctor staff",
      items: [
        { label: "Home", href: "/app/staff" },
        { label: "Schedule", href: "/app/staff/schedule" },
        assistant
          ? { label: "Intake", href: "/app/staff/schedule?tab=intake" }
          : { label: "Patients", href: "/app/staff/schedule?tab=patients" },
        { label: "Follow-ups", href: "/app/staff/followups" },
      ],
    };
  }
  return null;
}
