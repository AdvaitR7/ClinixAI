import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { doctors, practices } from "../schema.js";

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

    const memberships = request.auth.memberships ?? [];
    const names = new Map<string, string>();
    if (memberships.length > 0 && db) {
      const rows = await db.select({ id: practices.id, name: practices.name }).from(practices).where(inArray(practices.id, memberships.map((m) => m.practiceId)));
      for (const r of rows) names.set(r.id, r.name);
    }

    return {
      memberships: memberships.map((m) => ({
        member_id: m.memberId,
        practice_id: m.practiceId,
        practice_name: names.get(m.practiceId) ?? "Practice",
        role: m.role,
      })),
      profile_id: profileId,
      role,
      patient_id: patientId,
      doctor_id: doctorId,
      verification_status: verificationStatus,
    };
  });
}
