import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { doctorProfileUpdateSchema } from "@clinix/schemas";
import { requireDoctor } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import { doctorProfiles, doctors, profiles } from "../schema.js";

/** Public-profile fields a doctor may edit. Verified identity fields are read-only here. */
export async function doctorProfileRoutes(app: FastifyInstance) {
  /** Loads the editable profile alongside the locked, verified fields. */
  app.get("/doctors/self/profile", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const database = requireDb();
    const [doctor] = await database
      .select({ d: doctors, name: profiles.displayName })
      .from(doctors)
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .where(eq(doctors.id, doctorId))
      .limit(1);
    if (!doctor) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
    const [p] = await database.select().from(doctorProfiles).where(eq(doctorProfiles.doctorId, doctorId)).limit(1);
    return {
      locked: {
        display_name: doctor.name,
        registration_number: doctor.d.registrationNumber,
        registration_authority: doctor.d.registrationAuthority,
        qualification: doctor.d.qualification,
        speciality: doctor.d.speciality,
        verification_status: doctor.d.verificationStatus,
      },
      bio: p?.bio ?? null,
      languages: p?.languages ?? [],
      visit_duration_minutes: p?.visitDurationMinutes ?? null,
      services: p?.services ?? [],
      accepting_appointments: p?.acceptingAppointments ?? true,
      directory_visible: p?.directoryVisible ?? true,
    };
  });

  /** Saves editable fields only; unknown or locked keys are rejected by the schema. */
  app.put("/doctors/self/profile", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const parsed = doctorProfileUpdateSchema.strict().safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid profile");
    const b = parsed.data;
    const values = {
      ...(b.bio !== undefined && { bio: b.bio }),
      ...(b.languages !== undefined && { languages: b.languages }),
      ...(b.visit_duration_minutes !== undefined && { visitDurationMinutes: b.visit_duration_minutes }),
      ...(b.services !== undefined && { services: b.services }),
      ...(b.accepting_appointments !== undefined && { acceptingAppointments: b.accepting_appointments }),
      ...(b.directory_visible !== undefined && { directoryVisible: b.directory_visible }),
      updatedAt: new Date(),
    };
    await requireDb().insert(doctorProfiles).values({ doctorId, ...values }).onConflictDoUpdate({ target: doctorProfiles.doctorId, set: values });
    return { ok: true };
  });
}
