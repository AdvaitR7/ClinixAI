import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { UserRole } from "@clinix/schemas";
import { db } from "../db.js";
import { error } from "../http.js";
import { doctors, patients, profiles } from "../schema.js";
import { verifiedBearer } from "./bearer.js";

export interface AuthContext {
  supabaseUserId: string;
  profileId: string;
  role: UserRole;
  patientId: string | null;
  doctorId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/**
 * requireAuth: verifies the Supabase bearer token, then derives role + domain
 * ids from Postgres. Client-supplied role/ids are never trusted.
 * 401 = bad/missing token; 403 = valid token but onboarding incomplete.
 */
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const identity = await verifiedBearer(request, reply);
  if (!identity) return;

  if (!db) return error(request, reply, 503, "DB_UNAVAILABLE", "Database is not configured");

  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.supabaseUserId, identity.userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) {
    // Genuine 404-shaped auth state: session is valid, onboarding isn't done.
    return error(request, reply, 403, "ONBOARDING_REQUIRED", "Complete onboarding to continue");
  }

  const role = profile.primaryRole as UserRole;

  let patientId: string | null = null;
  let doctorId: string | null = null;
  if (role === "PATIENT") {
    const prs = await db
      .select({ id: patients.id })
      .from(patients)
      .where(eq(patients.accountProfileId, profile.id))
      .limit(1);
    patientId = prs[0]?.id ?? null;
  } else if (role === "DOCTOR") {
    const drs = await db
      .select({ id: doctors.id })
      .from(doctors)
      .where(eq(doctors.profileId, profile.id))
      .limit(1);
    doctorId = drs[0]?.id ?? null;
  }

  request.auth = { supabaseUserId: identity.userId, profileId: profile.id, role, patientId, doctorId };
}

export default fp(async function authPlugin(app) {
  app.decorateRequest("auth");
  app.addHook("preValidation", async (request, reply) => {
    if ((request.routeOptions as { config?: { auth?: boolean } })?.config?.auth === false) return;
    await requireAuth(request, reply);
  });
});

/** Per-route opt-out for endpoints that handle auth themselves (onboarding). */
export function publicRoute(route: { auth?: boolean } = {}) {
  return { ...route, auth: false };
}

/** Helper for routes that need the patient row, with its phone for lookup. */
export async function patientRow(profileId: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const rows = await db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.accountProfileId, profileId),
        eq(patients.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
