import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { medicationsForPatient } from "./derive.js";
import { prescriptionRoutes } from "../prescriptions/routes.js";
import { medicationRoutes } from "./routes.js";
import { encounters, medicationRecords, prescriptions } from "../schema.js";

const mocks = vi.hoisted(() => ({ database: { select: vi.fn() }, log: vi.fn() }));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({ requirePatient: () => "patient-own", requireDoctor: () => "doctor-own", authorizePatientAccess: async () => true }));
vi.mock("../audit/log.js", () => ({ logAccess: mocks.log }));
vi.mock("../prescriptions/pdf.js", () => ({ renderPrescriptionPdf: vi.fn() }));
const createdAt = new Date("2026-10-26T00:00:00Z");
const record = { id: "record-own", medicineName: "Synthetic medicine", dose: "1 tablet", route: "oral", frequency: "daily", status: "CURRENT", prescriptionId: "rx-own", prescriptionItemId: null, encounterId: "encounter-own", startedOn: "2026-01-01", endedOn: null, reasonForUse: "Recorded indication", response: "Recorded response", adverseReaction: "Recorded reaction", reasonStopped: null, createdAt };
const item = { itemId: "item-own", medicineName: "Synthetic medicine", strength: "10 mg", dose: "2 tablets", route: "oral", frequency: "daily", duration: "5 days", timing: "after food", instructions: "Recorded instruction", doctorName: "Synthetic Author", prescriptionId: "rx-own", encounterId: "encounter-own", versionNumber: 2, finalizedAt: createdAt };

/** Runs the real provenance projection and patient source handlers against isolated query results. */
describe("medication source provenance", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let conditions: { table: unknown; sql: string; params: unknown[] }[];
  const dialect = new PgDialect();
  beforeEach(async () => {
    vi.clearAllMocks(); rows = []; conditions = [];
    mocks.database.select.mockImplementation(() => {
      let table: unknown;
      const builder = {
        from: (value: unknown) => { table = value; return builder; },
        innerJoin: () => builder,
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          conditions.push({ table, ...dialect.sqlToQuery(condition) });
          const result = Object.assign(Promise.resolve(rows.shift() ?? []), { orderBy: () => result, limit: () => result });
          return result;
        },
      };
      return builder;
    });
    app = Fastify();
    app.addHook("onRequest", async (request) => { request.auth = { role: "PATIENT", patientId: "patient-own", profileId: "profile-own" } as typeof request.auth; });
    await app.register(medicationRoutes);
    await app.register(prescriptionRoutes);
  });
  afterEach(async () => { await app.close(); });

  it("preserves exact prescribed fields/version and never calls a historical prescription current", async () => {
    rows = [[], [item]];
    const response = await app.inject({ method: "GET", url: "/patients/self/medications" });
    expect(response.statusCode).toBe(200);
    expect(response.json().medications).toEqual([expect.objectContaining({ entry_id: "prescription:item-own", source_kind: "PRESCRIPTION", strength: "10 mg", duration: "5 days", timing: "after food", instructions: "Recorded instruction", prescription_version_number: 2, status: "UNKNOWN_STATUS", prescribing_doctor: "Synthetic Author", started_on: null, reason_for_use: null, adverse_reaction: null })]);
    expect(conditions.find((condition) => condition.table === prescriptions)?.sql).toContain('"current_version_id"');
    expect(conditions.every((condition) => condition.params.includes("patient-own"))).toBe(true);
  });
  it.each(["CURRENT", "PAST", "DISCONTINUED", "UNKNOWN_STATUS", "UNRECOGNIZED"])("normalizes only explicit exposure status %s", async (status) => {
    rows = [[{ ...record, status }], []];
    const [value] = await medicationsForPatient("patient-own");
    expect(value.status).toBe(status === "UNRECOGNIZED" ? "UNKNOWN_STATUS" : status);
    expect(value).toMatchObject({ source_kind: "RECORDED_EXPOSURE", started_on: "2026-01-01", reason_for_use: "Recorded indication", response: "Recorded response", adverse_reaction: "Recorded reaction", prescribing_doctor: null, prescribed_date: null, prescription_version_number: null, duration: null });
  });
  it("does not infer active use or completion from start/end dates", async () => {
    rows = [[{ ...record, status: "UNKNOWN_STATUS", endedOn: "2020-01-01" }], []];
    const [value] = await medicationsForPatient("patient-own");
    expect(value.status).toBe("UNKNOWN_STATUS"); expect(value.ended_on).toBe("2020-01-01");
  });
  it("retains a linked historical item's original version instead of the current item's matching name", async () => {
    rows = [[{ ...record, prescriptionItemId: "old-item" }], [item], [{ ...item, itemId: "old-item", versionNumber: 1, dose: "old dose", duration: "8 weeks" }]];
    const [exposure, derived] = await medicationsForPatient("patient-own");
    expect(exposure).toMatchObject({ prescription_version_number: 1, duration: "8 weeks", dose: "1 tablet", prescribing_doctor: "Synthetic Author" });
    expect(derived.prescription_version_number).toBe(2);
    expect(conditions.at(-1)?.params).toContain("old-item");
    expect(conditions.at(-1)?.sql).not.toContain('"current_version_id"');
  });
  it("does not enrich a missing item or an item linked to a different prescription", async () => {
    rows = [[{ ...record, prescriptionItemId: "old-item" }], [item], [{ ...item, itemId: "old-item", prescriptionId: "different-rx" }]];
    const [value] = await medicationsForPatient("patient-own");
    expect(value.prescription_version_number).toBeNull(); expect(value.prescribing_doctor).toBeNull(); expect(value.duration).toBeNull();
  });
  it("keeps exposure and prescribed entries distinct, even for the same name", async () => {
    rows = [[record], [item]];
    const values = await medicationsForPatient("patient-own");
    expect(values).toHaveLength(2); expect(new Set(values.map((value) => value.entry_id)).size).toBe(2);
  });
  it("restricts linked historical prescription enrichment to the same doctor scope", async () => {
    rows = [[{ id: "encounter-own" }], [{ ...record, prescriptionItemId: "old-item" }], [item], [{ ...item, itemId: "old-item" }]];
    await medicationsForPatient("patient-own", "doctor-own");
    expect(conditions.some((condition) => condition.table === encounters && condition.params.includes("doctor-own") && condition.params.includes("patient-own"))).toBe(true);
    expect(conditions.some((condition) => condition.table === medicationRecords && condition.params.includes("patient-own"))).toBe(true);
    expect(conditions.filter((condition) => condition.table === prescriptions).every((condition) => condition.params.includes("doctor-own") && condition.params.includes("patient-own"))).toBe(true);
  });
  it("scopes the first patient prescription read before loading any versions or items", async () => {
    rows = [[]];
    const response = await app.inject({ method: "GET", url: "/patients/self/prescriptions/unavailable" });
    expect(response.statusCode).toBe(404);
    expect(conditions).toHaveLength(1); expect(conditions[0].params).toEqual(["unavailable", "patient-own"]); expect(mocks.log).not.toHaveBeenCalled();
  });
  it("returns own immutable versions and records the existing patient VIEW audit event", async () => {
    rows = [[{ id: "rx-own", patientId: "patient-own", doctorId: "doctor-own", status: "ACTIVE", currentVersionId: "version-two", createdAt }], [{ id: "version-one", prescriptionId: "rx-own", versionNumber: 1, finalizedByDoctorId: "doctor-own", finalizedAt: createdAt, amendmentReason: null }, { id: "version-two", prescriptionId: "rx-own", versionNumber: 2, finalizedByDoctorId: "doctor-own", finalizedAt: createdAt, amendmentReason: "Recorded amendment" }], [], [{ doctorId: "doctor-own", name: "Synthetic Author" }]];
    const response = await app.inject({ method: "GET", url: "/patients/self/prescriptions/rx-own" });
    expect(response.statusCode).toBe(200); expect(response.json().versions.map((value: { version_number: number }) => value.version_number)).toEqual([1, 2]); expect(response.json().current_version.version_number).toBe(2);
    expect(mocks.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ patientId: "patient-own", action: "VIEW", resourceId: "rx-own" }));
  });
});
