import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";

/** Consistent error envelope (API spec §1). */
export function error(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({
    error: { code, message, request_id: request.id },
  });
}

/** Non-null drizzle client; throws if DATABASE_URL is absent. */
export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}
