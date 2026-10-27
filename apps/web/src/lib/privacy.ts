import type { ConsentView } from "@clinix/schemas";

/** Dock shared by the Care Circle, scope picker and privacy screens. */
export const careNav = (active: "Care" | "None" = "Care") => [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Reports", href: "/app/patient/vault" },
  { label: "Care", href: "/app/patient/care", active: active === "Care" },
];

/** Shared card/label classes matching the patient workspace look. */
export const privacyCard = "rounded-[28px] border border-hairline bg-surface p-5 shadow-sm";
export const privacyLabel = "text-[9px] uppercase text-graphite";

const SCOPE_LABELS: Record<string, string> = {
  ENCOUNTER: "Consultation packet",
  DOCUMENT: "Lab reports and documents",
  MEDICATION: "Medication history",
  TIMELINE: "Full health timeline",
  CHECKIN_PACKET: "AI check-in result",
};

/** Plain-language name of a record group a consent covers. */
export function scopeLabel(type: string, specific = false): string {
  const base = SCOPE_LABELS[type] ?? type.toLowerCase().replaceAll("_", " ");
  return specific ? `${base} · selected record` : base;
}

const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Formats an ISO instant as an India-time date. */
export const formatDate = (iso: string) => date.format(new Date(iso));
/** Formats an ISO instant as an India-time date and time. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** One-line expiry description for a consent. */
export function expiryText(consent: Pick<ConsentView, "status" | "expires_at" | "revoked_at">): string {
  if (consent.status === "REVOKED" && consent.revoked_at) return `Revoked ${formatDate(consent.revoked_at)}`;
  if (consent.status === "EXPIRED" && consent.expires_at) return `Expired ${formatDate(consent.expires_at)}`;
  return consent.expires_at ? `Expires ${formatDate(consent.expires_at)}` : "Until withdrawn";
}

/** Short list of record groups a consent covers. */
export function scopeSummary(consent: Pick<ConsentView, "scopes">): string {
  return consent.scopes.map((s) => scopeLabel(s.resource_type, Boolean(s.resource_id))).join(" · ") || "No records";
}
