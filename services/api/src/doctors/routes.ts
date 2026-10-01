import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { doctorOnboardingSchema } from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { ensureProfile, verifySession } from "../auth/clerk.js";
import { error, requireDb } from "../http.js";
import { doctors } from "../schema.js";

/** POST /doctors/self — creates profile + doctor row, verification PENDING (API spec §4). */
export async function doctorRoutes(app: FastifyInstance) {
  app.post(
    "/doctors/self",
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

      const parsed = doctorOnboardingSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid doctor payload");
      }
      const body = parsed.data;

      const database = requireDb();
      const profile = await ensureProfile(clerkUserId, "DOCTOR");

      // Idempotent: onboarding twice returns the existing doctor.
      const existing = await database
        .select()
        .from(doctors)
        .where(eq(doctors.profileId, profile.id))
        .limit(1);
      if (existing.length > 0) {
        return {
          doctor_id: existing[0].id,
          verification_status: existing[0].verificationStatus,
        };
      }

      const inserted = await database
        .insert(doctors)
        .values({
          profileId: profile.id,
          registrationNumber: body.registration_number,
          registrationAuthority: body.registration_authority,
          qualification: body.qualification ?? null,
          speciality: body.speciality ?? null,
          verificationStatus: "PENDING",
        })
        .returning({ id: doctors.id, verificationStatus: doctors.verificationStatus });

      return reply.code(201).send({
        doctor_id: inserted[0].id,
        verification_status: inserted[0].verificationStatus,
      });
    },
  );

  app.get("/doctors/self", async (request, reply) => {
    if (request.auth.role !== "DOCTOR" || !request.auth.doctorId) {
      return error(request, reply, 403, "FORBIDDEN", "Doctor profile required");
    }
    const database = requireDb();
    const rows = await database
      .select()
      .from(doctors)
      .where(eq(doctors.id, request.auth.doctorId))
      .limit(1);
    const doctor = rows[0];
    if (!doctor) {
      return error(request, reply, 404, "NOT_FOUND", "Doctor profile not found");
    }
    return {
      doctor_id: doctor.id,
      registration_number: doctor.registrationNumber,
      registration_authority: doctor.registrationAuthority,
      qualification: doctor.qualification,
      speciality: doctor.speciality,
      verification_status: doctor.verificationStatus,
      verified_at: doctor.verifiedAt,
    };
  });
}
