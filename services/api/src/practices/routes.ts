import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  invitationAcceptSchema,
  memberEndSchema,
  memberRoleChangeSchema,
  practiceCreateSchema,
  practiceInviteSchema,
} from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { verifiedBearer } from "../auth/bearer.js";
import { requireDoctor, requirePracticeRole } from "../auth/guards.js";
import { ensureProfile, ProfileRoleConflictError } from "../auth/supabase.js";
import { error, requireDb } from "../http.js";
import {
  doctors,
  followups,
  notifications,
  practiceMembers,
  practices,
  profiles,
} from "../schema.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** SHA-256 hex digest; invite tokens and contacts are stored only in this form. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Masks a contact for display, e.g. "pr***@example.com". */
function contactHint(contact: string): string {
  const [local, domain] = contact.split("@");
  if (domain) return `${local.slice(0, 2)}***@${domain}`;
  return `${"*".repeat(Math.max(0, contact.length - 3))}${contact.slice(-3)}`;
}

/** Whether an invitation row can still be accepted. */
function inviteState(m: { status: string; inviteExpiresAt: Date | null }): "OPEN" | "EXPIRED" | "REVOKED" | "USED" {
  if (m.status === "REVOKED") return "REVOKED";
  if (m.status !== "INVITED") return "USED";
  if (m.inviteExpiresAt && m.inviteExpiresAt.getTime() < Date.now()) return "EXPIRED";
  return "OPEN";
}

/** Practice, membership and invitation lifecycle (Pages 2c, 25, 25a, 25b). */
export async function practiceRoutes(app: FastifyInstance) {
  /** A doctor creates a practice and becomes its OWNER. */
  app.post("/practices", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const parsed = practiceCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid practice");
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      const [practice] = await tx
        .insert(practices)
        .values({ ...parsed.data, createdByDoctorId: doctorId })
        .returning();
      await tx.insert(practiceMembers).values({
        practiceId: practice!.id,
        profileId: request.auth.profileId,
        role: "OWNER",
        status: "ACTIVE",
        effectiveFrom: new Date(),
      });
      return practice!;
    });
    return reply.code(201).send({ practice_id: result.id, name: result.name });
  });

  /** Practice details for owners and practice doctors. */
  app.get<{ Params: { id: string } }>("/practices/:id", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in member) return member;
    const [row] = await requireDb().select().from(practices).where(eq(practices.id, request.params.id)).limit(1);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Practice not found");
    return { practice_id: row.id, name: row.name, phone: row.phone, address: row.address, can_edit: member.role === "OWNER" };
  });

  /** Only the owner edits practice name, phone and address. */
  app.put<{ Params: { id: string } }>("/practices/:id", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER"], request.params.id);
    if ("statusCode" in member) return member;
    const parsed = practiceCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid practice");
    const [row] = await requireDb()
      .update(practices)
      .set({ name: parsed.data.name, phone: parsed.data.phone ?? null, address: parsed.data.address ?? null, updatedAt: new Date() })
      .where(eq(practices.id, request.params.id))
      .returning();
    return { practice_id: row!.id, name: row!.name, phone: row!.phone, address: row!.address, can_edit: true };
  });

  /** Lists the caller's own active practices. */
  app.get("/practices/mine", async (request) => {
    const memberships = request.auth.memberships ?? [];
    if (memberships.length === 0) return [];
    const rows = await requireDb()
      .select()
      .from(practices)
      .where(inArray(practices.id, memberships.map((m) => m.practiceId)));
    return memberships.map((m) => ({
      member_id: m.memberId,
      practice_id: m.practiceId,
      practice_name: rows.find((p) => p.id === m.practiceId)?.name ?? "Practice",
      role: m.role,
    }));
  });

  /** Team list for owners and practice doctors; ended members stay visible as history. */
  app.get<{ Params: { id: string } }>("/practices/:id/members", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in member) return member;
    const database = requireDb();
    const rows = await database
      .select({ m: practiceMembers, name: profiles.displayName })
      .from(practiceMembers)
      .leftJoin(profiles, eq(profiles.id, practiceMembers.profileId))
      .where(eq(practiceMembers.practiceId, request.params.id))
      .orderBy(desc(practiceMembers.createdAt));
    return rows.map(({ m, name }) => ({
      member_id: m.id,
      display_name: name,
      contact_hint: m.inviteContactHint,
      role: m.role,
      status: m.status === "INVITED" && inviteState(m) === "EXPIRED" ? "EXPIRED" : m.status,
      invite_expires_at: m.inviteExpiresAt?.toISOString() ?? null,
      assigned_doctor_id: m.assignedDoctorId,
      ended_at: m.endedAt?.toISOString() ?? null,
      end_reason: m.endReason,
    }));
  });

  /** Owner/doctor invites a receptionist or assistant. The token is returned once. */
  app.post<{ Params: { id: string } }>("/practices/:id/invitations", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in member) return member;
    const parsed = practiceInviteSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid invitation");
    const database = requireDb();
    if (parsed.data.assigned_doctor_id) {
      const [doc] = await database.select({ id: doctors.id }).from(doctors).where(eq(doctors.id, parsed.data.assigned_doctor_id)).limit(1);
      if (!doc) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
    }
    const token = randomBytes(24).toString("base64url");
    const [row] = await database
      .insert(practiceMembers)
      .values({
        practiceId: request.params.id,
        role: parsed.data.role,
        status: "INVITED",
        inviteContactHash: sha256(parsed.data.contact.toLowerCase()),
        inviteContactHint: contactHint(parsed.data.contact),
        inviteTokenHash: sha256(token),
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedByProfileId: request.auth.profileId,
        assignedDoctorId: parsed.data.assigned_doctor_id ?? null,
      })
      .returning();
    return reply.code(201).send({
      member_id: row!.id,
      invite_token: token,
      invite_path: `/onboarding/staff?token=${token}`,
      expires_at: row!.inviteExpiresAt!.toISOString(),
    });
  });

  /** Issues a new token for a pending or expired invitation. */
  app.post<{ Params: { id: string; memberId: string } }>("/practices/:id/members/:memberId/resend", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in member) return member;
    const database = requireDb();
    const token = randomBytes(24).toString("base64url");
    const [row] = await database
      .update(practiceMembers)
      .set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS), updatedAt: new Date() })
      .where(and(eq(practiceMembers.id, request.params.memberId), eq(practiceMembers.practiceId, request.params.id), eq(practiceMembers.status, "INVITED")))
      .returning();
    if (!row) return error(request, reply, 404, "NOT_FOUND", "No pending invitation");
    return { member_id: row.id, invite_token: token, invite_path: `/onboarding/staff?token=${token}`, expires_at: row.inviteExpiresAt!.toISOString() };
  });

  /** Withdraws a pending invitation. */
  app.post<{ Params: { id: string; memberId: string } }>("/practices/:id/members/:memberId/revoke", async (request, reply) => {
    const member = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in member) return member;
    const [row] = await requireDb()
      .update(practiceMembers)
      .set({ status: "REVOKED", updatedAt: new Date() })
      .where(and(eq(practiceMembers.id, request.params.memberId), eq(practiceMembers.practiceId, request.params.id), eq(practiceMembers.status, "INVITED")))
      .returning();
    if (!row) return error(request, reply, 404, "NOT_FOUND", "No pending invitation");
    return { member_id: row.id, status: row.status };
  });

  /** Loads a membership the caller may manage; the OWNER row is never editable here. */
  async function manageable(
    request: { params: { id: string; memberId: string } },
    database: ReturnType<typeof requireDb>,
  ) {
    const [row] = await database
      .select()
      .from(practiceMembers)
      .where(and(eq(practiceMembers.id, request.params.memberId), eq(practiceMembers.practiceId, request.params.id)))
      .limit(1);
    return row && row.role !== "OWNER" ? row : null;
  }

  /** Role change requires explicit confirmation of the permission change (SCR-047). */
  app.patch<{ Params: { id: string; memberId: string } }>("/practices/:id/members/:memberId/role", async (request, reply) => {
    const actor = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in actor) return actor;
    const parsed = memberRoleChangeSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Confirm the permission change");
    const database = requireDb();
    const target = await manageable(request, database);
    if (!target || target.status !== "ACTIVE") return error(request, reply, 404, "NOT_FOUND", "Active staff member not found");
    const [row] = await database
      .update(practiceMembers)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(eq(practiceMembers.id, target.id))
      .returning();
    return { member_id: row!.id, role: row!.role };
  });

  /** Suspends or restores an active/suspended staff member. */
  for (const [action, from, to] of [
    ["suspend", "ACTIVE", "SUSPENDED"],
    ["restore", "SUSPENDED", "ACTIVE"],
  ] as const) {
    app.post<{ Params: { id: string; memberId: string } }>(`/practices/:id/members/:memberId/${action}`, async (request, reply) => {
      const actor = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
      if ("statusCode" in actor) return actor;
      const database = requireDb();
      const target = await manageable(request, database);
      if (!target || target.status !== from) return error(request, reply, 409, "INVALID_STATE", `Member is not ${from}`);
      const [row] = await database
        .update(practiceMembers)
        .set({ status: to, updatedAt: new Date() })
        .where(eq(practiceMembers.id, target.id))
        .returning();
      return { member_id: row!.id, status: row!.status };
    });
  }

  /** Ends a membership: keeps history, records the reason, reassigns open follow-ups. */
  app.post<{ Params: { id: string; memberId: string } }>("/practices/:id/members/:memberId/end", async (request, reply) => {
    const actor = requirePracticeRole(request, reply, ["OWNER", "DOCTOR"], request.params.id);
    if ("statusCode" in actor) return actor;
    const parsed = memberEndSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "A reason and effective date are required");
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      const target = await manageable(request, tx as unknown as ReturnType<typeof requireDb>);
      if (!target || !["ACTIVE", "SUSPENDED"].includes(target.status)) return null;
      const [row] = await tx
        .update(practiceMembers)
        .set({ status: "FORMER", endedAt: new Date(parsed.data.effective_date), endReason: parsed.data.reason, updatedAt: new Date() })
        .where(eq(practiceMembers.id, target.id))
        .returning();
      await tx
        .update(followups)
        .set({ assignedMemberId: parsed.data.reassign_to_member_id ?? null })
        .where(and(eq(followups.assignedMemberId, target.id), eq(followups.status, "OPEN")));
      return row!;
    });
    if (!result) return error(request, reply, 409, "INVALID_STATE", "Member cannot be ended");
    return { member_id: result.id, status: result.status };
  });

  /** Preview of an invitation for the signed-in invitee: practice, role and state only. */
  app.get<{ Params: { token: string } }>("/practice-invitations/:token", { config: publicRoute() }, async (request, reply) => {
    const identity = await verifiedBearer(request, reply);
    if (!identity) return reply;
    const [row] = await requireDb()
      .select({ m: practiceMembers, practice: practices.name })
      .from(practiceMembers)
      .innerJoin(practices, eq(practices.id, practiceMembers.practiceId))
      .where(eq(practiceMembers.inviteTokenHash, sha256(request.params.token)))
      .limit(1);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Invitation not found");
    return { practice_name: row.practice, role: row.m.role, state: inviteState(row.m), expires_at: row.m.inviteExpiresAt?.toISOString() ?? null };
  });

  /**
   * Accepts an invitation. Existing patient/doctor accounts keep their primary
   * role; a new invitee gets a CLINIC_STAFF profile. Staff access is the ACTIVE row.
   */
  app.post<{ Params: { token: string } }>("/practice-invitations/:token/accept", { config: publicRoute() }, async (request, reply) => {
    const identity = await verifiedBearer(request, reply);
    if (!identity) return reply;
    const parsedContact = invitationAcceptSchema.safeParse(request.body);
    if (!parsedContact.success) return error(request, reply, 400, "VALIDATION_ERROR", "Enter the email or mobile this invitation was sent to");
    const database = requireDb();
    try {
      const result = await database.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(practiceMembers)
          .where(eq(practiceMembers.inviteTokenHash, sha256(request.params.token)))
          .limit(1)
          .for("update");
        if (!row) return { code: 404 as const };
        const state = inviteState(row);
        if (state !== "OPEN") return { code: 409 as const, state };
        if (row.inviteContactHash !== sha256(parsedContact.data.contact.toLowerCase())) return { code: 403 as const };
        const [existing] = await tx.select().from(profiles).where(eq(profiles.supabaseUserId, identity.userId)).limit(1);
        const profile = existing ?? (await ensureProfile(identity, "CLINIC_STAFF", tx));
        const [updated] = await tx
          .update(practiceMembers)
          .set({ status: "ACTIVE", profileId: profile.id, inviteTokenHash: null, effectiveFrom: new Date(), updatedAt: new Date() })
          .where(eq(practiceMembers.id, row.id))
          .returning();
        if (row.invitedByProfileId) {
          await tx.insert(notifications).values({
            recipientProfileId: row.invitedByProfileId,
            type: "PRACTICE_INVITATION_ACCEPTED",
            title: "Invitation accepted",
            body: `A ${row.role.toLowerCase()} joined your practice.`,
            relatedResourceType: "practice_member",
            relatedResourceId: row.id,
          });
        }
        return { code: 200 as const, member: updated!, primaryRole: profile.primaryRole };
      });
      if (result.code === 404) return error(request, reply, 404, "NOT_FOUND", "Invitation not found");
      if (result.code === 403) return error(request, reply, 403, "CONTACT_MISMATCH", "That contact does not match this invitation");
      if (result.code === 409) return error(request, reply, 409, `INVITATION_${result.state}`, "This invitation can no longer be accepted");
      return { member_id: result.member.id, practice_id: result.member.practiceId, role: result.member.role, primary_role: result.primaryRole };
    } catch (cause) {
      if (cause instanceof ProfileRoleConflictError) return error(request, reply, 409, "PROFILE_ROLE_CONFLICT", "Account role conflict");
      throw cause;
    }
  });

  /** Declines an invitation; nothing is granted. */
  app.post<{ Params: { token: string } }>("/practice-invitations/:token/decline", { config: publicRoute() }, async (request, reply) => {
    const identity = await verifiedBearer(request, reply);
    if (!identity) return reply;
    const [row] = await requireDb()
      .update(practiceMembers)
      .set({ status: "REVOKED", updatedAt: new Date() })
      .where(and(eq(practiceMembers.inviteTokenHash, sha256(request.params.token)), eq(practiceMembers.status, "INVITED")))
      .returning();
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Invitation not found");
    return { status: "DECLINED" };
  });
}
