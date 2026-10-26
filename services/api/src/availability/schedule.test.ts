import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availabilityRulesSchema, doctorAvailabilitySchema } from "@clinix/schemas";
import { availabilityRoutes } from "./routes.js";
import { computeSlots } from "./slots.js";
import { appointmentRoutes } from "../appointments/routes.js";
import { consultationRoutes } from "../consultations/routes.js";
import { doctorAvailability, encounters } from "../schema.js";

const mocks = vi.hoisted(() => ({ database: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() } }));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../appointments/map.js", () => ({ patientNames: async () => new Map(), appointmentView: (value: unknown) => value }));
vi.mock("../medications/derive.js", () => ({ medicationsForPatient: async () => [] }));
const doctorId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const date = "2099-10-26";
const start = new Date(`${date}T09:00:00+05:30`);
const day = new Date(`${date}T00:00:00Z`).getUTCDay();
const template = [{ day_of_week: day, start_time: "09:00", end_time: "12:00" }];
const base = { doctorId, weeklyTemplate: template, slotDurationMinutes: 30, rules: availabilityRulesSchema.parse({}) };

/** Verifies rules are applied to actual slot instants, without relying on presentation labels. */
describe("availability calendar rules", () => {
  /** Computes one India day for the requested mode and published rule set. */
  function slots(rules = base.rules, mode: "ONLINE" | "IN_PERSON" = "IN_PERSON") {
    return computeSlots(template, 30, new Date(`${date}T00:00:00+05:30`), new Date(`${date}T23:59:59+05:30`), [], { rules, appointmentType: mode });
  }
  it("preserves legacy working windows when rules are absent", () => { expect(slots()).toHaveLength(6); });
  it("removes any slot overlapping a recurring break, including partial intersections", () => {
    const result = slots({ ...base.rules, breaks: [{ day_of_week: day, start_time: "09:15", end_time: "10:15" }] });
    expect(result.map((slot) => slot.start.toISOString())).not.toContain(start.toISOString());
    expect(result[0].start).toEqual(new Date(`${date}T10:30:00+05:30`));
  });
  it("keeps blocked dates closed even when a one-off override exists", () => {
    expect(slots({ ...base.rules, blocked_dates: [{ date, reason: "Synthetic closure" }], overrides: [{ date, intervals: [{ start_time: "10:00", end_time: "11:00" }] }] })).toEqual([]);
  });
  it("replaces only the selected date's recurring windows", () => {
    const result = slots({ ...base.rules, overrides: [{ date, intervals: [{ start_time: "13:00", end_time: "14:00" }] }] });
    expect(result).toHaveLength(2); expect(result[0].start).toEqual(new Date(`${date}T13:00:00+05:30`));
    expect(slots({ ...base.rules, overrides: [{ date, intervals: [] }] })).toEqual([]);
  });
  it("intersects online windows with work hours and leaves in-person slots unaffected", () => {
    const rules = { ...base.rules, online_template: [{ day_of_week: day, start_time: "08:00", end_time: "10:00" }] };
    expect(slots(rules, "ONLINE")).toHaveLength(2); expect(slots(rules)).toHaveLength(6);
    expect(slots({ ...rules, online_template: [] }, "ONLINE")).toEqual([]);
  });
  it("deduplicates legacy overlapping templates and keeps real occupied intervals excluded", () => {
    const result = computeSlots([...template, ...template], 30, start, new Date(`${date}T12:00:00+05:30`), [{ start: new Date(`${date}T09:15:00+05:30`), end: new Date(`${date}T10:00:00+05:30`) }]);
    expect(result).toHaveLength(4); expect(new Set(result.map((slot) => slot.start.getTime())).size).toBe(4);
  });
  it.each([
    { template: [{ ...template[0], start_time: "25:00" }] },
    { template: [{ ...template[0], end_time: "08:00" }] },
    { template: [...template, ...template] },
    { template, rules: { blocked_dates: [{ date: "2099-02-30" }] } },
    { template, rules: { blocked_dates: [{ date }, { date }] } },
    { template, rules: { overrides: [{ date, intervals: [{ start_time: "12:00", end_time: "11:00" }] }] } },
    { template, rules: { overrides: [{ date, intervals: [] }, { date, intervals: [] }] } },
    { template, rules: { online_template: [...template, ...template] } },
    { template, clinic_assignment: "unsupported" },
  ])("rejects malformed, overlapping or unsupported rules: %j", (payload) => { expect(doctorAvailabilitySchema.safeParse(payload).success).toBe(false); });
});

/** Exercises real Fastify guards, saved settings, booking consistency and consultation preconditions. */
describe("schedule API boundaries", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let writes: { table: unknown; values: Record<string, unknown>; conflict?: unknown }[];
  let conditions: { sql: string; params: unknown[] }[];
  let locks: number;
  let role: "PATIENT" | "DOCTOR";
  const dialect = new PgDialect();
  beforeEach(async () => {
    vi.clearAllMocks(); rows = []; writes = []; conditions = []; locks = 0; role = "DOCTOR";
    mocks.database.select.mockImplementation(() => {
      const builder = { from: () => builder, where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        conditions.push(dialect.sqlToQuery(condition));
        const result = Object.assign(Promise.resolve(rows.shift() ?? []), { limit: () => result, orderBy: () => result, for: () => { locks++; return result; } });
        return result;
      } };
      return builder;
    });
    mocks.database.transaction.mockImplementation((run: (tx: unknown) => unknown) => run(mocks.database));
    mocks.database.insert.mockImplementation((table: unknown) => ({ values: (values: Record<string, unknown>) => {
      const write = { table, values, conflict: undefined as unknown }; writes.push(write);
      return { onConflictDoUpdate: async (conflict: unknown) => { write.conflict = conflict; }, returning: async () => [{ id: "encounter-own" }] };
    } }));
    mocks.database.update.mockImplementation((table: unknown) => ({ set: (values: Record<string, unknown>) => { writes.push({ table, values }); return { where: async () => [] }; } }));
    app = Fastify();
    app.addHook("onRequest", async (request) => { request.auth = { role, doctorId: role === "DOCTOR" ? doctorId : null, patientId: role === "PATIENT" ? "patient-own" : null, profileId: "profile-own" } as typeof request.auth; });
    await app.register(availabilityRoutes); await app.register(appointmentRoutes); await app.register(consultationRoutes);
  });
  afterEach(async () => { await app.close(); });
  it("reads exact own settings including all existing rules", async () => {
    const rules = { ...base.rules, blocked_dates: [{ date, reason: "Synthetic closure" }] };
    rows = [[{ ...base, rules }]];
    const response = await app.inject({ method: "GET", url: "/doctors/self/availability" });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ configured: true, template, slot_duration_minutes: 30, rules });
    expect(conditions[0].params).toEqual([doctorId]);
  });
  it("returns an empty unpublished week instead of fictional working hours", async () => {
    rows = [[]];
    const response = await app.inject({ method: "GET", url: "/doctors/self/availability" });
    expect(response.json()).toEqual({ configured: false, template: [], slot_duration_minutes: 30, rules: base.rules });
  });
  it("denies patient access to the static self settings route before querying or writing", async () => {
    role = "PATIENT";
    for (const method of ["GET", "PUT"] as const) {
      const response = await app.inject({ method, url: "/doctors/self/availability", ...(method === "PUT" ? { payload: { template } } : {}) });
      expect(response.statusCode).toBe(403);
    }
    expect(conditions).toEqual([]); expect(writes).toEqual([]);
  });
  it("upserts validated rules under the same doctor lock as patient booking", async () => {
    rows = [[{ id: doctorId }]];
    const rules = { ...base.rules, breaks: [{ ...template[0], start_time: "10:00", end_time: "10:30" }] };
    const response = await app.inject({ method: "PUT", url: "/doctors/self/availability", payload: { template, rules, slot_duration_minutes: 20 } });
    expect(response.statusCode).toBe(200); expect(locks).toBe(1); expect(writes[0].table).toBe(doctorAvailability);
    expect(writes[0].values).toMatchObject({ doctorId, weeklyTemplate: template, slotDurationMinutes: 20, rules });
    expect(writes[0].conflict).toEqual(expect.objectContaining({ set: expect.objectContaining({ rules }) }));
  });
  it("preserves existing exceptions for a legacy PUT that omits rules", async () => {
    rows = [[{ id: doctorId }]];
    await app.inject({ method: "PUT", url: "/doctors/self/availability", payload: { template } });
    expect(writes[0].values).not.toHaveProperty("rules"); expect((writes[0].conflict as { set: unknown }).set).not.toHaveProperty("rules");
  });
  it("rejects invalid rules before capacity locks or database writes", async () => {
    const response = await app.inject({ method: "PUT", url: "/doctors/self/availability", payload: { template: [{ ...template[0], start_time: "17:00", end_time: "09:00" }] } });
    expect(response.statusCode).toBe(400); expect(locks).toBe(0); expect(writes).toEqual([]);
  });
  it("public slots respect blocked dates, online restrictions and existing bookings", async () => {
    rows = [[{ ...base, rules: { ...base.rules, blocked_dates: [{ date, reason: "" }] } }], []];
    const blocked = await app.inject({ method: "GET", url: `/doctors/${doctorId}/availability?from=${date}&to=${date}&type=ONLINE` });
    expect(blocked.json().slots).toEqual([]);
    rows = [[{ ...base, rules: { ...base.rules, online_template: [{ ...template[0], start_time: "10:00", end_time: "11:00" }] } }], [{ scheduledStart: new Date(`${date}T10:00:00+05:30`), scheduledEnd: new Date(`${date}T10:30:00+05:30`) }]];
    const online = await app.inject({ method: "GET", url: `/doctors/${doctorId}/availability?from=${date}&to=${date}&type=ONLINE` });
    expect(online.json().slots).toEqual([{ start: new Date(`${date}T10:30:00+05:30`).toISOString(), end: new Date(`${date}T11:00:00+05:30`).toISOString() }]);
  });
  it.each(["blocked", "break", "online"])("patient booking rechecks %s rules, not merely the returned slot list", async (kind) => {
    role = "PATIENT";
    const rules = { ...base.rules, ...(kind === "blocked" ? { blocked_dates: [{ date, reason: "" }] } : kind === "break" ? { breaks: [{ ...template[0], end_time: "10:00" }] } : { online_template: [] }) };
    rows = [[{ id: doctorId }], [], [{ ...base, rules }], []];
    const response = await app.inject({ method: "POST", url: "/patients/self/appointments", payload: { doctor_id: doctorId, appointment_type: "ONLINE", scheduled_start: start.toISOString() } });
    expect(response.statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it.each(["/doctor/appointments?from=2099-02-30&to=2099-03-01", "/doctor/appointments?from=2099-11-01&to=2099-10-01", `/doctors/${doctorId}/availability?from=2099-02-30&to=2099-03-01`])("rejects invalid date ranges before reading records: %s", async (url) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400); expect(conditions).toEqual([]);
  });
  it("uses India midnight for doctor date filters", async () => {
    rows = [[]];
    const response = await app.inject({ method: "GET", url: `/doctor/appointments?from=${date}&to=${date}` });
    expect(response.statusCode).toBe(200);
    expect(conditions[0].params).toContain(new Date(`${date}T00:00:00+05:30`).toISOString());
    expect(conditions[0].params).toContain(new Date(`${date}T23:59:59.999+05:30`).toISOString());
  });
  it.each(["REQUESTED", "CANCELLED", "NO_SHOW", "COMPLETED"])("does not create an encounter when a %s visit cannot start", async (status) => {
    rows = [[{ id: "visit-own", doctorId, patientId: "patient-own", status, encounterId: null }]];
    const response = await app.inject({ method: "GET", url: "/doctor/appointments/visit-own/consultation" });
    expect(response.statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it("denies a foreign doctor before any consultation record is created", async () => {
    rows = [[{ id: "visit-other", doctorId: "doctor-other", patientId: "patient-other", status: "CONFIRMED" }]];
    const response = await app.inject({ method: "GET", url: "/doctor/appointments/visit-other/consultation" });
    expect(response.statusCode).toBe(403); expect(writes).toEqual([]);
  });
  it("starts an owned online visit with its actual encounter mode", async () => {
    rows = [[{ id: "visit-own", doctorId, patientId: "patient-own", status: "CONFIRMED", appointmentType: "ONLINE", encounterId: null }], [], []];
    const response = await app.inject({ method: "GET", url: "/doctor/appointments/visit-own/consultation" });
    expect(response.statusCode).toBe(200); expect(writes.find((write) => write.table === encounters)?.values.encounterType).toBe("DOCTOR_ONLINE");
  });
});
