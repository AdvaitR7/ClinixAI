import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { relationshipUpsertSchema } from "@clinix/schemas";
import { requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  doctors,
  patientDoctorRelationships,
  profiles,
} from "../schema.js";

const relationshipView = (r: {
  doctorId: string;
  name: string;
  speciality: string | null;
  relationshipType: (typeof patientDoctorRelationships.$inferSelect)["relationshipType"];
  isPreferred: boolean;
}) => ({
  doctor_id: r.doctorId,
  doctor_name: r.name,
  speciality: r.speciality,
  relationship_type: r.relationshipType,
  preferred: r.isPreferred,
});

/** GET /doctors — doctor picker for patient booking (documented contract extension). */
async function listDoctors(database: NonNullable<ReturnType<typeof requireDb>>) {
  const rows = await database
    .select({
      doctorId: doctors.id,
      name: profiles.displayName,
      speciality: doctors.speciality,
      verificationStatus: doctors.verificationStatus,
    })
    .from(doctors)
    .innerJoin(profiles, eq(profiles.id, doctors.profileId));
  return rows.map((r) => ({
    doctor_id: r.doctorId,
    name: r.name,
    speciality: r.speciality,
    verification_status: r.verificationStatus,
  }));
}

export async function relationshipRoutes(app: FastifyInstance) {
  app.get("/doctors", async () => {
    const database = requireDb();
    return listDoctors(database);
  });

  app.get("/patients/self/doctors", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const database = requireDb();
    const rows = await database
      .select({
        doctorId: doctors.id,
        name: profiles.displayName,
        speciality: doctors.speciality,
        relationshipType: patientDoctorRelationships.relationshipType,
        isPreferred: patientDoctorRelationships.isPreferred,
      })
      .from(patientDoctorRelationships)
      .innerJoin(doctors, eq(doctors.id, patientDoctorRelationships.doctorId))
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .where(
        and(
          eq(patientDoctorRelationships.patientId, patientId),
          eq(patientDoctorRelationships.status, "ACTIVE"),
        ),
      );
    return rows.map(relationshipView);
  });

  app.post<{ Params: { doctor_id: string } }>(
    "/patients/self/doctors/:doctor_id/relationships",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;

      const parsed = relationshipUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid relationship payload");
      }
      const body = parsed.data;
      const database = requireDb();

      const doctor = await database
        .select({ id: doctors.id })
        .from(doctors)
        .where(eq(doctors.id, request.params.doctor_id))
        .limit(1);
      if (doctor.length === 0) {
        return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
      }

      // A preferred relationship of a type demotes the previous preferred one.
      if (body.preferred) {
        await database
          .update(patientDoctorRelationships)
          .set({ isPreferred: false })
          .where(
            and(
              eq(patientDoctorRelationships.patientId, patientId),
              eq(patientDoctorRelationships.relationshipType, body.relationship_type),
            ),
          );
      }

      const existing = await database
        .select({ id: patientDoctorRelationships.id })
        .from(patientDoctorRelationships)
        .where(
          and(
            eq(patientDoctorRelationships.patientId, patientId),
            eq(patientDoctorRelationships.doctorId, request.params.doctor_id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await database
          .update(patientDoctorRelationships)
          .set({
            relationshipType: body.relationship_type,
            isPreferred: body.preferred ?? false,
          })
          .where(eq(patientDoctorRelationships.id, existing[0].id));
      } else {
        await database.insert(patientDoctorRelationships).values({
          patientId,
          doctorId: request.params.doctor_id,
          relationshipType: body.relationship_type,
          isPreferred: body.preferred ?? false,
        });
      }

      return reply.code(200).send({ ok: true });
    },
  );
}
