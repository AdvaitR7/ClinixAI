import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { doctors } from "../schema.js";

/** GET /me — role + domain ids resolved from Postgres (API spec §2). */
export async function meRoutes(app: FastifyInstance) {
  app.get("/me", async (request) => {
    const { profileId, role, patientId, doctorId } = request.auth;

    let verificationStatus: string | null = null;
    if (role === "DOCTOR" && doctorId && db) {
      const rows = await db
        .select({ verificationStatus: doctors.verificationStatus })
        .from(doctors)
        .where(eq(doctors.id, doctorId))
        .limit(1);
      verificationStatus = rows[0]?.verificationStatus ?? null;
    }

    return {
      profile_id: profileId,
      role,
      patient_id: patientId,
      doctor_id: doctorId,
      verification_status: verificationStatus,
    };
  });
}
