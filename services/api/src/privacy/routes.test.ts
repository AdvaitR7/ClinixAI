import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privacyRoutes } from "./routes.js";
import { accessEvents, consentScopes, consents, recordRemovalRequests } from "../schema.js";

const mocks = vi.hoisted(() => ({
  database: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  logAccess: vi.fn(),
  auth: { role: "PATIENT", patientId: "patient-1", doctorId: null as string | null, profileId: "profile-1" },
}));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../audit/log.js", () => ({ logAccess: mocks.logAccess }));
vi.mock("../appointments/map.js", () => ({ patientNames: async () => new Map([["patient-1", "Synthetic Patient"]]) }));

const DOCTOR = "11111111-1111-4111-8111-111111111111";
const OTHER_DOCTOR = "22222222-2222-4222-8222-222222222222";

/** Covers consent lifecycle, ledger visibility and removal-request authority with a synthetic database. */
describe("privacy routes", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let writes: { table: unknown; values: unknown }[];

  beforeEach(async () => {
    rows = []; writes = []; vi.clearAllMocks();
    Object.assign(mocks.auth, { role: "PATIENT", patientId: "patient-1", doctorId: null });
    mocks.database.select.mockImplementation(() => ({ from: () => {
      const next = () => { const result = rows.shift() ?? []; const q: any = Object.assign(Promise.resolve(result), { limit: () => q, orderBy: () => q, groupBy: () => q }); return q; };
      const source: any = Object.assign(Promise.resolve([]), {});
      source.innerJoin = () => source; source.leftJoin = () => source; source.where = next; source.groupBy = next;
      return source;
    } }));
    mocks.database.insert.mockImplementation((table) => ({ values: (values: unknown) => { writes.push({ table, values }); return Object.assign(Promise.resolve([]), { returning: async () => [{ id: "new-id", requestedAt: new Date(), status: "OPEN", startsAt: new Date(), expiresAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date(), purpose: "p", granteeId: DOCTOR, ...(values as object) }] }); } }));
    mocks.database.update.mockImplementation((table) => ({ set: (values: unknown) => { writes.push({ table, values }); return { where: () => Object.assign(Promise.resolve([]), { returning: async () => [{ id: "req", patientId: "patient-1", status: (values as { status: string }).status, requestedAt: new Date(), resolvedAt: new Date(), resourceType: "DOCUMENT", resourceId: null, targetActorId: DOCTOR, reason: null, routedAt: null, routingNote: null, resolutionNote: null, decisions: null }] }) }; } }));
    app = Fastify();
    app.decorateRequest("auth", null as never);
    app.addHook("onRequest", async (request) => { (request as unknown as { auth: unknown }).auth = { ...mocks.auth }; });
    await app.register(privacyRoutes);
  });
  afterEach(async () => { await app.close(); });

  it("creates a consent with an expiry, scopes and a ledger row carrying the consent id", async () => {
    rows = [[{ id: DOCTOR, name: "Dr Synthetic", speciality: "Neurology" }]];
    const res = await app.inject({ method: "POST", url: "/patients/self/consents", payload: { doctor_id: DOCTOR, purpose: "Follow-up", expiry: "7_DAYS", scopes: [{ resource_type: "MEDICATION" }] } });
    expect(res.statusCode).toBe(201);
    const consentWrite = writes.find((w) => w.table === consents)!.values as { expiresAt: Date; startsAt: Date };
    expect(consentWrite.expiresAt.getTime() - consentWrite.startsAt.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(writes.find((w) => w.table === consentScopes)?.values).toEqual([expect.objectContaining({ resourceType: "MEDICATION", resourceId: null })]);
    expect(mocks.logAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "SHARE", consentId: "new-id" }));
  });

  it("rejects a consent that names someone else's record", async () => {
    rows = [[{ id: DOCTOR, name: "Dr", speciality: null }], []];
    const res = await app.inject({ method: "POST", url: "/patients/self/consents", payload: { doctor_id: DOCTOR, purpose: "x", expiry: "30_DAYS", scopes: [{ resource_type: "DOCUMENT", resource_id: OTHER_DOCTOR }] } });
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it("refuses consent calls from a doctor", async () => {
    Object.assign(mocks.auth, { role: "DOCTOR", patientId: null, doctorId: DOCTOR });
    expect((await app.inject({ method: "POST", url: "/patients/self/consents", payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/patients/self/access-ledger" })).statusCode).toBe(403);
  });

  it("revokes once and is idempotent afterwards", async () => {
    rows = [[{ id: "c1", purpose: "p", status: "ACTIVE" }]];
    expect((await app.inject({ method: "POST", url: "/patients/self/consents/c1/revoke" })).statusCode).toBe(200);
    expect(writes.find((w) => w.table === consents)?.values).toMatchObject({ status: "REVOKED" });
    expect(mocks.logAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "REVOKE_ACCESS" }));

    writes = []; mocks.logAccess.mockClear();
    rows = [[{ id: "c1", purpose: "p", status: "REVOKED" }]];
    expect((await app.inject({ method: "POST", url: "/patients/self/consents/c1/revoke" })).statusCode).toBe(200);
    expect(writes).toEqual([]);
    expect(mocks.logAccess).not.toHaveBeenCalled();
  });

  it("404s revoking a consent that is not the patient's", async () => {
    rows = [[]];
    expect((await app.inject({ method: "POST", url: "/patients/self/consents/other/revoke" })).statusCode).toBe(404);
  });

  it("builds a human-readable ledger with counts and category filter", async () => {
    const at = new Date("2026-10-26T10:00:00Z");
    rows = [
      [{ actorType: "DOCTOR", action: "VIEW", n: 3 }, { actorType: "AI_SERVICE", action: "AI_PROCESS", n: 2 }, { actorType: "CLINIC_STAFF", action: "VIEW", n: 1 }],
      [
        { id: "e1", createdAt: at, actorType: "DOCTOR", actorName: "Dr Synthetic", action: "VIEW", purpose: "Consultation", resourceType: "PATIENT_WORKSPACE", consentId: "c1" },
        { id: "e2", createdAt: at, actorType: "AI_SERVICE", actorName: null, action: "AI_PROCESS", purpose: "CONSENSUS_ANALYSIS", resourceType: "AI_SESSION", consentId: null },
      ],
    ];
    const res = await app.inject({ method: "GET", url: "/patients/self/access-ledger?category=AI" });
    const body = res.json();
    expect(body.counts).toEqual({ all: 6, clinical: 3, admin: 1, ai: 2 });
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ category: "AI", actor: { display_name: "ClinixAI" }, action: "Analysed by AI", resource_label: "AI check-in result" });
    expect(JSON.stringify(body)).not.toContain("request_id");
  });

  it("only exposes append paths for the ledger (no write routes)", async () => {
    expect((await app.inject({ method: "DELETE", url: "/patients/self/access-ledger" })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/patients/self/access-ledger", payload: {} })).statusCode).toBe(404);
    expect(writes.some((w) => w.table === accessEvents)).toBe(false);
  });

  it("creates a removal request, not a deletion", async () => {
    rows = [[{ id: DOCTOR, name: "Dr", speciality: null }]];
    const res = await app.inject({ method: "POST", url: "/patients/self/record-removal-requests", payload: { target_actor_type: "DOCTOR", target_actor_id: DOCTOR, resource_type: "DOCUMENT", reason: "Old image" } });
    expect(res.statusCode).toBe(201);
    expect(writes.find((w) => w.table === recordRemovalRequests)?.values).toMatchObject({ patientId: "patient-1", targetActorId: DOCTOR });
    expect(writes.some((w) => w.table !== recordRemovalRequests)).toBe(false);
  });

  it("requires a written reason for partial approval and retention", async () => {
    Object.assign(mocks.auth, { role: "DOCTOR", patientId: null, doctorId: DOCTOR });
    const partial = await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "PARTIALLY_APPROVED", decisions: [{ resource_type: "DOCUMENT", resource_id: null, decision: "REMOVE" }] } });
    expect(partial.statusCode).toBe(400);
    const denied = await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "DENIED" } });
    expect(denied.statusCode).toBe(400);
  });

  it("lets only the addressed doctor resolve, and keeps replays idempotent", async () => {
    Object.assign(mocks.auth, { role: "DOCTOR", patientId: null, doctorId: DOCTOR });
    rows = [[]];
    expect((await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "APPROVED" } })).statusCode).toBe(404);

    const resolved = { id: "req", patientId: "patient-1", status: "APPROVED", resolvedAt: new Date(), requestedAt: new Date(), resourceType: "DOCUMENT", resourceId: null, targetActorId: DOCTOR, reason: null, routedAt: null, routingNote: null, resolutionNote: null, decisions: null };
    rows = [[resolved]];
    const replay = await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "APPROVED" } });
    expect(replay.statusCode).toBe(200);
    expect(writes).toEqual([]);
    rows = [[resolved]];
    const conflict = await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "DENIED", reason: "Retained" } });
    expect(conflict.statusCode).toBe(409);
  });

  it("stops clinic staff from deciding or routing before practice membership exists", async () => {
    Object.assign(mocks.auth, { role: "CLINIC_STAFF", patientId: null, doctorId: null });
    expect((await app.inject({ method: "POST", url: "/doctor/record-removal-requests/req/resolve", payload: { outcome: "APPROVED" } })).statusCode).toBe(403);
    const route = await app.inject({ method: "POST", url: "/record-removal-requests/req/route", payload: { doctor_id: DOCTOR } });
    expect(route.statusCode).toBe(403);
    expect(route.json().error.code).toBe("PRACTICE_MEMBERSHIP_REQUIRED");
  });
});
