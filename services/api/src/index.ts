import Fastify from "fastify";
import cors from "@fastify/cors";
import { corsOrigin } from "./cors.js";
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
import { startQueue } from "./queue.js";
import { checkDb } from "./db";

const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });

// The web app calls the API cross-origin. CORS_ORIGINS is the allowlist; unset keeps the open dev default.
await app.register(cors, { origin: corsOrigin() });

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
