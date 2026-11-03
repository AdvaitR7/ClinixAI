import { createClient } from "@supabase/supabase-js";

/** Creates a non-persistent client for synthetic API-gate sign-ins. */
function publicClient() {
  const url = process.env.SUPABASE_URL;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !publicKey) throw new Error("SUPABASE_URL and a public Supabase key are required for API gates");
  return createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Finds an explicitly configured synthetic test account by its email. */
export async function findGateUser(email) {
  if (!email) throw new Error("Configure the Supabase gate account email in services/api/.env");
  const url = process.env.SUPABASE_URL;
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !adminKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for API gates");
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Creates an email-confirmed synthetic account for a local API gate. */
export async function createGateUser(tag, userMetadata = {}) {
  const url = process.env.SUPABASE_URL;
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.SUPABASE_GATE_PASSWORD;
  if (!url || !adminKey || !password) {
    throw new Error("Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_GATE_PASSWORD for API gates");
  }
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${tag}-${Date.now()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });
  if (error) throw error;
  return data.user;
}

/** Signs in a gate account and returns its short-lived Supabase access token. */
export async function sessionTokenFor(userId) {
  const url = process.env.SUPABASE_URL;
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.SUPABASE_GATE_PASSWORD;
  if (!url || !adminKey || !password) {
    throw new Error("Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_GATE_PASSWORD for API gates");
  }
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) throw userError ?? new Error("Gate account has no email");
  const { data, error } = await publicClient().auth.signInWithPassword({ email: userData.user.email, password });
  if (error || !data.session) throw error ?? new Error("Gate account did not return a session");
  return data.session.access_token;
}

/** Signs in a seeded demo persona (password from SEED_DEMO_PASSWORD) and returns its access token. */
export async function demoSessionToken(email) {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error("Configure SEED_DEMO_PASSWORD (and run `npm run seed`) for the Phase 8 gate");
  const { data, error } = await publicClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`Demo account ${email} did not return a session`);
  return data.session.access_token;
}
