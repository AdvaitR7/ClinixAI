import { bootTrace } from "./boot-trace.js";
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
import { checkDb, sql } from "./db.js";
import { assertIdentityKey } from "./crypto.js";

// Fail at boot, not with a 500 on every patient route, when the identity key is missing or malformed.
assertIdentityKey();

bootTrace("all modules loaded");
const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });
let mobileReleaseCache: { expiresAt: number; value: { version: string; download_url: string; published_at: string | null } } | null = null;

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
  return {
    ok: true,
    db: up ? "up" : "down",
    version: process.env.APP_VERSION ?? "unknown",
    revision: process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
  };
});

/** Returns private-release metadata; GitHub still authenticates the APK download. */
app.get("/mobile/release", async (_request, reply) => {
  if (mobileReleaseCache && mobileReleaseCache.expiresAt > Date.now()) return mobileReleaseCache.value;
  const repository = process.env.ANDROID_RELEASE_REPOSITORY ?? "AdvaitR7/ClinixAI";
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ClinixAI",
        ...(process.env.GITHUB_RELEASE_READ_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_RELEASE_READ_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return reply.code(503).send({ error: "Release information is unavailable." });
    const release = await response.json() as {
      tag_name?: string;
      published_at?: string;
      html_url?: string;
      assets?: Array<{ name?: string; browser_download_url?: string; digest?: string }>;
    };
    const apk = release.assets?.find((asset) => asset.name === "clinix-android.apk");
    if (!release.tag_name || !apk?.browser_download_url) {
      return reply.code(503).send({ error: "No Android release is published yet." });
    }
    const value = { version: release.tag_name, version_code: Number(release.tag_name.match(/^android-v1\.0\.(\d+)$/)?.[1]) || null, sha256: apk.digest?.replace(/^sha256:/, "") ?? null, download_url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`, published_at: release.published_at ?? null };
    mobileReleaseCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return value;
  } catch {
    return reply.code(503).send({ error: "Release information is temporarily unavailable." });
  }
});

bootTrace("cors registered");
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

bootTrace("routes registered");
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

// Start the document queue before listening so upload-complete can enqueue. On Vercel it starts
// lazily on the first send instead, keeping the pg-boss connection out of every cold start.
if (!process.env.VERCEL) await startQueue();

if (process.env.VERCEL) {
  // Vercel's launcher intercepts listen() and only hands over requests once this module finishes
  // evaluating, so awaiting listen here would block forever (cold starts hit the 60 s limit).
  bootTrace(`listen (vercel, not awaited) ${host}:${port}`);
  app.listen({ port, host }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
} else {
  try {
    bootTrace(`listening on ${host}:${port}`);
    await app.listen({ port, host });
    bootTrace("listen resolved");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
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
