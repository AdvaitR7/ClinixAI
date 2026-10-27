import { and, eq, inArray } from "drizzle-orm";
import type { ConsentExpiry, ConsentResourceType } from "@clinix/schemas";
import { requireDb } from "../http.js";
import { consentScopes, consents } from "../schema.js";

type Database = ReturnType<typeof requireDb>;

export type ConsentRow = typeof consents.$inferSelect;
export type ConsentScopeRow = { resourceType: string; resourceId: string | null };
export type ConsentWithScopes = ConsentRow & { scopes: ConsentScopeRow[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Maps the patient-facing expiry choice to an absolute time (null = until withdrawn). */
export function expiryDate(expiry: ConsentExpiry, now: Date): Date | null {
  if (expiry === "7_DAYS") return new Date(now.getTime() + 7 * DAY_MS);
  if (expiry === "30_DAYS") return new Date(now.getTime() + 30 * DAY_MS);
  return null;
}

/**
 * Effective status of a consent at `now`. Expiry is derived at read time (no
 * job flips the stored status): revoked wins, then a past `expires_at`.
 */
export function effectiveStatus(
  c: Pick<ConsentRow, "status" | "expiresAt" | "revokedAt" | "startsAt">,
  now: Date,
): "ACTIVE" | "REVOKED" | "EXPIRED" {
  if (c.status === "REVOKED" || c.revokedAt) return "REVOKED";
  if (c.status === "EXPIRED") return "EXPIRED";
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** True if the consent is usable right now (started, not revoked, not expired). */
export function isUsable(c: ConsentRow, now: Date): boolean {
  return effectiveStatus(c, now) === "ACTIVE" && c.startsAt.getTime() <= now.getTime();
}

/** A whole-group scope (no resource id) covers every record of that type; otherwise ids must match. */
export function scopeCovers(
  scopes: ConsentScopeRow[],
  resourceType: ConsentResourceType | string,
  resourceId?: string | null,
): boolean {
  return scopes.some(
    (s) =>
      s.resourceType === resourceType &&
      (s.resourceId === null || (resourceId != null && s.resourceId === resourceId)),
  );
}

/** Loads consents (with their scopes) matching a filter. */
async function loadWithScopes(database: Database, rows: ConsentRow[]): Promise<ConsentWithScopes[]> {
  if (rows.length === 0) return [];
  const scopeRows = await database
    .select({
      consentId: consentScopes.consentId,
      resourceType: consentScopes.resourceType,
      resourceId: consentScopes.resourceId,
    })
    .from(consentScopes)
    .where(inArray(consentScopes.consentId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    ...r,
    scopes: scopeRows
      .filter((s) => s.consentId === r.id)
      .map((s) => ({ resourceType: s.resourceType, resourceId: s.resourceId })),
  }));
}

/** All consents a patient has granted (any status), newest first. */
export async function consentsForPatient(database: Database, patientId: string) {
  const rows = await database.select().from(consents).where(eq(consents.patientId, patientId));
  return (await loadWithScopes(database, rows)).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

/** Usable consents a patient currently grants to one doctor. */
export async function activeConsentsForDoctor(
  database: Database,
  patientId: string,
  doctorId: string,
  now = new Date(),
): Promise<ConsentWithScopes[]> {
  const rows = await database
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.patientId, patientId),
        eq(consents.granteeType, "DOCTOR"),
        eq(consents.granteeId, doctorId),
        eq(consents.status, "ACTIVE"),
      ),
    );
  return loadWithScopes(database, rows.filter((r) => isUsable(r, now)));
}

/** First usable consent of the doctor that covers the resource, else null. */
export function consentCovering(
  active: ConsentWithScopes[],
  resourceType: ConsentResourceType | string,
  resourceId?: string | null,
): ConsentWithScopes | null {
  return active.find((c) => scopeCovers(c.scopes, resourceType, resourceId)) ?? null;
}

/** Record groups a doctor cannot currently see for lack of a covering consent. */
export const LOCKABLE_SECTIONS: { type: ConsentResourceType; name: string }[] = [
  { type: "ENCOUNTER", name: "Patient-shared encounters" },
  { type: "DOCUMENT", name: "Patient-uploaded documents and lab reports" },
  { type: "MEDICATION", name: "Medication history" },
  { type: "TIMELINE", name: "Health timeline" },
  { type: "CHECKIN_PACKET", name: "AI check-in packet" },
];

/** Locked-section entries (never silent omission) for groups the active consents do not cover. */
export function lockedSections(active: ConsentWithScopes[]) {
  return LOCKABLE_SECTIONS.filter((s) => !consentCovering(active, s.type)).map((s) => ({
    section_name: s.name,
    reason: active.length === 0
      ? "No active patient consent covers this record group."
      : "The active consent does not include this record group.",
  }));
}
