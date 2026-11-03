import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Applies pending Drizzle migrations from ./drizzle using the runtime migrator, so production
 * images do not need drizzle-kit (a devDependency). Uses a single connection and exits 0 on success.
 */
export async function runMigrations(url: string): Promise<void> {
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not configured");
  process.exit(1);
}
runMigrations(url)
  .then(() => {
    console.log("migrations: up to date");
    process.exit(0);
  })
  .catch((err) => {
    console.error("migrations failed", err);
    process.exit(1);
  });
