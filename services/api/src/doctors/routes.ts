import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { doctorOnboardingSchema } from "@clinix/schemas";
import { publicRoute } from "../auth/context.js";
import { verifiedBearer } from "../auth/bearer.js";
import { ensureProfile, ProfileRoleConflictError } from "../auth/supabase.js";
import { error, requireDb } from "../http.js";
import { doctors } from "../schema.js";

/** POST /doctors/self — creates profile + doctor row, verification PENDING (API spec §4). */
export async function doctorRoutes(app: FastifyInstance) {
  app.post(
    "/doctors/self",
    { config: publicRoute() },
    async (request, reply) => {
      const identity = await verifiedBearer(request, reply);
      if (!identity) return reply;

      const parsed = doctorOnboardingSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid doctor payload");
      }
      const body = parsed.data;

      const database = requireDb();
      try {
        const result = await database.transaction(async (tx) => {
          const profile = await ensureProfile(identity, "DOCTOR", tx);
          const [existing] = await tx.select().from(doctors)
            .where(eq(doctors.profileId, profile.id)).limit(1);
          if (existing) return { doctor: existing, created: false };

          const [doctor] = await tx.insert(doctors).values({
            profileId: profile.id,
            registrationNumber: body.registration_number,
            registrationAuthority: body.registration_authority,
            qualification: body.qualification ?? null,
            speciality: body.speciality ?? null,
            verificationStatus: "PENDING",
          }).returning({ id: doctors.id, verificationStatus: doctors.verificationStatus });
          return { doctor, created: true };
        });

        return reply.code(result.created ? 201 : 200).send({
          doctor_id: result.doctor.id,
          verification_status: result.doctor.verificationStatus,
        });
      } catch (cause) {
        if (cause instanceof ProfileRoleConflictError) {
          return error(request, reply, 409, "PROFILE_ROLE_CONFLICT", "This account already has a different application role");
        }
        throw cause;
      }
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
