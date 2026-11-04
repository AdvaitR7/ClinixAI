import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@clinix/api/schema";

// ponytail: duplicate-of-api db.ts — the worker owns its own pool and reuses the
// api's schema so table definitions never drift between the two processes.
const url = process.env.DATABASE_URL;

export const sql = url ? postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 2) }) : null;
export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}
