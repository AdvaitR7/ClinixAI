import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PgBoss } from "pg-boss";
import { sql } from "./db.js";
import { handleDocumentExtract } from "./handlers/document-extract.js";
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

  const boss = new PgBoss({ connectionString: url, max: Number(process.env.QUEUE_POOL_MAX ?? 1) });
  boss.on("error", (err) => console.error("worker queue error", err));
  await boss.start();
  await boss.createQueue("document.extract");
  await boss.createQueue("ai.analyze");
  await boss.work("document.extract", handleDocumentExtract);
  await boss.work("ai.analyze", handleAiAnalyze);
  console.log("worker: listening for document.extract and ai.analyze");

  // The Docker HEALTHCHECK reads this file's age; it is only refreshed while the database answers.
  const heartbeatFile = process.env.HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
  const beat = async () => {
    try {
      if (sql) await sql`select 1`;
      writeFileSync(heartbeatFile, String(Date.now()));
    } catch (err) {
      console.error("worker heartbeat skipped", err);
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
