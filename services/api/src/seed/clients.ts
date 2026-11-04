import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountSpec } from "./personas.js";

/** Reads a required environment variable or stops with the variable's name only. */
export function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see services/api/.env.example)`);
  return value;
}

/** Supabase admin client for creating confirmed demo accounts and uploading fixtures. */
export function adminClient(): SupabaseClient {
  return createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Supabase client with the public key, used only to sign demo accounts in. */
function publicClient(): SupabaseClient {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required");
  return createClient(need("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Finds a demo account by email, creating it (email-confirmed) when missing.
 * @returns The Supabase user id and whether it was created by this run.
 */
export async function ensureUser(admin: SupabaseClient, spec: AccountSpec): Promise<{ id: string; created: boolean }> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const found = data.users.find((u) => u.email?.toLowerCase() === spec.email);
  if (found) return { id: found.id, created: false };
  const created = await admin.auth.admin.createUser({
    email: spec.email,
    password: need("SEED_DEMO_PASSWORD"),
    email_confirm: true,
    user_metadata: { display_name: spec.displayName },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error(`Could not create ${spec.key}`);
  return { id: created.data.user.id, created: true };
}

/** Signs a demo account in and returns its short-lived access token. Never logged. */
export async function tokenFor(spec: AccountSpec): Promise<string> {
  const { data, error } = await publicClient().auth.signInWithPassword({ email: spec.email, password: need("SEED_DEMO_PASSWORD") });
  if (error || !data.session) {
    throw new Error(`Could not sign in ${spec.key}: ${error?.message ?? "no session"}. Check SEED_DEMO_PASSWORD matches the existing account.`);
  }
  return data.session.access_token;
}

export type ApiResult<T = any> = { status: number; json: T | null };

/** Minimal API client; the seed drives current state through the real /api/v1 routes. */
export function apiClient(base: string) {
  return async function api<T = any>(token: string, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: T | null = null;
    try {
      json = (await res.json()) as T;
    } catch {
      /* empty body */
    }
    return { status: res.status, json };
  };
}
