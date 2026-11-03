import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DoctorCreatePatient } from "@clinix/schemas";
import { hashIdentity } from "../crypto.js";
import { error, requireDb } from "../http.js";
import { patientDoctorRelationships, patientIdentity, patients } from "../schema.js";
import { encryptPatientIdentity, isAdult } from "./identity.js";

export type CreateUnclaimedPatientResult =
  | { ok: true; patientId: string }
  | { ok: false; code: "AGE_REQUIREMENT" | "DUPLICATE_PATIENT" };

/**
 * Creates an unclaimed patient with an encrypted identity and a relationship to one doctor.
 *
 * Shared by the doctor and staff create-patient routes so the adult check and the
 * duplicate check (a deterministic `phone_hash` lookup that never decrypts) stay identical.
 *
 * @param input.body - Validated create-patient payload.
 * @param input.doctorId - Doctor the patient is linked to.
 * @param input.createdBy - Actor recorded as the creator of the patient row.
 * @returns The new patient id, or the reason creation was refused.
 */
export async function createUnclaimedPatient(input: {
  body: DoctorCreatePatient;
  doctorId: string;
  createdBy: { actorType: "DOCTOR" | "CLINIC_STAFF"; actorId: string };
}): Promise<CreateUnclaimedPatientResult> {
  const { body, doctorId, createdBy } = input;
  if (!isAdult(body.date_of_birth)) return { ok: false, code: "AGE_REQUIREMENT" };

  const database = requireDb();

  // Duplicate check: deterministic phone_hash lookup, never decrypts (Screen 22).
  const dup = await database
    .select({ patientId: patientIdentity.patientId })
    .from(patientIdentity)
    .where(eq(patientIdentity.phoneHash, hashIdentity(body.mobile)))
    .limit(1);
  if (dup.length > 0) return { ok: false, code: "DUPLICATE_PATIENT" };

  const inserted = await database
    .insert(patients)
    .values({
      status: "UNCLAIMED",
      createdByActorType: createdBy.actorType,
      createdByActorId: createdBy.actorId,
    })
    .returning({ id: patients.id });
  const patientId = inserted[0].id;

  await database.insert(patientIdentity).values({
    patientId,
    ...encryptPatientIdentity({
      full_name: body.full_name,
      phone: body.mobile,
      date_of_birth: body.date_of_birth,
      sex_at_registration: body.sex_at_registration,
    }),
  });

  await database.insert(patientDoctorRelationships).values({
    patientId,
    doctorId,
    relationshipType: body.relationship_type ?? "PRIMARY_PHYSICIAN",
    isPreferred: body.preferred ?? false,
  });

  return { ok: true, patientId };
}

/** Maps a refused create-patient result to the shared API error envelope. */
export function createPatientFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  code: "AGE_REQUIREMENT" | "DUPLICATE_PATIENT",
) {
  if (code === "AGE_REQUIREMENT") {
    return error(request, reply, 403, "AGE_REQUIREMENT", "CliniX is for adults aged 18 and over");
  }
  return error(request, reply, 409, "DUPLICATE_PATIENT", "A patient with this mobile number already exists");
}
