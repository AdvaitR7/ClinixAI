import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "clinix-documents";

let client: SupabaseClient | null = null;

/** Lazy service-role client. Service role never touches the browser. */
function serviceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/**
 * Idempotent bucket bootstrap so the gate is self-sufficient (bucket.sql is the
 * documented artifact; this swallows the "already exists" error on first use).
 */
export async function ensureBucket(): Promise<void> {
  const { error } = await serviceClient().storage.createBucket(BUCKET, {
    public: false,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** Signed upload URL for a browser PUT (Supabase fixes the 2 h TTL). */
export async function signedUploadUrl(key: string) {
  await ensureBucket();
  const { data, error } = await serviceClient()
    .storage.from(BUCKET)
    .createSignedUploadUrl(key);
  if (error) throw error;
  return { uploadUrl: data.signedUrl, token: data.token, path: data.path };
}

/** Signed view/download URL, short-lived (600 s). */
export async function signedViewUrl(key: string, expiresIn = 600): Promise<string> {
  const { data, error } = await serviceClient()
    .storage.from(BUCKET)
    .createSignedUrl(key, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/** Downloads the object bytes as a Buffer (worker + upload-complete validation). */
export async function downloadObject(key: string): Promise<Buffer> {
  const { data, error } = await serviceClient()
    .storage.from(BUCKET)
    .download(key);
  if (error) throw error;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf;
}
