import type { FastifyRequest } from "fastify";
import { requireDb } from "../http.js";
import { accessEvents } from "../schema.js";

/**
 * Append-only access ledger write (DB §26.1). Application roles INSERT only;
 * no UPDATE/DELETE code path exists anywhere in the codebase. `GET /patients/self/access-ledger`
 * reads these rows back (privacy/routes.ts).
 */
export async function logAccess(
  request: FastifyRequest,
  e: {
    patientId: string;
    purpose: string;
    resourceType: string;
    resourceId?: string;
    action: string;
    /** Consent that authorized this access, when it was consent-based. */
    consentId?: string | null;
  },
) {
  const database = requireDb();
  await database.insert(accessEvents).values({
    patientId: e.patientId,
    actorType: request.auth.role,
    actorId: request.auth.profileId,
    purpose: e.purpose,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    action: e.action,
    consentId: e.consentId ?? null,
    requestId: request.id,
  });
}
