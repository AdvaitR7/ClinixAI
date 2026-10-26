import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { patientCheckinOutcomeSchema } from "@clinix/schemas";
import {
  authorizePatientAccess,
  requireDoctor,
  requirePatient,
} from "../auth/guards.js";
import { logAccess } from "../audit/log.js";
import { error, requireDb } from "../http.js";
import {
  aiEvidenceBundles,
  aiSessions,
  encounters,
  interactionSessions,
} from "../schema.js";
import { sendAiAnalysis } from "../queue.js";

/** Exposes owner-only check-in results; cross-record doctor AI awaits scoped consent. */
export async function aiRoutes(app: FastifyInstance) {
  app.post("/encounters/:id/ai-analysis", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id: encounterId } = request.params as { id: string };
    const database = requireDb();
    const [enc] = await database
      .select()
      .from(encounters)
      .where(
        and(
          eq(encounters.id, encounterId),
          eq(encounters.patientId, patientId),
        ),
      )
      .limit(1);
    if (!enc)
      return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
    const [interaction] = await database
      .select()
      .from(interactionSessions)
      .where(eq(interactionSessions.encounterId, encounterId))
      .orderBy(desc(interactionSessions.startedAt))
      .limit(1);
    if (interaction?.status !== "COMPLETED") {
      return error(
        request,
        reply,
        409,
        "CHECKIN_INCOMPLETE",
        "Complete the check-in before analysis. Paused safety checks cannot continue.",
      );
    }
    // Serialize starts for this encounter so retries cannot enqueue concurrent analyses.
    const session = await database.transaction(async (tx) => {
      await tx
        .select({ id: encounters.id })
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .for("update");
      const [current] = await tx
        .select()
        .from(interactionSessions)
        .where(eq(interactionSessions.encounterId, encounterId))
        .orderBy(desc(interactionSessions.startedAt))
        .limit(1);
      if (current?.status !== "COMPLETED") return null;
      const [existing] = await tx
        .select()
        .from(aiSessions)
        .where(
          and(
            eq(aiSessions.encounterId, encounterId),
            eq(aiSessions.patientId, patientId),
          ),
        )
        .orderBy(desc(aiSessions.startedAt))
        .limit(1);
      if (existing && existing.status !== "FAILED")
        return { ...existing, created: false };
      const [created] = await tx
        .insert(aiSessions)
        .values({
          patientId,
          encounterId,
          purpose: "PATIENT_CHECKIN_CONSENSUS",
          status: "QUEUED",
        })
        .returning();
      return { ...created, created: true };
    });
    if (!session)
      return error(
        request,
        reply,
        409,
        "CHECKIN_INCOMPLETE",
        "This check-in is not ready for analysis.",
      );
    if (session.created) {
      try {
        await sendAiAnalysis(session.id, encounterId);
      } catch {
        await database
          .update(aiSessions)
          .set({ status: "FAILED", completedAt: new Date() })
          .where(eq(aiSessions.id, session.id));
        return error(
          request,
          reply,
          503,
          "ANALYSIS_UNAVAILABLE",
          "Analysis could not start. Your answers are saved; retry shortly.",
        );
      }
    }
    return reply
      .code(session.status === "SUCCEEDED" ? 200 : 202)
      .send({ ai_session_id: session.id, status: session.status });
  });

  app.get("/ai-sessions/:id", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id } = request.params as { id: string };
    const [session] = await requireDb()
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.id, id), eq(aiSessions.patientId, patientId)))
      .limit(1);
    if (!session)
      return error(request, reply, 404, "NOT_FOUND", "AI session not found");
    await logAccess(request, {
      patientId,
      resourceType: "AI_SESSION",
      resourceId: id,
      action: "READ",
      purpose: "SELF_CHECKIN_RESULT",
    });
    const checked = patientCheckinOutcomeSchema.safeParse(
      session.patientOutcome,
    );
    // Legacy successes without a checked payload never fall back to raw judge guidance.
    const valid = checked.success && checked.data.disposition !== undefined;
    return reply.send({
      ai_session_id: id,
      encounter_id: session.encounterId,
      status: session.status,
      started_at: session.startedAt?.toISOString(),
      completed_at: session.completedAt?.toISOString() ?? null,
      outcome: session.status === "SUCCEEDED" && valid ? checked.data : null,
      error:
        session.status === "SUCCEEDED" && !valid
          ? "This older result has no checked outcome. Start a new check-in or contact your doctor."
          : null,
    });
  });

  app.get("/ai-sessions/:id/evidence", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const { id } = request.params as { id: string };
    const database = requireDb();
    const [session] = await database
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.id, id), eq(aiSessions.patientId, patientId)))
      .limit(1);
    if (!session)
      return error(request, reply, 404, "NOT_FOUND", "AI session not found");
    const [bundle] = await database
      .select()
      .from(aiEvidenceBundles)
      .where(eq(aiEvidenceBundles.aiSessionId, id))
      .limit(1);
    await logAccess(request, {
      patientId,
      resourceType: "AI_SESSION",
      resourceId: id,
      action: "READ",
      purpose: "SELF_CHECKIN_EVIDENCE",
    });
    const payload = (bundle?.payload ?? {}) as {
      current_concern?: {
        chief_concern?: string;
        responses?: {
          question_title: string;
          selected_options: string[];
          free_text: string | null;
        }[];
      };
      historical_encounters?: {
        id: string;
        chief_concern: string | null;
        started_at: string | null;
      }[];
      relevant_labs?: {
        test_name: string;
        value_numeric: number | null;
        value_text: string | null;
        unit: string | null;
        observed_at: string | null;
      }[];
      historical_prescriptions?: { id: string; finalized_at: string | null }[];
    };
    const sources = [
      ...(payload.current_concern
        ? [
            {
              resource_type: "CURRENT_CONCERN",
              resource_id: session.encounterId,
              description:
                payload.current_concern.chief_concern ?? "Current concern",
              date: null,
            },
          ]
        : []),
      ...(payload.current_concern?.responses ?? []).map((r, i) => ({
        resource_type: "PATIENT_ANSWER",
        resource_id: `${session.encounterId}:${i}`,
        description: `${r.question_title}: ${[...r.selected_options, r.free_text].filter(Boolean).join(", ")}`,
        date: null,
      })),
      ...(payload.historical_encounters ?? []).map((e) => ({
        resource_type: "ENCOUNTER",
        resource_id: e.id,
        description: e.chief_concern ?? "Past consultation",
        date: e.started_at,
      })),
      ...(payload.relevant_labs ?? []).map((l, i) => ({
        resource_type: "LAB_REPORT",
        resource_id: `lab-${i}`,
        description: `${l.test_name}: ${l.value_numeric ?? l.value_text ?? "Unavailable"} ${l.unit ?? ""}`,
        date: l.observed_at,
      })),
      ...(payload.historical_prescriptions ?? []).map((p) => ({
        resource_type: "PRESCRIPTION",
        resource_id: p.id,
        description: "Historical prescription — not authorization for reuse",
        date: p.finalized_at,
      })),
    ];
    return reply.send({ ai_session_id: id, sources });
  });

  // A relationship cannot authorize an AI bundle containing other clinicians' or patient-held records.
  app.get("/doctor/encounters/:id/ai-assistance", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const { id } = request.params as { id: string };
    const [enc] = await requireDb()
      .select()
      .from(encounters)
      .where(
        and(eq(encounters.id, id), eq(encounters.relatedDoctorId, doctorId)),
      )
      .limit(1);
    if (!enc || !(await authorizePatientAccess(request.auth, enc.patientId)))
      return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
    return error(
      request,
      reply,
      403,
      "CONSENT_REQUIRED",
      "AI assistance is unavailable until record-specific consent is supported.",
    );
  });
  app.get("/doctor/patients/:id/ai-assistance", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const { id } = request.params as { id: string };
    if (!(await authorizePatientAccess(request.auth, id)))
      return error(request, reply, 404, "NOT_FOUND", "Patient not found");
    return error(
      request,
      reply,
      403,
      "CONSENT_REQUIRED",
      "AI assistance is unavailable until record-specific consent is supported.",
    );
  });
}
