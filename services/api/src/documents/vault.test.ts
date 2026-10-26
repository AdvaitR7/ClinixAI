import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentRoutes } from "./routes.js";
import { documents, labObservations } from "../schema.js";

const mocks = vi.hoisted(() => ({ database: { select: vi.fn(), update: vi.fn(), transaction: vi.fn() }, signed: vi.fn(), download: vi.fn(), enqueue: vi.fn(), log: vi.fn() }));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({ requirePatient: () => "patient-own", requireDoctor: () => "doctor-own", authorizePatientAccess: async () => true }));
vi.mock("../storage.js", () => ({ signedViewUrl: mocks.signed, downloadObject: mocks.download, signedUploadUrl: vi.fn() }));
vi.mock("../queue.js", () => ({ sendDocumentExtract: mocks.enqueue }));
vi.mock("../audit/log.js", () => ({ logAccess: mocks.log }));
const obsId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const original = {
  id: obsId, patientId: "patient-own", labReportId: "report-own", testName: "Vitamin D", testCode: null,
  valueNumeric: "24", valueText: null, unit: "ng/mL", referenceLow: "30", referenceHigh: "100", referenceText: "30–100",
  flag: "LOW", confidence: "0.4", observedAt: new Date("2026-06-18T00:00:00Z"), confirmedAt: null, confirmedByProfileId: null,
};
const source = {
  id: "source-own", patientId: "patient-own", deletedAt: null, processingStatus: "NEEDS_REVIEW", documentType: "LAB_REPORT",
  originalFilename: "synthetic.pdf", mimeType: "application/pdf", storageObjectKey: "private-synthetic", createdAt: new Date("2026-10-26T00:00:00Z"),
};

/** Verifies real Fastify source/correction handlers with isolated database, storage and queue boundaries. */
describe("patient Vault lifecycle", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let writes: { table: unknown; values: Record<string, unknown> }[];
  let sql: string[];
  let locks: number;
  let saved: typeof original;
  const dialect = new PgDialect();
  beforeEach(async () => {
    vi.clearAllMocks(); rows = []; writes = []; sql = []; locks = 0; saved = { ...original };
    mocks.signed.mockResolvedValue("https://source.example.test/synthetic.pdf");
    mocks.download.mockResolvedValue(Buffer.from("synthetic bytes"));
    mocks.database.transaction.mockImplementation((run: (tx: unknown) => unknown) => run(mocks.database));
    mocks.database.select.mockImplementation(() => {
      const builder = {
        from: () => builder,
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          sql.push(dialect.sqlToQuery(condition).sql);
          const result = Object.assign(Promise.resolve(rows.shift() ?? []), {
            limit: () => result, orderBy: () => result, for: () => { locks++; return result; },
          });
          return result;
        },
      };
      return builder;
    });
    mocks.database.update.mockImplementation((table: unknown) => ({ set: (values: Record<string, unknown>) => {
      writes.push({ table, values });
      if (table === labObservations) saved = { ...saved, ...values };
      const result = Object.assign(Promise.resolve([]), { returning: async () => [saved] });
      return { where: () => result };
    } }));
    app = Fastify();
    app.addHook("onRequest", async (request) => { request.auth = { role: "PATIENT", patientId: "patient-own", profileId: "profile-own" } as typeof request.auth; });
    await app.register(documentRoutes);
  });
  afterEach(async () => { await app.close(); });

  /** Arranges an owned field with a locked source and the post-update review snapshot. */
  function correctionRows(remaining: unknown[] = []) {
    rows = [[original], [{ id: "report-own", patientId: "patient-own", documentId: source.id }], [source], [original], [{ id: "report-own" }], remaining];
  }
  it("corrects numeric values, recomputes the range flag, records confirmation and clears the source queue", async () => {
    correctionRows([{ ...original, valueNumeric: "34", confirmedAt: new Date() }]);
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { value_numeric: 34, confirmed: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ value_numeric: 34, value_text: null, flag: null, needs_review: false, confidence: 0.4 });
    expect(locks).toBe(1);
    expect(writes).toContainEqual({ table: documents, values: { processingStatus: "COMPLETE" } });
    expect(writes[0].values.confirmedByProfileId).toBe("profile-own");
    expect(mocks.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "CONFIRM", resourceId: "report-own" }));
  });
  it("retains NEEDS_REVIEW until every uncertain field in the source is confirmed", async () => {
    correctionRows([{ ...original, id: "other-field", confirmedAt: null }]);
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { confirmed: true } });
    expect(response.statusCode).toBe(200);
    expect(writes).toContainEqual({ table: documents, values: { processingStatus: "NEEDS_REVIEW" } });
  });
  it("clears the old numeric value and flag when correcting to a textual result", async () => {
    correctionRows([]);
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { value_text: "Not detected", confirmed: true } });
    expect(response.json()).toMatchObject({ value_numeric: null, value_text: "Not detected", flag: null, needs_review: false });
  });
  it("reopens low-confidence review when editing a previously confirmed value without confirmation", async () => {
    correctionRows([original]);
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { value_numeric: 110 } });
    expect(response.json()).toMatchObject({ value_numeric: 110, flag: "HIGH", confirmed_at: null, needs_review: true });
  });
  it("does not compare a corrected unit against the old reference bounds", async () => {
    correctionRows([]);
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { unit: "different-unit", confirmed: true } });
    expect(response.json().flag).toBeNull();
  });
  it.each([{}, { confirmed: false }, { value_numeric: 30, value_text: "thirty" }, { value_numeric: "bad" }])("rejects empty, ambiguous or invalid corrections: %j", async (payload) => {
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload });
    expect(response.statusCode).toBe(400); expect(writes).toHaveLength(0);
  });
  it("denies a foreign patient's field before reading or updating its source", async () => {
    rows = [[{ ...original, patientId: "patient-other" }]];
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { confirmed: true } });
    expect(response.statusCode).toBe(404); expect(writes).toHaveLength(0); expect(locks).toBe(0);
  });
  it("does not update a removed or inaccessible source", async () => {
    correctionRows(); rows[2] = [];
    const response = await app.inject({ method: "PATCH", url: `/patients/self/lab-observations/${obsId}`, payload: { confirmed: true } });
    expect(response.statusCode).toBe(404); expect(writes).toHaveLength(0);
    expect(sql.some((value) => value.includes('"deleted_at" is null'))).toBe(true);
  });
  it.each(["PROCESSING", "NEEDS_REVIEW", "COMPLETE"])("keeps a %s source from being extracted twice on sequential completion replay", async (processingStatus) => {
    rows = [[{ ...source, processingStatus }]];
    const response = await app.inject({ method: "POST", url: `/patients/self/documents/${source.id}/upload-complete`, payload: {} });
    expect(response.statusCode).toBe(200); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("retries an owned failed extraction from the existing stored object", async () => {
    rows = [[{ ...source, processingStatus: "FAILED" }]];
    const response = await app.inject({ method: "POST", url: `/patients/self/documents/${source.id}/upload-complete`, payload: {} });
    expect(response.statusCode).toBe(200); expect(mocks.enqueue).toHaveBeenCalledWith(source.id);
    expect(writes[0].values).toMatchObject({ processingStatus: "PROCESSING", fileSizeBytes: 15 });
  });
  it("returns a failed state when the queue cannot accept the extraction", async () => {
    rows = [[{ ...source, processingStatus: "UPLOADED" }]];
    mocks.enqueue.mockRejectedValueOnce(new Error("Synthetic unavailable queue"));
    const response = await app.inject({ method: "POST", url: `/patients/self/documents/${source.id}/upload-complete`, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(writes.at(-1)?.values).toEqual({ processingStatus: "FAILED" });
  });
  it("never completes missing storage bytes or another patient's upload", async () => {
    rows = [[{ ...source, processingStatus: "UPLOADED" }]];
    mocks.download.mockRejectedValueOnce(new Error("Synthetic missing source"));
    const missing = await app.inject({ method: "POST", url: `/patients/self/documents/${source.id}/upload-complete`, payload: {} });
    expect(missing.statusCode).toBe(404); expect(mocks.enqueue).not.toHaveBeenCalled();
    rows = [[{ ...source, patientId: "patient-other" }]];
    const foreign = await app.inject({ method: "POST", url: `/patients/self/documents/${source.id}/upload-complete`, payload: {} });
    expect(foreign.statusCode).toBe(404); expect(writes).toHaveLength(0);
  });
  it("does not sign a foreign or removed source", async () => {
    for (const changed of [{ patientId: "patient-other" }, { deletedAt: new Date() }]) {
      rows = [[{ ...source, ...changed }]];
      const response = await app.inject({ method: "GET", url: `/patients/self/documents/${source.id}` });
      expect(response.statusCode).toBe(404);
    }
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("omits removed documents from the own shelf predicate", async () => {
    rows = [[]];
    const response = await app.inject({ method: "GET", url: "/patients/self/documents" });
    expect(response.statusCode).toBe(200);
    expect(sql[0]).toContain('"patient_id" ='); expect(sql[0]).toContain('"deleted_at" is null');
  });
});
