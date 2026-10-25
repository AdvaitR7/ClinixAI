import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prescriptionRoutes } from "./prescriptions/routes.js";
import { appointmentRoutes } from "./appointments/routes.js";
import { consultationRoutes } from "./consultations/routes.js";
import { prescriptions } from "./schema.js";

const mocks = vi.hoisted(() => ({ database: { select: vi.fn(), transaction: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("./db.js", () => ({ db: mocks.database }));
vi.mock("./auth/guards.js", () => ({ requireDoctor: () => "doctor-own", requirePatient: () => "patient-own", authorizePatientAccess: async () => true }));
vi.mock("./audit/log.js", () => ({ logAccess: vi.fn() }));
vi.mock("./appointments/map.js", () => ({ patientNames: async () => new Map(), appointmentView: (row: unknown) => row }));
vi.mock("./medications/derive.js", () => ({ medicationsForPatient: async () => [] }));
vi.mock("./prescriptions/pdf.js", () => ({ renderPrescriptionPdf: vi.fn() }));

/** Exercises real Fastify handlers with synthetic database results and captured SQL. */
describe("clinical record persistence boundaries", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let conditions: { sql: string; params: unknown[] }[];
  let writes: { table: unknown; values: Record<string, unknown> }[];
  let locks: number;
  const dialect = new PgDialect();
  const appointment = { id: "appointment-own", doctorId: "doctor-own", encounterId: "encounter-own" };
  const note = { id: "note-own", content: JSON.stringify({ assessment: "Reviewed assessment" }), isFinal: false, finalizedAt: null };
  const rx = { id: "rx-own", doctorId: "doctor-own", patientId: "patient-own", createdAt: new Date("2026-10-25T09:00:00Z"), currentVersionId: "version-own", status: "ACTIVE" };
  const version = { id: "version-own", prescriptionId: "rx-own", versionNumber: 1, finalizedByDoctorId: "doctor-own", finalizedAt: new Date("2026-10-25T09:00:00Z"), amendmentReason: null };
  const medicine = { prescriptionVersionId: "version-own", medicineName: "Synthetic medicine", dose: "1 tablet" };

  beforeEach(async () => {
    rows = [];
    conditions = [];
    writes = [];
    locks = 0;
    vi.clearAllMocks();
    mocks.database.select.mockImplementation(() => {
      const source = { innerJoin: () => source, where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      conditions.push(dialect.sqlToQuery(condition));
      const result = rows.shift() ?? [];
      const query = Object.assign(Promise.resolve(result), {
        limit: () => query,
        orderBy: () => query,
        for: async () => { locks += 1; return result; },
      });
      return query;
      } };
      return { from: () => source };
    });
    mocks.database.update.mockImplementation((table) => ({ set: (values: Record<string, unknown>) => {
      writes.push({ table, values });
      return { where: async () => [] };
    } }));
    mocks.database.insert.mockImplementation((table) => ({ values: (values: Record<string, unknown>) => {
      writes.push({ table, values });
      return Object.assign(Promise.resolve([]), { returning: async () => [table === prescriptions ? rx : version] });
    } }));
    mocks.database.transaction.mockImplementation(async (callback) => callback(mocks.database));
    app = Fastify();
    await app.register(prescriptionRoutes);
    await app.register(appointmentRoutes);
    await app.register(consultationRoutes);
  });

  afterEach(async () => { await app.close(); });

  it("scopes prescription replay reads to the requesting doctor before loading clinical content", async () => {
    rows = [[], [{ id: "draft-foreign", doctorId: "doctor-foreign" }]];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-foreign/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(conditions[0].sql).toContain('"prescriptions"."doctor_id"');
    expect(conditions[0].params).toContain("doctor-own");
    expect(writes).toEqual([]);
  });

  it("rejects an intervening dose edit without creating a prescription", async () => {
    rows = [[], [{ id: "draft-own", doctorId: "doctor-own", encounterId: "encounter-own", status: "DRAFT" }], [{ medicineName: "Synthetic medicine", dose: "2 tablets" }]];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: { reviewed_items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet" }] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DRAFT_CHANGED");
    expect(writes).toEqual([]);
    expect(locks).toBe(1);
  });

  it("finalizes matching reviewed fields and returns the immutable version", async () => {
    rows = [[], [{ id: "draft-own", doctorId: "doctor-own", encounterId: "encounter-own", status: "DRAFT" }], [medicine], [rx], [version], [medicine], []];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: { reviewed_items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet" }] } });
    expect(response.statusCode).toBe(201);
    expect(response.json().current_version.items[0]).toMatchObject({ medicine_name: "Synthetic medicine", dose: "1 tablet" });
    expect(writes.some((write) => write.values.status === "APPROVED")).toBe(true);
  });

  it("replays the owner's existing immutable version without additional writes", async () => {
    rows = [[rx], [rx], [version], [medicine], []];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: { reviewed_items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet" }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe("rx-own");
    expect(writes).toEqual([]);
  });

  it("does not acknowledge a replay containing different medicine fields", async () => {
    rows = [[rx], [rx], [version], [medicine], []];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: { reviewed_items: [{ medicine_name: "Synthetic medicine", dose: "2 tablets" }] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DRAFT_CHANGED");
    expect(writes).toEqual([]);
  });

  it("does not accept an invalid reviewed medicine snapshot", async () => {
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "synthetic-key" }, payload: { reviewed_items: [] } });
    expect(response.statusCode).toBe(400);
    expect(mocks.database.select).not.toHaveBeenCalled();
  });

  it("keeps encounter, appointment and note unchanged when the reviewed note is stale", async () => {
    rows = [[appointment], [{ id: "encounter-own" }], [note]];
    const response = await app.inject({ method: "POST", url: "/doctor/appointments/appointment-own/complete", payload: { reviewed_note: { assessment: "Different assessment" } } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NOTE_CHANGED");
    expect(writes).toEqual([]);
  });

  it("locks the encounter and finalizes all three records in one transaction", async () => {
    rows = [[appointment], [{ id: "encounter-own" }], [note]];
    const response = await app.inject({ method: "POST", url: "/doctor/appointments/appointment-own/complete", payload: { reviewed_note: { assessment: "Reviewed assessment" } } });
    expect(response.statusCode).toBe(200);
    expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
    expect(locks).toBe(1);
    expect(writes.map((write) => write.values.status ?? write.values.isFinal)).toEqual([true, "COMPLETED", "COMPLETED"]);
  });

  it("does not complete an appointment before a note exists", async () => {
    rows = [[appointment], [{ id: "encounter-own" }], []];
    const response = await app.inject({ method: "POST", url: "/doctor/appointments/appointment-own/complete", payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NOTE_REQUIRED");
    expect(writes).toEqual([]);
  });

  it("rejects a late autosave once completion finalized the note", async () => {
    rows = [[{ id: "encounter-own", patientId: "patient-own" }], [{ id: "encounter-own" }], [{ ...note, isFinal: true }]];
    const response = await app.inject({ method: "PUT", url: "/doctor/encounters/encounter-own/note", payload: { assessment: "Late autosave" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NOTE_FINALIZED");
    expect(locks).toBe(1);
    expect(writes).toEqual([]);
  });

  it("returns original note and separately dated amendment content on reopening", async () => {
    const amended = { id: "amendment-own", doctorId: "doctor-own", createdAt: new Date("2026-10-25T09:00:00Z"), content: JSON.stringify({ reason: "Correction", assessment: "Revised assessment" }) };
    rows = [[{ ...appointment, patientId: "patient-own" }], [{ ...note, isFinal: true }], [amended]];
    const response = await app.inject({ method: "GET", url: "/doctor/appointments/appointment-own/consultation" });
    expect(response.statusCode).toBe(200);
    expect(response.json().note.assessment).toBe("Reviewed assessment");
    expect(response.json().note_amendments[0]).toMatchObject({ reason: "Correction", doctor_id: "doctor-own", created_at: "2026-10-25T09:00:00.000Z", sections: { assessment: "Revised assessment" } });
  });

  it("appends corrected sections without updating the original finalized note", async () => {
    rows = [[{ id: "encounter-own", patientId: "patient-own" }], [{ id: "encounter-own" }], [{ ...note, isFinal: true }]];
    const response = await app.inject({ method: "POST", url: "/doctor/encounters/encounter-own/note/amend", payload: { reason: "Correction", assessment: "Revised assessment" } });
    expect(response.statusCode).toBe(201);
    expect(mocks.database.update).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].values).toMatchObject({ noteType: "CONSULTATION_AMENDMENT", isFinal: true, content: JSON.stringify({ reason: "Correction", assessment: "Revised assessment" }) });
  });

  it("does not append amendments to an unfinalized consultation", async () => {
    rows = [[{ id: "encounter-own", patientId: "patient-own" }], [{ id: "encounter-own" }], [note]];
    const response = await app.inject({ method: "POST", url: "/doctor/encounters/encounter-own/note/amend", payload: { reason: "Correction", assessment: "Revised assessment" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NOTE_NOT_FINAL");
    expect(writes).toEqual([]);
  });
});
