import Fastify from "fastify";
import cors from "@fastify/cors";
import { CORS_METHODS, corsOrigin } from "./cors.js";
import authPlugin from "./auth/context.js";
import { meRoutes } from "./auth/me.js";
import { doctorRoutes } from "./doctors/routes.js";
import { patientRoutes } from "./patients/routes.js";
import { doctorPatientRoutes } from "./doctor-patients/routes.js";
import { relationshipRoutes } from "./relationships/routes.js";
import { encounterRoutes } from "./encounters/routes.js";
import { availabilityRoutes } from "./availability/routes.js";
import { appointmentRoutes } from "./appointments/routes.js";
import { dashboardRoutes } from "./dashboards/routes.js";
import { consultationRoutes } from "./consultations/routes.js";
import { prescriptionRoutes } from "./prescriptions/routes.js";
import { medicationRoutes } from "./medications/routes.js";
import { claimRoutes } from "./claims/routes.js";
import { documentRoutes } from "./documents/routes.js";
import { interactionRoutes } from "./interactions/routes.js";
import { aiRoutes } from "./ai/routes.js";
import { timelineRoutes } from "./timeline/routes.js";
import { privacyRoutes } from "./privacy/routes.js";
import { practiceRoutes } from "./practices/routes.js";
import { staffRoutes } from "./staff/routes.js";
import { staffOperationsRoutes } from "./staff/operations-routes.js";
import { followupRoutes } from "./followups/routes.js";
import { notificationRoutes } from "./notifications/routes.js";
import { doctorProfileRoutes } from "./doctors/profile-routes.js";
import { startQueue, stopQueue } from "./queue.js";
import { checkDb, sql } from "./db";
import { assertIdentityKey } from "./crypto.js";

// Fail at boot, not with a 500 on every patient route, when the identity key is missing or malformed.
assertIdentityKey();

const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });

// The web app calls the API cross-origin. CORS_ORIGINS is the allowlist; unset keeps the open dev default.
await app.register(cors, { origin: corsOrigin(), methods: CORS_METHODS });

/** Maps an HTTP status to the API error code so framework 401/404/415 errors are not reported as internal. */
function errorCode(status: number): string {
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 415) return "UNSUPPORTED_MEDIA_TYPE";
  return "INTERNAL_ERROR";
}

// Consistent error envelope (API spec §1).
app.setErrorHandler((err: unknown, request, reply) => {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  const message = err instanceof Error ? err.message : "Internal error";
  const status = typeof statusCode === "number" ? statusCode : 500;
  const code = errorCode(status);
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
    await instance.register(doctorPatientRoutes);
    await instance.register(relationshipRoutes);
    await instance.register(encounterRoutes);
    await instance.register(availabilityRoutes);
    await instance.register(appointmentRoutes);
    await instance.register(dashboardRoutes);
    await instance.register(consultationRoutes);
    await instance.register(prescriptionRoutes);
    await instance.register(medicationRoutes);
    await instance.register(claimRoutes);
    await instance.register(documentRoutes);
    await instance.register(interactionRoutes);
    await instance.register(aiRoutes);
    await instance.register(timelineRoutes);
    await instance.register(privacyRoutes);
    await instance.register(practiceRoutes);
    await instance.register(staffRoutes);
    await instance.register(staffOperationsRoutes);
    await instance.register(followupRoutes);
    await instance.register(notificationRoutes);
    await instance.register(doctorProfileRoutes);
  },
  { prefix: "/api/v1" },
);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

// Start the document queue before listening so upload-complete can enqueue.
await startQueue();

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/** Stops accepting requests, drains the job queue and closes the database pool before exiting. */
async function stopGracefully(signal: string) {
  app.log.info({ signal }, "stopping");
  try {
    await app.close();
    await stopQueue();
    await sql?.end({ timeout: 5 });
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.once("SIGTERM", () => void stopGracefully("SIGTERM"));
process.once("SIGINT", () => void stopGracefully("SIGINT"));
