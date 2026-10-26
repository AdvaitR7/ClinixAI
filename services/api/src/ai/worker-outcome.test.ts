import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiSessions, safetyEvaluations } from "../schema.js";
import { processAiAnalyze } from "../../../worker/src/handlers/ai-analyze.js";
import { analystOutputSchema, judgeOutputSchema } from "@clinix/schemas";

const mocks = vi.hoisted(() => ({
  database: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  generate: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock("../../../worker/src/db.js", () => ({
  requireDb: () => mocks.database,
}));
vi.mock("../../../worker/src/gateway.js", () => ({
  generateStructured: mocks.generate,
}));
vi.mock("../../../worker/src/pipeline/evidence-bundle.js", () => ({
  buildEvidenceBundle: mocks.evidence,
}));

/** Verifies the worker publishes SUCCEEDED only with the deterministic checked outcome. */
describe("worker checked outcome publication", () => {
  let updates: Record<string, unknown>[];
  let inserts: { table: unknown; values: unknown }[];
  let current: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    updates = [];
    inserts = [];
    current = {
      id: "session-own",
      encounterId: "encounter-own",
      patientId: "patient-own",
      status: "QUEUED",
    };
    mocks.database.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [current] }) }),
    }));
    mocks.database.insert.mockImplementation((table) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), {
          returning: async () => [{ id: "audit" }],
        });
      },
    }));
    mocks.database.update.mockImplementation((table) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === aiSessions) updates.push(values);
        },
      }),
    }));
    mocks.evidence.mockResolvedValue({
      payloadHash: "synthetic-hash",
      payload: {
        historical_encounters: [],
        current_concern: { chief_concern: "Synthetic concern" },
      },
    });
    mocks.generate
      .mockResolvedValueOnce(analystOutputSchema.parse({}))
      .mockResolvedValueOnce(analystOutputSchema.parse({}))
      .mockResolvedValueOnce(
        judgeOutputSchema.parse({
          requires_urgent_escalation: true,
          safe_consensus: ["Start amoxicillin"],
        }),
      );
  });
  it("persists the sanitized urgent outcome in the same update that exposes success", async () => {
    await processAiAnalyze({
      aiSessionId: "session-own",
      encounterId: "encounter-own",
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "SUCCEEDED",
        patientOutcome: expect.objectContaining({
          disposition: "URGENT",
          low_risk_guidance: [],
          requires_urgent_escalation: true,
        }),
      }),
    );
    expect(JSON.stringify(updates)).not.toContain("amoxicillin");
  });
  it("routes an empty checked consensus to doctor review and logs that same safety state", async () => {
    mocks.generate.mockReset();
    mocks.generate
      .mockResolvedValueOnce(analystOutputSchema.parse({}))
      .mockResolvedValueOnce(analystOutputSchema.parse({}))
      .mockResolvedValueOnce(judgeOutputSchema.parse({}));
    await processAiAnalyze({
      aiSessionId: "session-own",
      encounterId: "encounter-own",
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "SUCCEEDED",
        patientOutcome: expect.objectContaining({
          disposition: "DOCTOR_REVIEW",
          low_risk_guidance: [],
        }),
      }),
    );
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: safetyEvaluations,
        values: expect.objectContaining({ severity: "MEDIUM" }),
      }),
    );
  });
  it("marks failed analysis without publishing an unchecked outcome", async () => {
    mocks.evidence.mockRejectedValue(new Error("Synthetic evidence failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        processAiAnalyze({
          aiSessionId: "session-own",
          encounterId: "encounter-own",
        }),
      ).rejects.toThrow("Synthetic evidence failure");
      expect(updates.at(-1)).toMatchObject({ status: "FAILED" });
      expect(updates.some((update) => update.status === "SUCCEEDED")).toBe(
        false,
      );
    } finally {
      log.mockRestore();
    }
  });
  it("does not overwrite an already successful outcome on queue replay", async () => {
    current.status = "SUCCEEDED";
    await processAiAnalyze({
      aiSessionId: "session-own",
      encounterId: "encounter-own",
    });
    expect(updates).toHaveLength(0);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects a job whose encounter does not belong to the session", async () => {
    await expect(
      processAiAnalyze({ aiSessionId: "session-own", encounterId: "foreign" }),
    ).rejects.toThrow("encounter mismatch");
    expect(updates).toHaveLength(0);
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
});
