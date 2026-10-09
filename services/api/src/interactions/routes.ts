import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  interactionResponseInputSchema,
  interactionStartSchema,
  type InteractionBlockView,
  type InteractionOption,
} from "@clinix/schemas";
import { requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  encounters,
  interactionBlocks,
  interactionResponses,
  interactionSessions,
} from "../schema.js";
import { evaluatePreAi, logSafetyEvaluation } from "../safety/evaluator.js";

const DEFAULT_OPTIONS: Record<number, InteractionOption[]> = {
  1: [
    { id: "lt_24h", label: "Less than 24 hours" },
    { id: "1_3d", label: "1–3 days" },
    { id: "4_7d", label: "4–7 days" },
    { id: "gt_1w", label: "More than a week" },
    { id: "other", label: "Something else" },
  ],
  2: [
    { id: "mild", label: "Mild · manageable, minor discomfort" },
    { id: "moderate", label: "Moderate · interfering with normal routine" },
    { id: "severe", label: "Severe · difficult to tolerate" },
    { id: "other", label: "Something else" },
  ],
  3: [
    { id: "fever", label: "Mild fever or chills" },
    { id: "sore_throat", label: "Sore throat or nasal congestion" },
    { id: "fatigue", label: "Unusual tiredness or body aches" },
    { id: "none", label: "No other symptoms" },
    { id: "other", label: "Something else" },
  ],
};

const STEP_TITLES: Record<number, (concern: string) => string> = {
  1: (c) => `How long have you had this ${c || "symptom"}?`,
  2: (c) => `How severe is your ${c || "symptom"} right now?`,
  3: () => `Are you experiencing any other associated symptoms?`,
};

export async function interactionRoutes(app: FastifyInstance) {
  /**
   * POST /encounters/:id/interaction/start (API spec §9)
   * Starts an interactive questioning session linked to an encounter.
   * Runs safety pre-check on initial concern.
   */
  app.post("/encounters/:id/interaction/start", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const { id: encounterId } = request.params as { id: string };
    const parsed = interactionStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid interaction start payload");
    }
    const { chief_concern } = parsed.data;

    const database = requireDb();
    const [enc] = await database
      .select()
      .from(encounters)
      .where(and(eq(encounters.id, encounterId), eq(encounters.patientId, patientId)))
      .limit(1);

    if (!enc) {
      return error(request, reply, 404, "NOT_FOUND", "Encounter not found or unauthorized");
    }

    // Update chief concern on encounter if provided
    await database
      .update(encounters)
      .set({ chiefConcern: chief_concern })
      .where(eq(encounters.id, encounterId));

    // 1. Run deterministic safety pre-check on chief concern
    const safetyCheck = evaluatePreAi({ chiefConcern: chief_concern });
    await logSafetyEvaluation(database, {
      encounterId,
      stage: "PRE_AI",
      evaluation: safetyCheck,
    });

    if (safetyCheck.action === "BLOCK_NORMAL_FLOW") {
      const [interruptedSession] = await database
        .insert(interactionSessions)
        .values({
          encounterId,
          status: "ESCALATED",
          currentStep: 1,
        })
        .returning({ id: interactionSessions.id });

      return reply.code(200).send({
        interaction_session_id: interruptedSession.id,
        status: "SAFETY_ESCALATION",
        safety_alert: {
          severity: safetyCheck.severity,
          action: safetyCheck.action,
          triggered_rule_ids: safetyCheck.triggeredRuleIds,
          message: safetyCheck.message,
          emergency_number: safetyCheck.emergencyNumber,
        },
      });
    }

    // 2. Create interaction session
    const [session] = await database
      .insert(interactionSessions)
      .values({
        encounterId,
        status: "IN_PROGRESS",
        currentStep: 1,
      })
      .returning({ id: interactionSessions.id });

    // 3. Create initial Step 1 Question Block
    const [block] = await database
      .insert(interactionBlocks)
      .values({
        interactionSessionId: session.id,
        sequenceNumber: 1,
        blockType: "single_select",
        title: STEP_TITLES[1](chief_concern),
        helpText: "Choose the closest answer. Your next question may change based on what you select.",
        options: DEFAULT_OPTIONS[1] as any,
        allowFreeText: true,
      })
      .returning();

    const blockView: InteractionBlockView = {
      id: block.id,
      sequence_number: block.sequenceNumber,
      block_type: block.blockType,
      title: block.title,
      help_text: block.helpText,
      options: block.options as InteractionOption[],
      allow_free_text: block.allowFreeText,
    };

    return reply.code(200).send({
      interaction_session_id: session.id,
      status: "NEEDS_MORE_INFORMATION",
      next_block: blockView,
    });
  });

  /**
   * POST /interactions/:id/responses (API spec §9)
   * Submits an answer to the current block. Runs safety evaluation.
   * Advances questioning or flags readiness for AI analysis.
   */
  app.post("/interactions/:id/responses", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const { id: sessionId } = request.params as { id: string };
    const parsed = interactionResponseInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid response payload");
    }
    const body = parsed.data;

    const database = requireDb();
    const [session] = await database
      .select()
      .from(interactionSessions)
      .where(eq(interactionSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return error(request, reply, 404, "NOT_FOUND", "Interaction session not found");
    }

    // Verify encounter ownership
    const [enc] = await database
      .select()
      .from(encounters)
      .where(and(eq(encounters.id, session.encounterId), eq(encounters.patientId, patientId)))
      .limit(1);

    if (!enc) {
      return error(request, reply, 403, "FORBIDDEN", "Unauthorized encounter access");
    }

    // 1. Save patient response
    await database.insert(interactionResponses).values({
      interactionBlockId: body.block_id,
      patientId,
      selectedOptionIds: body.selected_option_ids as any,
      freeText: body.free_text ?? null,
      numericValue: body.numeric_value ? String(body.numeric_value) : null,
      dateValue: body.date_value ? body.date_value : null,
    });

    // 2. Run safety evaluation on the submitted answer
    const safetyCheck = evaluatePreAi({
      chiefConcern: enc.chiefConcern,
      responses: [
        {
          freeText: body.free_text,
          selectedOptionIds: body.selected_option_ids,
        },
      ],
    });

    await logSafetyEvaluation(database, {
      encounterId: enc.id,
      stage: "PRE_AI",
      evaluation: safetyCheck,
    });

    if (safetyCheck.action === "BLOCK_NORMAL_FLOW") {
      await database
        .update(interactionSessions)
        .set({ status: "ESCALATED" })
        .where(eq(interactionSessions.id, sessionId));

      return reply.code(200).send({
        status: "SAFETY_ESCALATION",
        safety_alert: {
          severity: safetyCheck.severity,
          action: safetyCheck.action,
          triggered_rule_ids: safetyCheck.triggeredRuleIds,
          message: safetyCheck.message,
          emergency_number: safetyCheck.emergencyNumber,
        },
      });
    }

    // 3. Advance to next question block or complete
    const nextStep = session.currentStep + 1;

    if (nextStep <= 3) {
      const [nextBlock] = await database
        .insert(interactionBlocks)
        .values({
          interactionSessionId: session.id,
          sequenceNumber: nextStep,
          blockType: "single_select",
          title: STEP_TITLES[nextStep](enc.chiefConcern ?? "symptom"),
          helpText:
            nextStep === 2
              ? "Severity helps determine whether self-care or doctor consultation is advised."
              : "Associated symptoms help identify related historical episodes.",
          options: DEFAULT_OPTIONS[nextStep] as any,
          allowFreeText: true,
        })
        .returning();

      await database
        .update(interactionSessions)
        .set({ currentStep: nextStep })
        .where(eq(interactionSessions.id, sessionId));

      const blockView: InteractionBlockView = {
        id: nextBlock.id,
        sequence_number: nextBlock.sequenceNumber,
        block_type: nextBlock.blockType,
        title: nextBlock.title,
        help_text: nextBlock.helpText,
        options: nextBlock.options as InteractionOption[],
        allow_free_text: nextBlock.allowFreeText,
      };

      return reply.code(200).send({
        status: "NEEDS_MORE_INFORMATION",
        next_block: blockView,
      });
    }

    // Completed all questions -> Ready for AI Analysis
    await database
      .update(interactionSessions)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
      })
      .where(eq(interactionSessions.id, sessionId));

    return reply.code(200).send({
      status: "READY_FOR_ANALYSIS",
    });
  });

  /**
   * GET /interactions/:id
   * Fetches current state of interaction session and active block.
   */
  app.get("/interactions/:id", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const { id: sessionId } = request.params as { id: string };
    const database = requireDb();

    const [session] = await database
      .select()
      .from(interactionSessions)
      .where(eq(interactionSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return error(request, reply, 404, "NOT_FOUND", "Interaction session not found");
    }

    const [latestBlock] = await database
      .select()
      .from(interactionBlocks)
      .where(eq(interactionBlocks.interactionSessionId, sessionId))
      .orderBy(desc(interactionBlocks.sequenceNumber))
      .limit(1);

    return reply.code(200).send({
      session,
      latest_block: latestBlock
        ? {
            id: latestBlock.id,
            sequence_number: latestBlock.sequenceNumber,
            block_type: latestBlock.blockType,
            title: latestBlock.title,
            help_text: latestBlock.helpText,
            options: latestBlock.options,
            allow_free_text: latestBlock.allowFreeText,
          }
        : null,
    });
  });
}
