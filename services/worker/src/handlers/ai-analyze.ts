import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { evaluatePostJudge, logSafetyEvaluation } from "@clinix/api/safety";
import {
  accessEvents,
  aiHistoricalMatches,
  aiJudgments,
  aiModelRuns,
  aiSessions,
} from "@clinix/api/schema";
import {
  analystOutputSchema,
  judgeOutputSchema,
  type AnalystOutput,
  type JudgeOutput,
} from "@clinix/schemas";
import { requireDb } from "../db.js";
import { generateStructured } from "../gateway.js";
import { buildEvidenceBundle } from "../pipeline/evidence-bundle.js";
import {
  ANALYST_1_PROMPT,
  ANALYST_2_PROMPT,
  JUDGE_PROMPT,
} from "../pipeline/prompts.js";
import { buildPatientSafeOutcome } from "../pipeline/post-check.js";

export interface AiAnalyzeJobData {
  aiSessionId: string;
  encounterId: string;
}

/** Hashes frozen pipeline inputs and outputs for audit attribution. */
function hashJson(val: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(val)).digest("hex");
}

/** Processes the queue batch without suppressing failed analysis jobs. */
export async function handleAiAnalyze(
  jobs: Array<{ data: AiAnalyzeJobData }>,
): Promise<void> {
  for (const job of jobs) {
    await processAiAnalyze(job.data);
  }
}

/** Persists a checked patient outcome before publishing a successful session. */
export async function processAiAnalyze(data: AiAnalyzeJobData): Promise<void> {
  const { aiSessionId, encounterId } = data;
  const database = requireDb();

  const [session] = await database
    .select()
    .from(aiSessions)
    .where(eq(aiSessions.id, aiSessionId))
    .limit(1);

  if (!session) {
    throw new Error(`AI Session ${aiSessionId} not found`);
  }

  if (session.encounterId !== encounterId)
    throw new Error("AI job encounter mismatch");
  if (session.status === "SUCCEEDED") return;

  // 1. Mark session as running
  await database
    .update(aiSessions)
    .set({ status: "RUNNING" })
    .where(eq(aiSessions.id, aiSessionId));

  try {
    // 2. Build frozen de-identified Evidence Bundle
    const { payload, payloadHash } = await buildEvidenceBundle(database, {
      aiSessionId: session.id,
      patientId: session.patientId,
      encounterId: session.encounterId,
    });

    // 3. Run Analyst 1 (Family A) and Analyst 2 (Family B) in parallel
    const routeA1 = process.env.MODEL_ROUTE_ANALYST_1 ?? "default-analyst-1";
    const routeA2 = process.env.MODEL_ROUTE_ANALYST_2 ?? "default-analyst-2";
    const routeJudge = process.env.MODEL_ROUTE_JUDGE ?? "default-judge";

    const [a1Result, a2Result] = await Promise.all([
      generateStructured<AnalystOutput>({
        role: "ANALYST_1",
        schema: analystOutputSchema,
        messages: [
          { role: "system", content: ANALYST_1_PROMPT },
          {
            role: "user",
            content: `Evidence Bundle:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      }),
      generateStructured<AnalystOutput>({
        role: "ANALYST_2",
        schema: analystOutputSchema,
        messages: [
          { role: "system", content: ANALYST_2_PROMPT },
          {
            role: "user",
            content: `Evidence Bundle:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      }),
    ]);

    // 4. Record Analyst runs in ai_model_runs
    await database.insert(aiModelRuns).values([
      {
        aiSessionId: session.id,
        role: "ANALYST_1",
        providerRoute: routeA1,
        modelName: routeA1,
        inputHash: payloadHash,
        outputPayload: a1Result as any,
        outputHash: hashJson(a1Result),
        status: "SUCCEEDED",
        completedAt: new Date(),
      },
      {
        aiSessionId: session.id,
        role: "ANALYST_2",
        providerRoute: routeA2,
        modelName: routeA2,
        inputHash: payloadHash,
        outputPayload: a2Result as any,
        outputHash: hashJson(a2Result),
        status: "SUCCEEDED",
        completedAt: new Date(),
      },
    ]);

    // 5. Run Judge for Consensus
    const judgeInput = {
      evidence: payload,
      analyst_1: a1Result,
      analyst_2: a2Result,
    };
    const judgeInputHash = hashJson(judgeInput);

    const judgeResult = await generateStructured<JudgeOutput>({
      role: "JUDGE",
      schema: judgeOutputSchema,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        {
          role: "user",
          content: `Evidence Bundle:\n${JSON.stringify(payload, null, 2)}\n\nAnalyst 1 Assessment:\n${JSON.stringify(a1Result, null, 2)}\n\nAnalyst 2 Assessment:\n${JSON.stringify(a2Result, null, 2)}`,
        },
      ],
    });

    // 6. Record Judge run
    await database.insert(aiModelRuns).values({
      aiSessionId: session.id,
      role: "JUDGE",
      providerRoute: routeJudge,
      modelName: routeJudge,
      inputHash: judgeInputHash,
      outputPayload: judgeResult as any,
      outputHash: hashJson(judgeResult),
      status: "SUCCEEDED",
      completedAt: new Date(),
    });

    // 7. Store consensus judgment
    await database.insert(aiJudgments).values({
      aiSessionId: session.id,
      agreements: judgeResult.agreements,
      materialDisagreements: judgeResult.material_disagreements,
      unsupportedClaims: judgeResult.unsupported_claims,
      questionsToAskNext: judgeResult.questions_to_ask_next,
      safeConsensus: judgeResult.safe_consensus,
      requiresDoctorReview: judgeResult.requires_doctor_review,
      requiresUrgentEscalation: judgeResult.requires_urgent_escalation,
    });

    // 8. Deterministic post-check & historical matching
    const combinedAnalystMatches = [
      ...a1Result.historical_matches,
      ...a2Result.historical_matches,
    ];

    const { outcome, historicalMatches } = buildPatientSafeOutcome(
      payload,
      judgeResult,
      combinedAnalystMatches,
    );

    await logSafetyEvaluation(database, {
      encounterId: session.encounterId,
      aiSessionId: session.id,
      stage: "POST_JUDGE",
      evaluation: evaluatePostJudge({
        ...judgeResult,
        requires_doctor_review:
          outcome.requires_doctor_review ?? judgeResult.requires_doctor_review,
      }),
    });

    // 9. Store historical matches in ai_historical_matches
    for (const match of historicalMatches) {
      await database.insert(aiHistoricalMatches).values({
        aiSessionId: session.id,
        currentEncounterId: session.encounterId,
        historicalEncounterId: match.historical_encounter_id,
        similarityLabel: match.similarity_label,
        similarityScore: match.similarity_score
          ? String(match.similarity_score)
          : null,
        supportingFeatures: match.supporting_features,
        differences: match.differences,
      });
    }

    // 10. Mark session as succeeded
    await database
      .update(aiSessions)
      .set({
        status: "SUCCEEDED",
        patientOutcome: outcome,
        completedAt: new Date(),
      })
      .where(eq(aiSessions.id, session.id));

    // 11. Log immutable audit trail in access_events
    await database.insert(accessEvents).values({
      patientId: session.patientId,
      actorType: "AI_SERVICE",
      action: "AI_PROCESS",
      purpose: "CONSENSUS_ANALYSIS",
      resourceType: "AI_SESSION",
      resourceId: session.id,
      metadata: {
        encounter_id: session.encounterId,
        analyst_1_route: routeA1,
        analyst_2_route: routeA2,
        judge_route: routeJudge,
        matches_found: historicalMatches.length,
      },
    });
  } catch (err) {
    console.error("AI Analysis failed for session", aiSessionId, err);
    await database
      .update(aiSessions)
      .set({
        status: "FAILED",
        completedAt: new Date(),
      })
      .where(eq(aiSessions.id, session.id));
    throw err;
  }
}
