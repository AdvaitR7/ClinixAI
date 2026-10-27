import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { error } from "../http.js";
import { patientDoctorRelationships } from "../schema.js";
import { activeConsentsForDoctor, consentCovering } from "../privacy/consent.js";
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
 * Consent-aware reads use {@link authorizePatientResource} instead.
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

export type ResourceAccess = {
  allowed: boolean;
  /** Why access was granted: the patient themselves, a record the doctor authored, or a patient consent. */
  basis: "SELF" | "OWN_RECORD" | "CONSENT" | null;
  /** Consent that authorized the read; recorded on the access_events row. */
  consentId: string | null;
};

/**
 * Consent-aware patient-resource authorization (API spec §36). Relationship is
 * NOT permission: a doctor reads (a) records they authored (`ownedByActor`,
 * which still needs an ACTIVE relationship) or (b) anything else only through
 * an ACTIVE, unexpired consent whose scopes cover the resource. Callers write
 * the ledger row with the returned `consentId`.
 */
export async function authorizePatientResource(
  auth: AuthContext,
  e: {
    patientId: string;
    resourceType: string;
    resourceId?: string | null;
    ownedByActor?: boolean;
  },
): Promise<ResourceAccess> {
  const denied: ResourceAccess = { allowed: false, basis: null, consentId: null };
  if (auth.role === "PATIENT") {
    return auth.patientId === e.patientId
      ? { allowed: true, basis: "SELF", consentId: null }
      : denied;
  }
  if (auth.role !== "DOCTOR" || !auth.doctorId || !db) return denied;
  if (e.ownedByActor) {
    return (await authorizePatientAccess(auth, e.patientId))
      ? { allowed: true, basis: "OWN_RECORD", consentId: null }
      : denied;
  }
  const active = await activeConsentsForDoctor(db, e.patientId, auth.doctorId);
  const covering = consentCovering(active, e.resourceType, e.resourceId);
  return covering
    ? { allowed: true, basis: "CONSENT", consentId: covering.id }
    : denied;
}
