import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./auth/context.js";
import { meRoutes } from "./auth/me.js";
import { doctorRoutes } from "./doctors/routes.js";
import { patientRoutes } from "./patients/routes.js";
import { checkDb } from "./db";

const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });

// Web (localhost:3000) calls the API cross-origin; allow it for dev.
await app.register(cors, { origin: true });

// Consistent error envelope (API spec §1).
app.setErrorHandler((err: unknown, request, reply) => {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  const message = err instanceof Error ? err.message : "Internal error";
  const status = typeof statusCode === "number" ? statusCode : 500;
  const code = status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
  reply.code(status).send({
    error: { code, message: status === 500 ? "Internal error" : message, request_id: request.id },
  });
});

// Health is a root-level ops endpoint (Phase 0).
app.get("/health", async () => {
  const up = await checkDb();
  return { ok: true, db: up ? "up" : "down" };
});

// Domain routes live under /api/v1 (architectural invariant).
await app.register(
  async function v1(instance) {
    await instance.register(authPlugin);
    await instance.register(meRoutes);
    await instance.register(patientRoutes);
    await instance.register(doctorRoutes);
  },
  { prefix: "/api/v1" },
);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
