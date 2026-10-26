import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import {
  interactionResponseInputSchema,
  interactionStartSchema,
  type InteractionBlockView,
  type InteractionOption,
} from "@clinix/schemas";
import { requirePatient } from "../auth/guards.js";
import { logAccess } from "../audit/log.js";
import { error, requireDb } from "../http.js";
import {
  aiSessions,
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

/** Saves ordered check-in answers under owner/session locks and preserves safety interruptions. */
export async function interactionRoutes(app: FastifyInstance) {
  app.post("/encounters/:id/interaction/start", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id: encounterId } = request.params as { id: string };
    const parsed = interactionStartSchema.safeParse(request.body);
    if (!parsed.success)
      return error(
        request,
        reply,
        400,
        "VALIDATION_ERROR",
        "A current concern is required",
      );
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      const [enc] = await tx
        .select()
        .from(encounters)
        .where(
          and(
            eq(encounters.id, encounterId),
            eq(encounters.patientId, patientId),
          ),
        )
        .for("update");
      if (!enc) return null;
      const [existing] = await tx
        .select()
        .from(interactionSessions)
        .where(eq(interactionSessions.encounterId, encounterId))
        .orderBy(desc(interactionSessions.startedAt))
        .limit(1);
      if (existing) return { id: existing.id, existing: true };
      await tx
        .update(encounters)
        .set({ chiefConcern: parsed.data.chief_concern })
        .where(eq(encounters.id, encounterId));
      const safety = evaluatePreAi({ chiefConcern: parsed.data.chief_concern });
      await logSafetyEvaluation(tx, {
        encounterId,
        stage: "PRE_AI",
        evaluation: safety,
      });
      const alert =
        safety.action === "BLOCK_NORMAL_FLOW"
          ? {
              severity: safety.severity,
              action: safety.action,
              triggered_rule_ids: safety.triggeredRuleIds,
              message: safety.message,
              emergency_number: safety.emergencyNumber,
            }
          : null;
      const [session] = await tx
        .insert(interactionSessions)
        .values({
          encounterId,
          status: alert ? "ESCALATED" : "IN_PROGRESS",
          currentStep: 1,
          safetyAlert: alert,
        })
        .returning();
      if (alert)
        return {
          interaction_session_id: session.id,
          status: "SAFETY_ESCALATION",
          safety_alert: alert,
        };
      const [block] = await tx
        .insert(interactionBlocks)
        .values({
          interactionSessionId: session.id,
          sequenceNumber: 1,
          blockType: "single_select",
          title: STEP_TITLES[1](parsed.data.chief_concern),
          helpText:
            "Choose the closest answer. Your next question may change based on what you select.",
          options: DEFAULT_OPTIONS[1],
          allowFreeText: true,
        })
        .returning();
      return {
        interaction_session_id: session.id,
        status: "NEEDS_MORE_INFORMATION",
        total_steps: 3,
        next_block: blockView(block),
      };
    });
    if (!result)
      return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
    if ("existing" in result)
      return reply.send({
        interaction_session_id: result.id,
        status: "RESUME",
      });
    return reply.send(result);
  });

  app.post("/interactions/:id/responses", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id } = request.params as { id: string };
    const parsed = interactionResponseInputSchema.safeParse(request.body);
    if (!parsed.success)
      return error(
        request,
        reply,
        400,
        "VALIDATION_ERROR",
        "Invalid response payload",
      );
    const body = parsed.data;
    const result = await requireDb().transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(interactionSessions)
        .where(eq(interactionSessions.id, id))
        .for("update");
      if (!session)
        return { code: 404, message: "Interaction session not found" };
      const [enc] = await tx
        .select()
        .from(encounters)
        .where(
          and(
            eq(encounters.id, session.encounterId),
            eq(encounters.patientId, patientId),
          ),
        )
        .for("update");
      if (!enc) return { code: 404, message: "Interaction session not found" };
      if (session.status === "ESCALATED")
        return {
          status: "SAFETY_ESCALATION",
          safety_alert: session.safetyAlert ?? legacyAlert,
        };
      const [block] = await tx
        .select()
        .from(interactionBlocks)
        .where(
          and(
            eq(interactionBlocks.id, body.block_id),
            eq(interactionBlocks.interactionSessionId, id),
          ),
        )
        .limit(1);
      if (!block || block.sequenceNumber > session.currentStep)
        return {
          code: 409,
          message: "This question is not active in your check-in",
        };
      const options = (block.options ?? []) as InteractionOption[];
      const selected = body.selected_option_ids ?? [];
      if (
        selected.length > 1 ||
        selected.some((o) => !options.some((v) => v.id === o)) ||
        (!selected.length && !body.free_text?.trim()) ||
        (selected.includes("other") && !body.free_text?.trim()) ||
        (body.free_text?.trim() && !block.allowFreeText)
      )
        return {
          code: 400,
          message: "Select a valid answer or describe it in your own words",
        };
      const [previous] = await tx
        .select()
        .from(interactionResponses)
        .where(
          and(
            eq(interactionResponses.interactionBlockId, block.id),
            eq(interactionResponses.patientId, patientId),
          ),
        )
        .limit(1);
      const same =
        previous &&
        JSON.stringify(previous.selectedOptionIds ?? []) ===
          JSON.stringify(selected) &&
        (previous.freeText ?? "") === (body.free_text?.trim() ?? "");
      // A duplicate request returns its saved successor instead of adding a second answer.
      if (same) {
        if (block.sequenceNumber === 3) return { status: "READY_FOR_ANALYSIS" };
        const [next] = await tx
          .select()
          .from(interactionBlocks)
          .where(
            and(
              eq(interactionBlocks.interactionSessionId, id),
              eq(interactionBlocks.sequenceNumber, block.sequenceNumber + 1),
            ),
          )
          .limit(1);
        if (next)
          return {
            status: "NEEDS_MORE_INFORMATION",
            next_block: blockView(next),
          };
      }
      const [analysis] = await tx
        .select({ id: aiSessions.id })
        .from(aiSessions)
        .where(eq(aiSessions.encounterId, enc.id))
        .limit(1);
      if (analysis)
        return {
          code: 409,
          message:
            "Analysis has started. Start a new check-in to change these answers.",
        };
      // Changing an earlier answer invalidates dependent blocks, within this session only.
      const later = await tx
        .select({ id: interactionBlocks.id })
        .from(interactionBlocks)
        .where(
          and(
            eq(interactionBlocks.interactionSessionId, id),
            gt(interactionBlocks.sequenceNumber, block.sequenceNumber),
          ),
        );
      if (later.length) {
        await tx.delete(interactionResponses).where(
          inArray(
            interactionResponses.interactionBlockId,
            later.map((b) => b.id),
          ),
        );
        await tx.delete(interactionBlocks).where(
          inArray(
            interactionBlocks.id,
            later.map((b) => b.id),
          ),
        );
      }
      await tx
        .delete(interactionResponses)
        .where(
          and(
            eq(interactionResponses.interactionBlockId, block.id),
            eq(interactionResponses.patientId, patientId),
          ),
        );
      await tx
        .insert(interactionResponses)
        .values({
          interactionBlockId: block.id,
          patientId,
          selectedOptionIds: selected,
          freeText: body.free_text?.trim() || null,
        });
      const safety = evaluatePreAi({
        chiefConcern: enc.chiefConcern,
        responses: [
          {
            freeText: body.free_text,
            selectedOptionIds: selected,
            optionsText: options
              .filter((o) => selected.includes(o.id))
              .map((o) => o.label)
              .join(" "),
          },
        ],
      });
      await logSafetyEvaluation(tx, {
        encounterId: enc.id,
        stage: "PRE_AI",
        evaluation: safety,
      });
      if (safety.action === "BLOCK_NORMAL_FLOW") {
        const alert = {
          severity: safety.severity,
          action: safety.action,
          triggered_rule_ids: safety.triggeredRuleIds,
          message: safety.message,
          emergency_number: safety.emergencyNumber,
        };
        await tx
          .update(interactionSessions)
          .set({
            status: "ESCALATED",
            safetyAlert: alert,
            currentStep: block.sequenceNumber,
          })
          .where(eq(interactionSessions.id, id));
        return { status: "SAFETY_ESCALATION", safety_alert: alert };
      }
      const nextStep = block.sequenceNumber + 1;
      if (nextStep <= 3) {
        const [next] = await tx
          .insert(interactionBlocks)
          .values({
            interactionSessionId: id,
            sequenceNumber: nextStep,
            blockType: "single_select",
            title: STEP_TITLES[nextStep](enc.chiefConcern ?? "symptom"),
            helpText:
              nextStep === 2
                ? "Severity helps determine whether self-care or doctor consultation is advised."
                : "Associated symptoms help identify related historical episodes.",
            options: DEFAULT_OPTIONS[nextStep],
            allowFreeText: true,
          })
          .returning();
        await tx
          .update(interactionSessions)
          .set({
            currentStep: nextStep,
            status: "IN_PROGRESS",
            completedAt: null,
          })
          .where(eq(interactionSessions.id, id));
        return {
          status: "NEEDS_MORE_INFORMATION",
          next_block: blockView(next),
        };
      }
      await tx
        .update(interactionSessions)
        .set({ status: "COMPLETED", currentStep: 3, completedAt: new Date() })
        .where(eq(interactionSessions.id, id));
      return { status: "READY_FOR_ANALYSIS" };
    });
    if ("code" in result)
      return error(
        request,
        reply,
        result.code!,
        "INVALID_CHECKIN_STATE",
        result.message!,
      );
    return reply.send(result);
  });

  app.get("/interactions/:id", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id } = request.params as { id: string };
    const database = requireDb();
    const [session] = await database
      .select()
      .from(interactionSessions)
      .where(eq(interactionSessions.id, id))
      .limit(1);
    if (!session)
      return error(
        request,
        reply,
        404,
        "NOT_FOUND",
        "Interaction session not found",
      );
    const [enc] = await database
      .select()
      .from(encounters)
      .where(
        and(
          eq(encounters.id, session.encounterId),
          eq(encounters.patientId, patientId),
        ),
      )
      .limit(1);
    if (!enc)
      return error(
        request,
        reply,
        404,
        "NOT_FOUND",
        "Interaction session not found",
      );
    const blocks = await database
      .select()
      .from(interactionBlocks)
      .where(eq(interactionBlocks.interactionSessionId, id))
      .orderBy(asc(interactionBlocks.sequenceNumber));
    const answers = blocks.length
      ? await database
          .select()
          .from(interactionResponses)
          .where(
            and(
              eq(interactionResponses.patientId, patientId),
              inArray(
                interactionResponses.interactionBlockId,
                blocks.map((b) => b.id),
              ),
            ),
          )
      : [];
    await logAccess(request, {
      patientId,
      resourceType: "INTERACTION_SESSION",
      resourceId: id,
      action: "READ",
      purpose: "SELF_CHECKIN_REVIEW",
    });
    const history = blocks.map((b) => ({
      block: blockView(b),
      answer: answers.find((a) => a.interactionBlockId === b.id) ?? null,
    }));
    return reply.send({
      session: {
        id: session.id,
        encounterId: session.encounterId,
        status: session.status,
        currentStep: session.currentStep,
      },
      chief_concern: enc.chiefConcern,
      total_steps: 3,
      history,
      latest_block: blocks.length ? blockView(blocks[blocks.length - 1]) : null,
      safety_alert:
        session.status === "ESCALATED"
          ? (session.safetyAlert ?? legacyAlert)
          : null,
    });
  });
}

/** Serializes only the question fields consumed by the patient interface. */
function blockView(
  block: typeof interactionBlocks.$inferSelect,
): InteractionBlockView {
  return {
    id: block.id,
    sequence_number: block.sequenceNumber,
    block_type: block.blockType,
    title: block.title,
    help_text: block.helpText,
    options: block.options as InteractionOption[],
    allow_free_text: block.allowFreeText,
  };
}

const legacyAlert = {
  severity: "CRITICAL",
  action: "BLOCK_NORMAL_FLOW",
  triggered_rule_ids: [],
  message: "This check-in was paused for urgent medical assessment.",
  emergency_number: "112 / 108",
};
