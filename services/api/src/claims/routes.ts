import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { patientClaimSchema } from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { ensureProfile, verifySession } from "../auth/clerk.js";
import { authorizePatientAccess, requireDoctor } from "../auth/guards.js";
import { hashIdentity } from "../crypto.js";
import { error, requireDb } from "../http.js";
import {
  patientClaimEvents,
  patientClaimInvites,
  patients,
} from "../schema.js";

const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

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

  // Public: a brand-new Clerk user has no profiles row yet, so auth would 403
  // ONBOARDING_REQUIRED. Verify the session and lazy-sync the profile here.
  app.post(
    "/patient-claims",
    { config: publicRoute() },
    async (request, reply) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return error(request, reply, 401, "UNAUTHORIZED", "Missing bearer token");
      }
      let clerkUserId: string;
      try {
        clerkUserId = await verifySession(header.slice("Bearer ".length));
      } catch {
        return error(request, reply, 401, "UNAUTHORIZED", "Invalid session token");
      }

      const parsed = patientClaimSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid claim payload");
      }

      const database = requireDb();
      const profile = await ensureProfile(clerkUserId, "PATIENT");
      const tokenHash = hashIdentity(parsed.data.invite_token);

      const [invite] = await database
        .select()
        .from(patientClaimInvites)
        .where(eq(patientClaimInvites.inviteTokenHash, tokenHash))
        .limit(1);
      if (!invite) {
        return error(request, reply, 400, "INVALID_TOKEN", "Invalid or unknown claim code");
      }

      if (invite.status === "USED") {
        // Idempotent replay: same claimant re-submitting an already-used code.
        const [owned] = await database
          .select()
          .from(patients)
          .where(
            and(
              eq(patients.id, invite.patientId),
              eq(patients.accountProfileId, profile.id),
            ),
          )
          .limit(1);
        if (owned) return { patient_id: invite.patientId };
        return error(request, reply, 409, "INVITE_USED", "This claim code has already been used");
      }

      if (invite.expiresAt.getTime() < Date.now()) {
        return error(request, reply, 409, "INVITE_EXPIRED", "This claim code has expired");
      }

      // The claimer already owns a patient record (onboarded independently).
      const [alreadyOwned] = await database
        .select({ id: patients.id })
        .from(patients)
        .where(
          and(
            eq(patients.accountProfileId, profile.id),
            eq(patients.status, "ACTIVE"),
          ),
        )
        .limit(1);
      if (alreadyOwned) {
        return error(request, reply, 409, "ACCOUNT_ALREADY_LINKED", "This account is already linked to a patient record");
      }

      const claimed = await database.transaction(async (tx) => {
        const updated = await tx
          .update(patients)
          .set({ accountProfileId: profile.id, status: "ACTIVE", claimedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(patients.id, invite.patientId), eq(patients.status, "UNCLAIMED")))
          .returning({ id: patients.id });
        if (updated.length === 0) return null;

        await tx
          .update(patientClaimInvites)
          .set({ status: "USED", usedAt: new Date() })
          .where(eq(patientClaimInvites.id, invite.id));
        await tx.insert(patientClaimEvents).values({
          patientId: invite.patientId,
          profileId: profile.id,
          inviteId: invite.id,
          eventType: "CLAIM",
          success: true,
        });
        return updated[0].id;
      });

      if (!claimed) {
        return error(request, reply, 409, "INVITE_USED", "This claim code has already been used");
      }
      return { patient_id: claimed };
    },
  );
}
