import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prescriptionRoutes } from "./routes.js";
import { prescriptionDraftItems } from "../schema.js";

const mocks = vi.hoisted(() => ({ database: { select: vi.fn(), transaction: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() } }));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({ requireDoctor: () => "doctor-own", authorizePatientAccess: async () => true }));
vi.mock("../audit/log.js", () => ({ logAccess: vi.fn() }));
vi.mock("../appointments/map.js", () => ({ patientNames: async () => new Map() }));
vi.mock("./pdf.js", () => ({ renderPrescriptionPdf: vi.fn() }));

/** Covers persisted per-line review decisions and the server-side finalization gate. */
describe("prescription draft review gate", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let writes: { table: unknown; values: unknown }[];

  beforeEach(async () => {
    rows = []; writes = []; vi.clearAllMocks();
    mocks.database.select.mockImplementation(() => ({ from: () => {
      const source: Record<string, unknown> = {};
      const next = () => { const result = rows.shift() ?? []; const q = Object.assign(Promise.resolve(result), { limit: () => q, orderBy: () => q, for: async () => result }); return q; };
      source.innerJoin = () => source; source.where = next;
      return source;
    } }));
    mocks.database.insert.mockImplementation((table) => ({ values: (values: unknown) => { writes.push({ table, values }); return Object.assign(Promise.resolve([]), { returning: async () => [{ id: "x" }] }); } }));
    mocks.database.update.mockImplementation((table) => ({ set: (values: unknown) => { writes.push({ table, values }); return { where: async () => [] }; } }));
    mocks.database.delete.mockImplementation(() => ({ where: async () => [] }));
    mocks.database.transaction.mockImplementation(async (callback) => callback(mocks.database));
    app = Fastify(); await app.register(prescriptionRoutes);
  });
  afterEach(async () => { await app.close(); });

  const draft = (source: string) => ({ id: "draft-own", doctorId: "doctor-own", encounterId: "enc", status: "DRAFT", source });
  const row = (over: Record<string, unknown> = {}) => ({ medicineName: "Synthetic medicine", dose: "1 tablet", needsReview: true, fieldConfidence: { confidence: 0.4 }, ...over });
  const savedItems = () => (writes.find((w) => w.table === prescriptionDraftItems)?.values as Record<string, unknown>[]);

  it("refuses to finalize while an extracted line is unconfirmed", async () => {
    rows = [[], [draft("OCR")], [row()]];
    const response = await app.inject({ method: "POST", url: "/doctor/prescription-drafts/draft-own/finalize", headers: { "idempotency-key": "k" }, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("REVIEW_REQUIRED");
    expect(writes).toEqual([]);
  });

  it("keeps an unchanged flagged line flagged unless the doctor confirms it", async () => {
    rows = [[draft("OCR")], [row()]];
    const response = await app.inject({ method: "PATCH", url: "/doctor/prescription-drafts/draft-own", payload: { items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet" }] } });
    expect(response.statusCode).toBe(200);
    expect(savedItems()[0]).toMatchObject({ needsReview: true, reviewedAt: null, fieldConfidence: { confidence: 0.4 } });
  });

  it("records the confirming doctor and time when a line is explicitly confirmed", async () => {
    rows = [[draft("OCR")], [row()]];
    await app.inject({ method: "PATCH", url: "/doctor/prescription-drafts/draft-own", payload: { items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet", reviewed: true }] } });
    expect(savedItems()[0]).toMatchObject({ needsReview: false, reviewedByDoctorId: "doctor-own" });
    expect(savedItems()[0].reviewedAt).toBeInstanceOf(Date);
  });

  it("requires fresh confirmation for an edited extracted line and ignores confirmations on none", async () => {
    rows = [[draft("OCR")], [row()]];
    await app.inject({ method: "PATCH", url: "/doctor/prescription-drafts/draft-own", payload: { items: [{ medicine_name: "Synthetic medicine", dose: "2 tablets" }] } });
    expect(savedItems()[0]).toMatchObject({ needsReview: true, fieldConfidence: null, reviewedAt: null });
  });

  it("never flags doctor-authored direct entry lines", async () => {
    rows = [[draft("DIRECT_ENTRY")], [row()]];
    await app.inject({ method: "PATCH", url: "/doctor/prescription-drafts/draft-own", payload: { items: [{ medicine_name: "New medicine" }] } });
    expect(savedItems()[0]).toMatchObject({ needsReview: false });
  });
});
