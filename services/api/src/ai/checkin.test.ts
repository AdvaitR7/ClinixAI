import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiRoutes } from "./routes.js";
import { interactionRoutes } from "../interactions/routes.js";
import { timelineRoutes } from "../timeline/routes.js";
import {
  aiEvidenceBundles,
  aiSessions,
  encounters,
  interactionBlocks,
  interactionResponses,
  interactionSessions,
} from "../schema.js";
import { buildPatientSafeOutcome } from "../../../worker/src/pipeline/post-check.js";
import { judgeOutputSchema } from "@clinix/schemas";
import type { CanonicalEvidenceBundle } from "../../../worker/src/pipeline/evidence-bundle.js";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  allowed: true,
  consentId: null as string | null,
  log: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../db.js", () => ({ db: mocks.db }));
vi.mock("../audit/log.js", () => ({ logAccess: mocks.log }));
vi.mock("../queue.js", () => ({ sendAiAnalysis: mocks.send }));
vi.mock("../auth/guards.js", () => ({
  requirePatient: (
    req: { auth: { role: string } },
    reply: { code: (n: number) => { send: (v: unknown) => unknown } },
  ) =>
    req.auth.role === "PATIENT"
      ? "patient-own"
      : reply.code(403).send({ error: "Patient required" }),
  requireDoctor: () => "doctor-own",
  authorizePatientAccess: async () => mocks.allowed,
  authorizePatientResource: async () =>
    mocks.consentId
      ? { allowed: true, basis: "CONSENT", consentId: mocks.consentId }
      : { allowed: false, basis: null, consentId: null },
}));

const blockId = "ce226d37-f9fb-4a41-bf08-d448a767801b";
const at = new Date("2026-10-25T09:00:00Z");
const session = {
  id: "session-own",
  encounterId: "encounter-own",
  patientId: "patient-own",
  status: "RUNNING",
  startedAt: at,
  patientOutcome: null,
};
const enc = {
  id: "encounter-own",
  patientId: "patient-own",
  chiefConcern: "Synthetic concern",
};
const block = {
  id: blockId,
  interactionSessionId: "interaction-own",
  sequenceNumber: 1,
  blockType: "single_select",
  title: "How long?",
  helpText: null,
  options: [
    { id: "mild", label: "Mild" },
    { id: "other", label: "Something else" },
  ],
  allowFreeText: true,
};

/** Exercises real handlers with synthetic database boundaries and captured SQL predicates. */
describe("check-in isolation and persistence", () => {
  let app: FastifyInstance;
  let queue: unknown[][];
  let queries: { table: unknown; params: unknown[]; sql: string }[];
  let writes: { table: unknown; values: unknown; operation: string }[];
  let role: string;
  const dialect = new PgDialect();
  beforeEach(async () => {
    vi.clearAllMocks();
    role = "PATIENT";
    mocks.allowed = true;
    mocks.consentId = null;
    mocks.send.mockResolvedValue(undefined);
    mocks.log.mockResolvedValue(undefined);
    queue = [];
    queries = [];
    writes = [];
    mocks.db.select.mockImplementation(() => {
      let table: unknown;
      const result = Object.assign(
        Promise.resolve().then(() => queue.shift() ?? []),
        {
          limit: () => result,
          orderBy: () => result,
          for: () => result,
        },
      );
      const builder = {
        from: (t: unknown) => {
          table = t;
          return builder;
        },
        innerJoin: () => builder,
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          queries.push({ table, ...dialect.sqlToQuery(condition) });
          return result;
        },
      };
      return builder;
    });
    mocks.db.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mocks.db),
    );
    for (const operation of ["insert", "update", "delete"] as const)
      mocks.db[operation].mockImplementation((table: unknown) => {
        const row =
          table === interactionBlocks
            ? { ...block, id: "next-block", sequenceNumber: 2 }
            : { id: "inserted-row", status: "QUEUED" };
        const result = Object.assign(Promise.resolve([row]), {
          returning: () => result,
          where: () => result,
        });
        const builder = {
          values: (values: unknown) => {
            writes.push({ table, values, operation });
            return result;
          },
          set: (values: unknown) => {
            writes.push({ table, values, operation });
            return result;
          },
          where: () => {
            writes.push({ table, values: null, operation });
            return result;
          },
        };
        return builder;
      });
    app = Fastify();
    app.addHook("onRequest", async (req) => {
      req.auth = {
        role: role as "PATIENT",
        patientId: "patient-own",
        doctorId: "doctor-own",
        profileId: "profile-own",
        supabaseUserId: "user-own",
      };
    });
    await app.register(aiRoutes);
    await app.register(interactionRoutes);
    await app.register(timelineRoutes);
  });
  afterEach(async () => {
    await app.close();
  });

  it.each(["/ai-sessions/foreign", "/ai-sessions/foreign/evidence"])(
    "denies foreign or absent sessions before content queries: %s",
    async (url) => {
      queue = [[]];
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(queries).toHaveLength(1);
      expect(queries[0].params).toEqual(["foreign", "patient-own"]);
      expect(mocks.log).not.toHaveBeenCalled();
    },
  );
  it("denies a non-patient before a session read", async () => {
    role = "DOCTOR";
    expect(
      (await app.inject({ method: "GET", url: "/ai-sessions/session-own" }))
        .statusCode,
    ).toBe(403);
    expect(queries).toHaveLength(0);
  });
  it("returns an owner's pending state and logs the read without judge access", async () => {
    queue = [[session]];
    const response = await app.inject({
      method: "GET",
      url: "/ai-sessions/session-own",
    });
    expect(response.json()).toMatchObject({ status: "RUNNING", outcome: null });
    expect(queries).toHaveLength(1);
    expect(mocks.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        patientId: "patient-own",
        resourceId: "session-own",
      }),
    );
  });
  it("serves the stored checked urgent outcome without raw consensus fallbacks", async () => {
    const { outcome } = buildPatientSafeOutcome(
      emptyEvidence(),
      judgeOutputSchema.parse({
        requires_urgent_escalation: true,
        safe_consensus: ["Take amoxicillin"],
      }),
      [],
    );
    queue = [[{ ...session, status: "SUCCEEDED", patientOutcome: outcome }]];
    const response = await app.inject({
      method: "GET",
      url: "/ai-sessions/session-own",
    });
    expect(response.json().outcome).toEqual(outcome);
    expect(response.body).not.toMatch(/Low-risk|amoxicillin|Rest and hydrate/);
    expect(queries).toHaveLength(1);
  });
  it("fails closed for legacy successful sessions without a checked outcome", async () => {
    queue = [[{ ...session, status: "SUCCEEDED" }]];
    expect(
      (
        await app.inject({ method: "GET", url: "/ai-sessions/session-own" })
      ).json(),
    ).toMatchObject({
      outcome: null,
      error: expect.stringContaining("no checked outcome"),
    });
  });
  it("returns actual frozen answer and lab evidence after ownership and logs access", async () => {
    queue = [
      [session],
      [
        {
          payload: {
            current_concern: {
              chief_concern: "Synthetic concern",
              responses: [
                {
                  question_title: "How long?",
                  selected_options: ["1–3 days"],
                  free_text: null,
                },
              ],
            },
            relevant_labs: [
              {
                test_name: "Synthetic lab",
                value_numeric: 0,
                unit: "units",
                observed_at: null,
              },
            ],
          },
        },
      ],
    ];
    const response = await app.inject({
      method: "GET",
      url: "/ai-sessions/session-own/evidence",
    });
    expect(response.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource_type: "PATIENT_ANSWER",
          description: "How long?: 1–3 days",
        }),
        expect.objectContaining({ description: "Synthetic lab: 0 units" }),
      ]),
    );
    expect(queries.map((q) => q.table)).toEqual([
      aiSessions,
      aiEvidenceBundles,
    ]);
    expect(mocks.log).toHaveBeenCalled();
  });
  it("does not expose a foreign interaction's blocks or answers", async () => {
    queue = [[{ id: "foreign", encounterId: "foreign-encounter" }], []];
    expect(
      (await app.inject({ method: "GET", url: "/interactions/foreign" }))
        .statusCode,
    ).toBe(404);
    expect(queries).toHaveLength(2);
    expect(queries[1].params).toContain("patient-own");
    expect(queries.some((q) => q.table === interactionBlocks)).toBe(false);
  });
  it("restores a saved safety interrupt and answers", async () => {
    const alert = { severity: "CRITICAL", message: "Urgent synthetic signal" };
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "ESCALATED",
          currentStep: 1,
          safetyAlert: alert,
        },
      ],
      [enc],
      [block],
      [{ interactionBlockId: blockId, selectedOptionIds: ["mild"] }],
    ];
    const response = await app.inject({
      method: "GET",
      url: "/interactions/interaction-own",
    });
    expect(response.json()).toMatchObject({
      session: { status: "ESCALATED" },
      safety_alert: alert,
      total_steps: 3,
      history: [
        { block: { id: blockId }, answer: { selectedOptionIds: ["mild"] } },
      ],
    });
  });
  it("rejects a block from another session before writing an answer", async () => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "IN_PROGRESS",
          currentStep: 1,
        },
      ],
      [enc],
      [],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/interactions/interaction-own/responses",
      payload: { block_id: blockId, selected_option_ids: ["mild"] },
    });
    expect(response.statusCode).toBe(409);
    expect(writes).toHaveLength(0);
    expect(queries[2].params).toContain("interaction-own");
  });
  it.each([
    { selected_option_ids: ["invented"] },
    { selected_option_ids: ["other"], free_text: " " },
    { selected_option_ids: [] },
  ])("rejects invalid/empty answers: %j", async (payload) => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "IN_PROGRESS",
          currentStep: 1,
        },
      ],
      [enc],
      [block],
    ];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/interactions/interaction-own/responses",
          payload: { block_id: blockId, ...payload },
        })
      ).statusCode,
    ).toBe(400);
    expect(writes).toHaveLength(0);
  });
  it("never resumes an escalated session through response submission", async () => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "ESCALATED",
          safetyAlert: { message: "Paused" },
        },
      ],
      [enc],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/interactions/interaction-own/responses",
      payload: { block_id: blockId, selected_option_ids: ["mild"] },
    });
    expect(response.json()).toMatchObject({ status: "SAFETY_ESCALATION" });
    expect(writes).toHaveLength(0);
  });
  it("returns the saved successor on retry without duplicating a response", async () => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "IN_PROGRESS",
          currentStep: 2,
        },
      ],
      [enc],
      [block],
      [{ selectedOptionIds: ["mild"], freeText: null }],
      [{ ...block, id: "next", sequenceNumber: 2 }],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/interactions/interaction-own/responses",
      payload: { block_id: blockId, selected_option_ids: ["mild"] },
    });
    expect(response.json()).toMatchObject({
      status: "NEEDS_MORE_INFORMATION",
      next_block: { id: "next" },
    });
    expect(writes).toHaveLength(0);
  });
  it("saves a real earlier-answer edit and invalidates only its dependent blocks", async () => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "IN_PROGRESS",
          currentStep: 2,
        },
      ],
      [enc],
      [block],
      [{ selectedOptionIds: ["other"], freeText: "Earlier" }],
      [],
      [{ id: "dependent" }],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/interactions/interaction-own/responses",
      payload: { block_id: blockId, selected_option_ids: ["mild"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      next_block: { sequence_number: 2 },
    });
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: interactionResponses,
          operation: "insert",
          values: expect.objectContaining({
            interactionBlockId: blockId,
            selectedOptionIds: ["mild"],
          }),
        }),
        expect.objectContaining({
          table: interactionSessions,
          operation: "update",
          values: expect.objectContaining({ currentStep: 2 }),
        }),
      ]),
    );
    expect(
      queries.find((q) => q.sql.includes('"sequence_number" >'))?.params,
    ).toContain("interaction-own");
  });
  it("persists a safety alert before returning it", async () => {
    queue = [
      [
        {
          id: "interaction-own",
          encounterId: enc.id,
          status: "IN_PROGRESS",
          currentStep: 1,
        },
      ],
      [enc],
      [block],
      [],
      [],
      [],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/interactions/interaction-own/responses",
      payload: {
        block_id: blockId,
        selected_option_ids: ["other"],
        free_text: "severe chest pain",
      },
    });
    expect(response.json()).toMatchObject({ status: "SAFETY_ESCALATION" });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: interactionSessions,
        values: expect.objectContaining({
          status: "ESCALATED",
          safetyAlert: expect.objectContaining({ action: "BLOCK_NORMAL_FLOW" }),
        }),
      }),
    );
  });
  it("blocks analysis of incomplete or escalated check-ins", async () => {
    queue = [[enc], [{ status: "ESCALATED" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/encounters/encounter-own/ai-analysis",
        })
      ).statusCode,
    ).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("reuses an analysis on retry instead of re-enqueueing", async () => {
    queue = [
      [enc],
      [{ status: "COMPLETED" }],
      [enc],
      [{ status: "COMPLETED" }],
      [session],
    ];
    const response = await app.inject({
      method: "POST",
      url: "/encounters/encounter-own/ai-analysis",
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().ai_session_id).toBe("session-own");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("marks queue dispatch failure FAILED and exposes retry instead of indefinite RUNNING", async () => {
    queue = [
      [enc],
      [{ status: "COMPLETED" }],
      [enc],
      [{ status: "COMPLETED" }],
      [],
    ];
    mocks.send.mockRejectedValue(new Error("Synthetic queue offline"));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/encounters/encounter-own/ai-analysis",
        })
      ).statusCode,
    ).toBe(503);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: aiSessions,
        operation: "update",
        values: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
  it("hides absent encounters, tells related doctors consent is missing, and opens only with a consent scope", async () => {
    queue = [[]];
    expect(
      (await app.inject({ method: "GET", url: "/doctor/encounters/foreign/ai-assistance" })).statusCode,
    ).toBe(404);
    // Unrelated doctor, no consent: existence is not disclosed.
    queue = [[enc]];
    mocks.allowed = false;
    expect(
      (await app.inject({ method: "GET", url: "/doctor/encounters/encounter-own/ai-assistance" })).statusCode,
    ).toBe(404);
    // Related doctor, no consent: consent is named as the missing piece.
    queue = [[enc]];
    mocks.allowed = true;
    const related = await app.inject({ method: "GET", url: "/doctor/encounters/encounter-own/ai-assistance" });
    expect(related.statusCode).toBe(403);
    expect(related.json().error.code).toBe("CONSENT_REQUIRED");
    expect(mocks.log).not.toHaveBeenCalled();
    // Patient-wide route: no analysed check-in to share yet.
    queue = [[]];
    expect(
      (await app.inject({ method: "GET", url: "/doctor/patients/patient-own/ai-assistance" })).statusCode,
    ).toBe(403);
    mocks.allowed = false;
    queue = [[]];
    expect(
      (await app.inject({ method: "GET", url: "/doctor/patients/foreign/ai-assistance" })).statusCode,
    ).toBe(404);
  });
  it("composes doctor AI assistance from a consented check-in and logs the consent", async () => {
    mocks.consentId = "consent-1";
    queue = [
      [enc],
      [{ ...session, status: "SUCCEEDED", patientOutcome: { summary: "Checked summary", questions_for_doctor: ["Any fever?"] } }],
    ];
    const response = await app.inject({ method: "GET", url: "/doctor/encounters/encounter-own/ai-assistance" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      encounter_id: "encounter-own",
      agreements: ["Checked summary"],
      questions_to_ask_patient: ["Any fever?"],
    });
    expect(response.json().consent_locked_sections.length).toBeGreaterThan(0);
    expect(mocks.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consentId: "consent-1", resourceType: "AI_SESSION" }),
    );
  });
  it("projects actual urgent and legacy-unavailable summaries into the timeline", async () => {
    queue = [
      [
        {
          id: "urgent",
          encounterId: enc.id,
          startedAt: at,
          patientOutcome: {
            summary: "Urgent assessment",
            disposition: "URGENT",
          },
        },
        { id: "legacy", encounterId: enc.id, startedAt: at },
      ],
    ];
    const response = await app.inject({
      method: "GET",
      url: "/patients/self/timeline?filter=AI_CHECKINS",
    });
    expect(
      response.json().entries.map((e: { summary: string }) => e.summary),
    ).toEqual([
      "Urgent assessment",
      "Checked outcome unavailable for this older result.",
    ]);
    expect(response.body).not.toContain("Low-risk");
  });
});

/** Supplies an empty, non-sensitive evidence snapshot for deterministic outcome checks. */
function emptyEvidence(): CanonicalEvidenceBundle {
  return {
    encounter_id: "encounter-own",
    demographics: { age_band: "UNKNOWN", biological_sex: null },
    current_concern: { chief_concern: "Synthetic concern", responses: [] },
    allergies: [],
    conditions: [],
    current_medications: [],
    relevant_labs: [],
    historical_encounters: [],
    historical_prescriptions: [],
  };
}

describe("checked patient outcome", () => {
  it.each([
    { requires_urgent_escalation: true, expected: "URGENT" },
    { requires_doctor_review: true, expected: "DOCTOR_REVIEW" },
    { material_disagreements: ["Uncertain"], expected: "DOCTOR_REVIEW" },
    { safe_consensus: ["Record symptom changes"], expected: "SELF_CARE" },
    { expected: "DOCTOR_REVIEW" },
  ])("derives safety disposition: %j", ({ expected, ...flags }) => {
    const result = buildPatientSafeOutcome(
      emptyEvidence(),
      judgeOutputSchema.parse(flags),
      [],
    );
    expect(result.outcome.disposition).toBe(expected);
    expect(result.outcome.low_risk_guidance).toEqual(
      "safe_consensus" in flags ? flags.safe_consensus : [],
    );
    expect(result.outcome.summary).not.toContain("Low-risk");
  });
  it("filters the existing prohibited prescription list and fabricates no historical match or outcome", () => {
    const evidence = emptyEvidence();
    evidence.historical_encounters = [
      {
        id: blockId,
        chief_concern: "Synthetic concern",
        started_at: at.toISOString(),
        encounter_type: "DOCTOR_ONLINE",
      },
    ];
    const judgment = judgeOutputSchema.parse({
      safe_consensus: ["Start amoxicillin", "Record symptom changes"],
    });
    const none = buildPatientSafeOutcome(evidence, judgment, []);
    expect(none.historicalMatches).toEqual([]);
    expect(none.outcome.low_risk_guidance).toEqual(["Record symptom changes"]);
    const matched = buildPatientSafeOutcome(evidence, judgment, [
      {
        encounter_id: blockId,
        similarity_label: "PARTIALLY_SIMILAR",
        supporting_features: [],
        differences: [],
      },
    ]);
    expect(matched.historicalMatches[0].outcome).toBeNull();
    expect(matched.historicalMatches[0].similarity_score).toBeNull();
  });
});
