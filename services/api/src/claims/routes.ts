import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { patientClaimSchema } from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { verifiedBearer } from "../auth/bearer.js";
import { ensureProfile, ProfileRoleConflictError } from "../auth/supabase.js";
import { authorizePatientAccess, requireDoctor } from "../auth/guards.js";
import { hashIdentity } from "../crypto.js";
import { error, requireDb } from "../http.js";
import {
  patientClaimEvents,
  patientClaimInvites,
  patients,
  profiles,
} from "../schema.js";

const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

class ClaimConflictError extends Error {
  constructor() {
    super("The claim invitation was used by another request.");
    this.name = "ClaimConflictError";
  }
}

/** POST /doctor/patients/{id}/claim-invites (contract extension, API §6 invite side). */
export async function claimRoutes(app: FastifyInstance) {
  app.post<{ Params: { patient_id: string } }>(
    "/doctor/patients/:patient_id/claim-invites",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const patientId = request.params.patient_id;
      const allowed = await authorizePatientAccess(request.auth, patientId);
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient");
      }

      const database = requireDb();
      const [patient] = await database
        .select()
        .from(patients)
        .where(eq(patients.id, patientId))
        .limit(1);
      if (!patient) return error(request, reply, 404, "NOT_FOUND", "Patient not found");
      if (patient.status !== "UNCLAIMED") {
        return error(request, reply, 409, "PATIENT_CLAIMED", "This record is already claimed");
      }

      const token = randomBytes(12).toString("hex");
      const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
      await database.insert(patientClaimInvites).values({
        patientId,
        inviteTokenHash: hashIdentity(token),
        createdByProfileId: request.auth.profileId,
        expiresAt,
        status: "OPEN",
      });

      // Raw token returned exactly once; only its hash is stored.
      return reply.code(201).send({ invite_token: token, expires_at: expiresAt.toISOString() });
    },
  );

  // Public: a brand-new Supabase user has no profiles row yet, so auth would 403
  // ONBOARDING_REQUIRED. Verify the session and lazy-sync the profile here.
  app.post(
    "/patient-claims",
    { config: publicRoute() },
    async (request, reply) => {
      const identity = await verifiedBearer(request, reply);
      if (!identity) return reply;

      const parsed = patientClaimSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid claim payload");
      }

      const database = requireDb();
      const tokenHash = hashIdentity(parsed.data.invite_token);
      let result:
        | { type: "success"; patientId: string }
        | { type: "error"; status: 400 | 409; code: string; message: string };
      try {
        result = await database.transaction(async (tx) => {
          const [invite] = await tx
            .select()
            .from(patientClaimInvites)
            .where(eq(patientClaimInvites.inviteTokenHash, tokenHash))
            .limit(1);
          if (!invite) {
            return { type: "error", status: 400, code: "INVALID_TOKEN", message: "Invalid or unknown claim code" };
          }

          const [existingProfile] = await tx
            .select()
            .from(profiles)
            .where(eq(profiles.supabaseUserId, identity.userId))
            .limit(1)
            .for("update");
          if (existingProfile && existingProfile.primaryRole !== "PATIENT") {
            throw new ProfileRoleConflictError();
          }

          if (invite.status === "USED") {
            if (existingProfile) {
              const [owned] = await tx
                .select()
                .from(patients)
                .where(and(
                  eq(patients.id, invite.patientId),
                  eq(patients.accountProfileId, existingProfile.id),
                ))
                .limit(1);
              if (owned) return { type: "success", patientId: invite.patientId };
            }
            return { type: "error", status: 409, code: "INVITE_USED", message: "This claim code has already been used" };
          }

          if (invite.expiresAt.getTime() < Date.now()) {
            return { type: "error", status: 409, code: "INVITE_EXPIRED", message: "This claim code has expired" };
          }

          // ensureProfile waits for a concurrent onboarding transaction, then
          // holds the same profile lock used by patient/doctor self-onboarding.
          const profile = existingProfile ?? await ensureProfile(identity, "PATIENT", tx);
          const [alreadyOwned] = await tx
            .select({ id: patients.id })
            .from(patients)
            .where(and(
              eq(patients.accountProfileId, profile.id),
              eq(patients.status, "ACTIVE"),
            ))
            .limit(1);
          if (alreadyOwned) {
            return { type: "error", status: 409, code: "ACCOUNT_ALREADY_LINKED", message: "This account is already linked to a patient record" };
          }

          const claimedAt = new Date();
          const updated = await tx
            .update(patients)
            .set({ accountProfileId: profile.id, status: "ACTIVE", claimedAt, updatedAt: claimedAt })
            .where(and(eq(patients.id, invite.patientId), eq(patients.status, "UNCLAIMED")))
            .returning({ id: patients.id });
          if (updated.length === 0) throw new ClaimConflictError();

          const usedInvite = await tx
            .update(patientClaimInvites)
            .set({ status: "USED", usedAt: claimedAt })
            .where(and(eq(patientClaimInvites.id, invite.id), eq(patientClaimInvites.status, "OPEN")))
            .returning({ id: patientClaimInvites.id });
          if (usedInvite.length === 0) throw new ClaimConflictError();

          await tx.insert(patientClaimEvents).values({
            patientId: invite.patientId,
            profileId: profile.id,
            inviteId: invite.id,
            eventType: "CLAIM",
            success: true,
          });
          return { type: "success", patientId: updated[0].id };
        });
      } catch (cause) {
        if (cause instanceof ProfileRoleConflictError) {
          return error(request, reply, 409, "PROFILE_ROLE_CONFLICT", "This account already has a different application role");
        }
        if (cause instanceof ClaimConflictError) {
          return error(request, reply, 409, "INVITE_USED", "This claim code has already been used");
        }
        throw cause;
      }

      if (result.type === "error") {
        return error(request, reply, result.status, result.code, result.message);
      }
      return { patient_id: result.patientId };
    },
  );
}
