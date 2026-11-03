import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss | null> | null = null;

/**
 * pg-boss on the same Supabase session-pooler Postgres (no Redis). Uses
 * `connectionString` (pg-boss bundles `pg`); session mode preserves LISTEN/NOTIFY.
 * A failed start disables the queue rather than taking the API down.
 */
export async function startQueue(): Promise<PgBoss | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (boss) return boss;
  if (starting) return starting;
  starting = initializeQueue(url);
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** Publishes the queue only after startup succeeds and contains background errors. */
async function initializeQueue(url: string): Promise<PgBoss | null> {
  const candidate = new PgBoss({ connectionString: url, max: Number(process.env.QUEUE_POOL_MAX ?? 1) });
  // EventEmitter errors happen outside start()'s promise; without a listener they kill the API.
  candidate.on("error", (err) => console.error("pg-boss background error", err));
  try {
    await candidate.start();
    await candidate.createQueue("document.extract");
    await candidate.createQueue("ai.analyze");
    boss = candidate;
    return boss;
  } catch (err) {
    console.error("pg-boss failed to start; job queue disabled", err);
    await candidate.stop({ graceful: false }).catch((stopError) => {
      console.error("pg-boss cleanup failed", stopError);
    });
    return null;
  }
}

/** Gracefully stops pg-boss so in-flight sends finish before the process exits. */
export async function stopQueue(): Promise<void> {
  if (!boss) return;
  const current = boss;
  boss = null;
  await current.stop({ graceful: true, timeout: 5000 });
}

/** Reports readiness only after both application queues have been created. */
export function queueReady(): boolean {
  return boss !== null;
}

/** Enqueues `document.extract` with a resource id only (ARCHITECTURE_SPEC §35). */
export async function sendDocumentExtract(documentId: string): Promise<void> {
  const b = await startQueue();
  if (!b) throw new Error("Job queue unavailable");
  await b.send("document.extract", { documentId });
}

/** Enqueues `ai.analyze` job (ARCHITECTURE_SPEC §10, §35). */
export async function sendAiAnalysis(
  aiSessionId: string,
  encounterId: string,
): Promise<void> {
  const b = await startQueue();
  if (!b) throw new Error("Job queue unavailable");
  await b.send("ai.analyze", { aiSessionId, encounterId });
}
