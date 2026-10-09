import "dotenv/config";
import { PgBoss } from "pg-boss";
import { handleDocumentExtract } from "./handlers/document-extract.js";
import { handleAiAnalyze } from "./handlers/ai-analyze.js";

// Worker process for pg-boss jobs (ARCHITECTURE_SPEC §35). Lives in
// services/worker per CLAUDE.md + the master plan; the ARCHITECTURE_SPEC §4
// diagram's services/api/src/worker is the older layout.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
  }

  const boss = new PgBoss({ connectionString: url });
  await boss.start();
  await boss.createQueue("document.extract");
  await boss.createQueue("ai.analyze");
  await boss.work("document.extract", handleDocumentExtract);
  await boss.work("ai.analyze", handleAiAnalyze);
  console.log("worker: listening for document.extract and ai.analyze");
}

main().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
