import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;

/**
 * pg-boss on the same Supabase session-pooler Postgres (no Redis). Uses
 * `connectionString` (pg-boss bundles `pg`); session mode preserves LISTEN/NOTIFY.
 * A failed start disables the queue rather than taking the API down.
 */
export async function startQueue(): Promise<PgBoss | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (boss) return boss;
  try {
    boss = new PgBoss({ connectionString: url });
    await boss.start();
    await boss.createQueue("document.extract");
    return boss;
  } catch (err) {
    console.error("pg-boss failed to start; document queue disabled", err);
    boss = null;
    return null;
  }
}

export function queueReady(): boolean {
  return boss !== null;
}

/** Enqueues `document.extract` with a resource id only (ARCHITECTURE_SPEC §35). */
export async function sendDocumentExtract(documentId: string): Promise<void> {
  const b = await startQueue();
  if (!b) throw new Error("Job queue unavailable");
  await b.send("document.extract", { documentId });
}
