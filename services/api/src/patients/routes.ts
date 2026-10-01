import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  patientOnboardingSchema,
  patientUpdateSchema,
} from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { ensureProfile, verifySession } from "../auth/clerk.js";
import { db } from "../db.js";
import { decryptIdentity, encryptIdentity, hashIdentity } from "../crypto.js";
import { patientIdentity, patients, profiles } from "../schema.js";

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

/** Server-enforced 18+ (SCREEN_CATALOG Page 2; CONTEXT §2 adults 18+). */
export function isAdult(dateOfBirth: string): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 18;
}

function error(request: { id: string }, reply: import("fastify").FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message, request_id: request.id } });
}

/** POST /patients/self — creates profile + patient + encrypted identity (API spec §3). */
export async function patientRoutes(app: FastifyInstance) {
  app.post(
    "/patients/self",
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

      const parsed = patientOnboardingSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid onboarding payload");
      }
      const body = parsed.data;
      if (!isAdult(body.date_of_birth)) {
        return error(request, reply, 403, "AGE_REQUIREMENT", "CliniX is for adults aged 18 and over");
      }

      const database = requireDb();
      const profile = await ensureProfile(clerkUserId, "PATIENT");

      // Idempotent: onboarding twice returns the existing patient.
      const existing = await database
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.accountProfileId, profile.id))
        .limit(1);
      if (existing.length > 0) {
        return { patient_id: existing[0].id };
      }

      const inserted = await database
        .insert(patients)
        .values({
          accountProfileId: profile.id,
          status: "ACTIVE",
          claimedAt: new Date(),
          createdByActorType: "PATIENT",
          createdByActorId: profile.id,
        })
        .returning({ id: patients.id });
      const patientId = inserted[0].id;

      await database.insert(patientIdentity).values({
        patientId,
        fullNameEncrypted: encryptIdentity(body.full_name),
        phoneEncrypted: encryptIdentity(body.phone),
        phoneHash: hashIdentity(body.phone),
        dateOfBirthEncrypted: encryptIdentity(body.date_of_birth),
        sexAtRegistration: body.sex_at_registration,
      });

      if (!profile.displayName && body.full_name) {
        await database
          .update(profiles)
          .set({ displayName: body.full_name, updatedAt: new Date() })
          .where(eq(profiles.id, profile.id));
      }

      return reply.code(201).send({ patient_id: patientId });
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
      full_name: decryptIdentity(identity.fullNameEncrypted),
      phone: decryptIdentity(identity.phoneEncrypted),
      date_of_birth: identity.dateOfBirthEncrypted
        ? decryptIdentity(identity.dateOfBirthEncrypted)
        : null,
      sex_at_registration: identity.sexAtRegistration,
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
