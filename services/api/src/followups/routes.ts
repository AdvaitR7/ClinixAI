import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { followupCompleteSchema, followupCreateSchema, followupUpdateSchema } from "@clinix/schemas";
import { requireDoctor, requirePatient, requirePracticeRole } from "../auth/guards.js";
import type { PracticeMembership } from "../auth/context.js";
import { patientNames } from "../appointments/map.js";
import { error, requireDb } from "../http.js";
import { encounters, followups, practiceMembers } from "../schema.js";

type FollowupRow = typeof followups.$inferSelect;

/** Serializes a follow-up. A follow-up is a task; it never implies a booked or attended visit. */
function followupView(f: FollowupRow, patientName: string) {
  return {
    id: f.id,
    patient_id: f.patientId,
    patient_name: patientName,
    doctor_id: f.doctorId,
    practice_id: f.practiceId,
    source_encounter_id: f.sourceEncounterId,
    due_at: f.dueAt.toISOString(),
    reason: f.reason,
    status: f.status,
    assigned_member_id: f.assignedMemberId,
    contact_status: f.contactStatus,
    outcome: f.outcome,
    completed_at: f.completedAt?.toISOString() ?? null,
  };
}

/** Follow-up obligations: doctors own them, staff handle contact and scheduling (Pages 21, 21a). */
export async function followupRoutes(app: FastifyInstance) {
  /** Who is calling: the doctor, or a practice staff member, or neither. */
  function actor(request: FastifyRequest<{ Querystring?: { practice_id?: string } }>, reply: FastifyReply) {
    if (request.auth.role === "DOCTOR" && request.auth.doctorId) {
      return { kind: "DOCTOR" as const, doctorId: request.auth.doctorId };
    }
    const member = requirePracticeRole(request, reply, ["RECEPTION", "ASSISTANT"], (request.query as { practice_id?: string } | undefined)?.practice_id);
    if ("statusCode" in member) return member;
    return { kind: "STAFF" as const, member: member as PracticeMembership };
  }

  /** The encounter's doctor schedules a follow-up task. */
  app.post<{ Params: { id: string } }>("/doctor/encounters/:id/followups", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const parsed = followupCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid follow-up");
    const database = requireDb();
    const [encounter] = await database
      .select()
      .from(encounters)
      .where(and(eq(encounters.id, request.params.id), eq(encounters.relatedDoctorId, doctorId)))
      .limit(1);
    if (!encounter) return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
    const practiceId = parsed.data.practice_id ?? encounter.relatedPracticeId ?? null;
    if (practiceId && !(request.auth.memberships ?? []).some((m) => m.practiceId === practiceId)) {
      return error(request, reply, 403, "FORBIDDEN", "You are not a member of that practice");
    }
    const [row] = await database
      .insert(followups)
      .values({
        patientId: encounter.patientId,
        doctorId,
        practiceId,
        sourceEncounterId: encounter.id,
        dueAt: new Date(parsed.data.due_at),
        reason: parsed.data.reason,
      })
      .returning();
    return reply.code(201).send(followupView(row!, ""));
  });

  /** Worklist: doctors see their own; staff see their practice's. */
  app.get<{ Querystring: { status?: string; practice_id?: string } }>("/followups", async (request, reply) => {
    const who = actor(request, reply);
    if ("statusCode" in who) return who;
    const status = request.query.status === "COMPLETED" || request.query.status === "CANCELLED" ? request.query.status : "OPEN";
    const scope = who.kind === "DOCTOR" ? eq(followups.doctorId, who.doctorId) : eq(followups.practiceId, who.member.practiceId);
    const rows = await requireDb().select().from(followups).where(and(scope, eq(followups.status, status))).orderBy(asc(followups.dueAt));
    const names = await patientNames(rows.map((r) => r.patientId));
    return rows.map((r) => followupView(r, names.get(r.patientId) ?? ""));
  });

  /** Task detail, with the same scoping as the worklist. */
  app.get<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/followups/:id", async (request, reply) => {
    const who = actor(request, reply);
    if ("statusCode" in who) return who;
    const row = await loadScoped(who, request.params.id);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Follow-up not found");
    const names = await patientNames([row.patientId]);
    return followupView(row, names.get(row.patientId) ?? "");
  });

  /** Assign, record contact, reschedule. Only doctors may write the clinical outcome. */
  app.patch<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/followups/:id", async (request, reply) => {
    const who = actor(request, reply);
    if ("statusCode" in who) return who;
    const parsed = followupUpdateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid update");
    const body = parsed.data;
    if (body.outcome !== undefined && who.kind !== "DOCTOR") {
      return error(request, reply, 403, "FORBIDDEN", "Only the doctor can record the clinical outcome");
    }
    const row = await loadScoped(who, request.params.id);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Follow-up not found");
    const database = requireDb();
    if (body.assigned_member_id) {
      const [m] = await database
        .select({ id: practiceMembers.id })
        .from(practiceMembers)
        .where(and(eq(practiceMembers.id, body.assigned_member_id), eq(practiceMembers.practiceId, row.practiceId ?? ""), eq(practiceMembers.status, "ACTIVE")))
        .limit(1);
      if (!m) return error(request, reply, 404, "NOT_FOUND", "Assignee is not an active member of this practice");
    }
    const [updated] = await database
      .update(followups)
      .set({
        ...(body.assigned_member_id !== undefined && { assignedMemberId: body.assigned_member_id }),
        ...(body.contact_status && { contactStatus: body.contact_status }),
        ...(body.due_at && { dueAt: new Date(body.due_at) }),
        ...(body.outcome !== undefined && { outcome: body.outcome }),
      })
      .where(eq(followups.id, row.id))
      .returning();
    const names = await patientNames([row.patientId]);
    return followupView(updated!, names.get(row.patientId) ?? "");
  });

  /** Marks the task complete. This records the task as done, not that the visit happened. */
  app.post<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/followups/:id/complete", async (request, reply) => {
    const who = actor(request, reply);
    if ("statusCode" in who) return who;
    const parsed = followupCompleteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid completion");
    if (parsed.data.outcome && who.kind !== "DOCTOR") {
      return error(request, reply, 403, "FORBIDDEN", "Only the doctor can record the clinical outcome");
    }
    const row = await loadScoped(who, request.params.id);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Follow-up not found");
    if (row.status !== "OPEN") return error(request, reply, 409, "INVALID_STATE", "Follow-up is not open");
    const [updated] = await requireDb()
      .update(followups)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        completedByProfileId: request.auth.profileId,
        ...(parsed.data.outcome !== undefined && { outcome: parsed.data.outcome }),
      })
      .where(eq(followups.id, row.id))
      .returning();
    const names = await patientNames([row.patientId]);
    return followupView(updated!, names.get(row.patientId) ?? "");
  });

  /** A patient's own follow-up reminders. Staff-only fields are omitted. */
  app.get("/patients/self/followups", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const rows = await requireDb().select().from(followups).where(and(eq(followups.patientId, patientId), inArray(followups.status, ["OPEN"]))).orderBy(asc(followups.dueAt));
    return rows.map((r) => ({ id: r.id, due_at: r.dueAt.toISOString(), reason: r.reason, status: r.status }));
  });

  /** Loads a follow-up inside the caller's doctor/practice scope. */
  async function loadScoped(
    who: { kind: "DOCTOR"; doctorId: string } | { kind: "STAFF"; member: PracticeMembership },
    id: string,
  ): Promise<FollowupRow | null> {
    const scope = who.kind === "DOCTOR" ? eq(followups.doctorId, who.doctorId) : eq(followups.practiceId, who.member.practiceId);
    const [row] = await requireDb().select().from(followups).where(and(eq(followups.id, id), scope)).limit(1);
    return row ?? null;
  }
}
