import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PgBoss } from "pg-boss";
import { sql } from "./db.js";
import { handleDocumentExtract } from "./handlers/document-extract.js";
import { generateStructured } from "./gateway.js";
import { z } from "zod";
import { handleAiAnalyze } from "./handlers/ai-analyze.js";

// Worker process for pg-boss jobs (ARCHITECTURE_SPEC §35). Lives in
// services/worker per CLAUDE.md + the master plan; the ARCHITECTURE_SPEC §4
// diagram's services/api/src/worker is the older layout.
/** Starts queue consumers with a bounded pool and handles recoverable database errors. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
  }

  // Bound queries and recycle pooled sockets so a broken connection cannot stall all consumers.
  const queueOptions = {
    connectionString: url, max: Number(process.env.QUEUE_POOL_MAX ?? 1),
    connectionTimeoutMillis: 10_000, query_timeout: 15_000,
    keepAlive: true, keepAliveInitialDelayMillis: 10_000, maxLifetimeSeconds: 300,
  };
  const boss = new PgBoss(queueOptions);
  boss.on("error", (err) => console.error("worker queue error", err));
  await boss.start();
  await boss.createQueue("document.extract");
  await boss.createQueue("ai.analyze");
  await boss.work("document.extract", handleDocumentExtract);
  await boss.work("ai.analyze", handleAiAnalyze);
  await boss.createQueue("ops.probe");
  // Synthetic deployment probe contains no patient data and is consumed by the real worker.
  await boss.work<{ revision: string }>("ops.probe", { batchSize: 1 }, async ([job]) => {
    if (job.data.revision !== process.env.GIT_SHA) throw new Error("Worker revision does not match probe");
    const result = await generateStructured({
      role: "ANALYST_1", schema: z.object({ ok: z.literal(true) }),
      messages: [{ role: "user", content: 'Return JSON: {"ok":true}' }],
    });
    return { ok: result.ok, revision: process.env.GIT_SHA };
  });
  console.log("worker: listening for document.extract and ai.analyze");

  // The Docker HEALTHCHECK reads this file's age; it is only refreshed while the database answers.
  const heartbeatFile = process.env.HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
  let failedBeats = 0;
  let checkingHealth = false;
  /** Checks both database pools; exits after repeated failures so Docker restarts stalled consumers. */
  const beat = async () => {
    if (checkingHealth) return;
    checkingHealth = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([sql ? sql`select 1` : Promise.reject(new Error("Database is unavailable")), boss.getQueues(["document.extract", "ai.analyze"])]),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Worker queue health check timed out")), 10_000); }),
      ]);
      failedBeats = 0;
      writeFileSync(heartbeatFile, String(Date.now()));
    } catch (err) {
      console.error("worker heartbeat skipped", err);
      if (++failedBeats >= 3) process.exit(1);
    } finally {
      clearTimeout(deadline);
      checkingHealth = false;
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), 15_000);

  /** Stops the heartbeat, lets running jobs finish, then closes the database pool. */
  const stopGracefully = async (signal: string) => {
    console.log(`worker: ${signal}, stopping`);
    clearInterval(heartbeat);
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
      await sql?.end({ timeout: 5 });
      process.exit(0);
    } catch (err) {
      console.error("worker stop failed", err);
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void stopGracefully("SIGTERM"));
  process.once("SIGINT", () => void stopGracefully("SIGINT"));
}

main().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
