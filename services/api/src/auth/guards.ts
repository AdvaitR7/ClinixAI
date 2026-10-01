import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { error } from "../http.js";
import { patientDoctorRelationships } from "../schema.js";
import type { AuthContext } from "./context.js";

/** Doctor-only route guard; returns the authenticated doctorId. */
export function requireDoctor(
  request: FastifyRequest,
  reply: FastifyReply,
): string | FastifyReply {
  if (request.auth.role !== "DOCTOR" || !request.auth.doctorId) {
    return error(request, reply, 403, "FORBIDDEN", "Doctor profile required");
  }
  return request.auth.doctorId;
}

/** Patient-only route guard; returns the authenticated patientId. */
export function requirePatient(
  request: FastifyRequest,
  reply: FastifyReply,
): string | FastifyReply {
  if (request.auth.role !== "PATIENT" || !request.auth.patientId) {
    return error(request, reply, 403, "FORBIDDEN", "Patient profile required");
  }
  return request.auth.patientId;
}

/**
 * Patient-resource authorization seam (API spec §36).
 * Phase 2: patient-self OR doctor with an ACTIVE relationship to the patient.
 * ponytail: Phase 6 plugs consent checks + access_events logging here.
 */
export async function authorizePatientAccess(
  auth: AuthContext,
  patientId: string,
): Promise<boolean> {
  if (auth.role === "PATIENT" && auth.patientId === patientId) return true;
  if (auth.role === "DOCTOR" && auth.doctorId && db) {
    const rows = await db
      .select({ id: patientDoctorRelationships.id })
      .from(patientDoctorRelationships)
      .where(
        and(
          eq(patientDoctorRelationships.patientId, patientId),
          eq(patientDoctorRelationships.doctorId, auth.doctorId),
          eq(patientDoctorRelationships.status, "ACTIVE"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  return false;
}
