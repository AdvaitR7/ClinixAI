import type { FastifyReply, FastifyRequest } from "fastify";
import { error } from "../http.js";
import { AuthVerificationUnavailableError, verifySession, type VerifiedIdentity } from "./supabase.js";

/** Verifies a bearer token and sends the existing auth error envelope on failure. */
export async function verifiedBearer(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<VerifiedIdentity | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    error(request, reply, 401, "UNAUTHORIZED", "Missing bearer token");
    return null;
  }
  try {
    return await verifySession(header.slice("Bearer ".length));
  } catch (cause) {
    if (cause instanceof AuthVerificationUnavailableError) {
      error(request, reply, 503, "AUTH_UNAVAILABLE", "Authentication service is unavailable");
    } else {
      error(request, reply, 401, "UNAUTHORIZED", "Invalid session token");
    }
    return null;
  }
}
