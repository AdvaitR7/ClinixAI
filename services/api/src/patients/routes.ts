import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  patientOnboardingSchema,
  patientUpdateSchema,
} from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { verifiedBearer } from "../auth/bearer.js";
import { ensureProfile, ProfileRoleConflictError } from "../auth/supabase.js";
import { encryptIdentity, hashIdentity } from "../crypto.js";
import { error, requireDb } from "../http.js";
import { patientIdentity, patients, profiles } from "../schema.js";
import { decryptMinimal, encryptPatientIdentity, isAdult } from "./identity.js";

/** POST /patients/self — creates profile + patient + encrypted identity (API spec §3). */
export async function patientRoutes(app: FastifyInstance) {
  app.post(
    "/patients/self",
    { config: publicRoute() },
    async (request, reply) => {
      const identity = await verifiedBearer(request, reply);
      if (!identity) return reply;

      const parsed = patientOnboardingSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid onboarding payload");
      }
      const body = parsed.data;
      if (!isAdult(body.date_of_birth)) {
        return error(request, reply, 403, "AGE_REQUIREMENT", "CliniX is for adults aged 18 and over");
      }

      const database = requireDb();
      try {
        const result = await database.transaction(async (tx) => {
          const profile = await ensureProfile(identity, "PATIENT", tx);
          const [existing] = await tx
            .select({ id: patients.id })
            .from(patients)
            .where(eq(patients.accountProfileId, profile.id))
            .limit(1);
          if (existing) return { patientId: existing.id, created: false };

          const [inserted] = await tx
            .insert(patients)
            .values({
              accountProfileId: profile.id,
              status: "ACTIVE",
              claimedAt: new Date(),
              createdByActorType: "PATIENT",
              createdByActorId: profile.id,
            })
            .returning({ id: patients.id });
          await tx.insert(patientIdentity).values({
            patientId: inserted.id,
            ...encryptPatientIdentity(body),
          });
          if (!profile.displayName && body.full_name) {
            await tx.update(profiles)
              .set({ displayName: body.full_name, updatedAt: new Date() })
              .where(eq(profiles.id, profile.id));
          }
          return { patientId: inserted.id, created: true };
        });
        return reply.code(result.created ? 201 : 200).send({ patient_id: result.patientId });
      } catch (cause) {
        if (cause instanceof ProfileRoleConflictError) {
          return error(request, reply, 409, "PROFILE_ROLE_CONFLICT", "This account already has a different application role");
        }
        throw cause;
      }
    },
  );

  app.get("/patients/self", async (request, reply) => {
    if (request.auth.role !== "PATIENT" || !request.auth.patientId) {
      return error(request, reply, 403, "FORBIDDEN", "Patient profile required");
    }
    const database = requireDb();
    const rows = await database
      .select()
      .from(patientIdentity)
      .where(eq(patientIdentity.patientId, request.auth.patientId))
      .limit(1);
    const identity = rows[0];
    if (!identity) {
      return error(request, reply, 404, "NOT_FOUND", "Patient identity not found");
    }
    return {
      patient_id: identity.patientId,
      ...decryptMinimal(identity),
    };
  });

  app.patch("/patients/self", async (request, reply) => {
    if (request.auth.role !== "PATIENT" || !request.auth.patientId) {
      return error(request, reply, 403, "FORBIDDEN", "Patient profile required");
    }
    const parsed = patientUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid patient payload");
    }
    const body = parsed.data;
    if (body.date_of_birth && !isAdult(body.date_of_birth)) {
      return error(request, reply, 403, "AGE_REQUIREMENT", "CliniX is for adults aged 18 and over");
    }
    const database = requireDb();
    const patientId = request.auth.patientId;
    await database
      .update(patientIdentity)
      .set({
        ...(body.full_name ? { fullNameEncrypted: encryptIdentity(body.full_name) } : {}),
        ...(body.phone
          ? { phoneEncrypted: encryptIdentity(body.phone), phoneHash: hashIdentity(body.phone) }
          : {}),
        ...(body.date_of_birth ? { dateOfBirthEncrypted: encryptIdentity(body.date_of_birth) } : {}),
        ...(body.sex_at_registration !== undefined
          ? { sexAtRegistration: body.sex_at_registration }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(patientIdentity.patientId, patientId));
    return { patient_id: patientId };
  });
}
