import { describe, expect, it } from "vitest";
import { consentCovering, effectiveStatus, expiryDate, isUsable, lockedSections, scopeCovers, type ConsentWithScopes } from "./consent.js";

const now = new Date("2026-10-26T10:00:00Z");
const consent = (over: Partial<ConsentWithScopes> = {}): ConsentWithScopes => ({
  id: "c1", patientId: "p", granteeType: "DOCTOR", granteeId: "d", purpose: "Follow-up", status: "ACTIVE",
  startsAt: new Date("2026-10-26T09:00:00Z"), expiresAt: null, revokedAt: null, createdAt: now, updatedAt: now,
  scopes: [{ resourceType: "MEDICATION", resourceId: null }], ...over,
});

describe("consent expiry and scope", () => {
  it("maps expiry choices to absolute times", () => {
    expect(expiryDate("7_DAYS", now)?.toISOString()).toBe("2026-11-02T10:00:00.000Z");
    expect(expiryDate("30_DAYS", now)?.toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(expiryDate("UNTIL_WITHDRAWN", now)).toBeNull();
  });

  it("derives expiry at read time, exclusive at the boundary", () => {
    expect(effectiveStatus(consent({ expiresAt: new Date("2026-10-26T10:00:01Z") }), now)).toBe("ACTIVE");
    expect(effectiveStatus(consent({ expiresAt: new Date("2026-10-26T10:00:00Z") }), now)).toBe("EXPIRED");
    expect(isUsable(consent({ expiresAt: new Date("2026-10-26T09:59:59Z") }), now)).toBe(false);
  });

  it("treats a revoked consent as revoked even if also past expiry", () => {
    const revoked = consent({ status: "REVOKED", revokedAt: now, expiresAt: new Date("2026-10-01T00:00:00Z") });
    expect(effectiveStatus(revoked, now)).toBe("REVOKED");
    expect(isUsable(revoked, now)).toBe(false);
  });

  it("does not use a consent that has not started", () => {
    expect(isUsable(consent({ startsAt: new Date("2026-10-27T00:00:00Z") }), now)).toBe(false);
  });

  it("whole-group scope covers any record; id scope covers only that record", () => {
    expect(scopeCovers([{ resourceType: "DOCUMENT", resourceId: null }], "DOCUMENT", "x")).toBe(true);
    expect(scopeCovers([{ resourceType: "DOCUMENT", resourceId: "a" }], "DOCUMENT", "a")).toBe(true);
    expect(scopeCovers([{ resourceType: "DOCUMENT", resourceId: "a" }], "DOCUMENT", "b")).toBe(false);
    expect(scopeCovers([{ resourceType: "DOCUMENT", resourceId: "a" }], "DOCUMENT")).toBe(false);
    expect(scopeCovers([{ resourceType: "DOCUMENT", resourceId: null }], "MEDICATION")).toBe(false);
  });

  it("reports locked sections for uncovered groups instead of omitting them", () => {
    expect(lockedSections([]).map((s) => s.section_name)).toHaveLength(5);
    const locked = lockedSections([consent()]).map((s) => s.section_name);
    expect(locked).not.toContain("Medication history");
    expect(locked).toContain("Health timeline");
    expect(consentCovering([consent()], "MEDICATION")?.id).toBe("c1");
    expect(consentCovering([consent()], "TIMELINE")).toBeNull();
  });
});
