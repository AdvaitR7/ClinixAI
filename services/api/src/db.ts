import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;

// `sql` is null until DATABASE_URL is provided (Supabase human gate).
// idle_timeout releases connections from idle (e.g. suspended Vercel) instances, because the
// Supabase session pooler caps connections across api + worker.
export const sql = url
  ? postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 4), idle_timeout: 20, max_lifetime: 300 })
  : null;

// ORM client for later phases — no tables exist in Phase 0 yet.
export const db = sql ? drizzle(sql) : null;

export async function checkDb(): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function checkExtensions(): Promise<string[]> {
  if (!sql) return [];
  const rows = await sql<{ extname: string }[]>`
    SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')
  `;
  return rows.map((r) => r.extname);
}
