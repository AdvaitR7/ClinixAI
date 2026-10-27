import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { requireDoctor, requirePracticeRole } from "../auth/guards.js";
import type { AuthContext, PracticeMembership } from "../auth/context.js";
import { vitalsNeedReview } from "../staff/routes.js";

/** Keeps the unit test independent of an external PostgreSQL connection. */
vi.mock("../db.js", () => ({ db: null }));

const PRACTICE_A = "11111111-1111-4111-8111-111111111111";
const PRACTICE_B = "22222222-2222-4222-8222-222222222222";

const membership = (role: PracticeMembership["role"], practiceId = PRACTICE_A): PracticeMembership => ({
  memberId: "33333333-3333-4333-8333-333333333333",
  practiceId,
  role,
  assignedDoctorId: null,
});

/** Builds a tiny app whose auth context is controlled by the test. */
function build(auth: Partial<AuthContext>) {
  const app = Fastify();
  app.decorateRequest("auth");
  app.addHook("onRequest", async (request) => {
    request.auth = {
      supabaseUserId: "s",
      profileId: "p",
      role: "CLINIC_STAFF",
      patientId: null,
      doctorId: null,
      memberships: [],
      ...auth,
    };
  });
  app.get<{ Querystring: { practice_id?: string } }>("/staff", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["RECEPTION", "ASSISTANT"], request.query.practice_id);
    return "statusCode" in member ? member : { role: member.role };
  });
  app.get("/doctor-only", async (request, reply) => {
    const id = requireDoctor(request, reply);
    return typeof id === "string" ? { id } : id;
  });
  return app;
}

describe("practice membership guards", () => {
  it("refuses a user with no active membership", async () => {
    const res = await build({}).inject({ url: "/staff" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PRACTICE_MEMBERSHIP_REQUIRED");
  });

  it("allows a receptionist in the requested practice", async () => {
    const res = await build({ memberships: [membership("RECEPTION")] }).inject({ url: `/staff?practice_id=${PRACTICE_A}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("RECEPTION");
  });

  it("denies cross-practice access", async () => {
    const res = await build({ memberships: [membership("RECEPTION", PRACTICE_A)] }).inject({ url: `/staff?practice_id=${PRACTICE_B}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PRACTICE_MEMBERSHIP_REQUIRED");
  });

  it("denies an owner on an operations-only route", async () => {
    const res = await build({ memberships: [membership("OWNER")] }).inject({ url: `/staff?practice_id=${PRACTICE_A}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("keeps staff out of doctor-only clinical routes", async () => {
    const res = await build({ memberships: [membership("ASSISTANT")] }).inject({ url: "/doctor-only" });
    expect(res.statusCode).toBe(403);
  });
});

describe("intake vitals review flag", () => {
  it("flags out-of-range values for doctor review only", () => {
    expect(vitalsNeedReview({ temperature_c: 38.4 })).toBe(true);
    expect(vitalsNeedReview({ spo2_percent: 93 })).toBe(true);
    expect(vitalsNeedReview({ temperature_c: 36.8, pulse_bpm: 72, systolic_mmhg: 118, diastolic_mmhg: 76, spo2_percent: 98 })).toBe(false);
  });
});
