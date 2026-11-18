import { scheduleDateSchema } from "@clinix/schemas";
import { recordHref } from "@/lib/route-params";
import { doctorNav } from "@/lib/workspace-nav";

export const scheduleNav = doctorNav("schedule");
/** Opaque white schedule card (Clear v2). */
export const scheduleCard = "clear-card p-4";
export const clearScheduleCard = scheduleCard;
export const scheduleStatuses = ["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type ScheduleState = { date: string; view: "day" | "week"; status: string; tab: "schedule" | "availability" };

/** Uses the same India calendar day as backend availability and booking. */
export function todayIndia() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

/** Performs calendar-day arithmetic without depending on the browser's local timezone. */
export function shiftScheduleDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Sanitizes only known schedule state; no arbitrary return URL can enter navigation. */
export function readScheduleState(query: { get: (key: string) => string | null }): ScheduleState {
  const date = query.get("date");
  const status = query.get("status") ?? "";
  return { date: scheduleDateSchema.safeParse(date).success ? date! : todayIndia(), view: query.get("view") === "week" ? "week" : "day", status: scheduleStatuses.includes(status as typeof scheduleStatuses[number]) ? status : "", tab: query.get("tab") === "availability" ? "availability" : "schedule" };
}

/** Builds an internal schedule or selected-context URL preserving date/view/filter state. */
export function scheduleHref(state: ScheduleState, appointmentId?: string) {
  const query = new URLSearchParams({ date: state.date, view: state.view });
  if (state.status) query.set("status", state.status);
  if (!appointmentId && state.tab === "availability") query.set("tab", "availability");
  if (appointmentId) return recordHref("/app/doctor/schedule", "appointmentId", appointmentId, Object.fromEntries(query));
  return `/app/doctor/schedule?${query}`;
}

/** Formats actual visit times in the scheduling timezone. */
export function scheduleTime(date: string) {
  return new Date(date).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}
