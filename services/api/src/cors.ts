/**
 * HTTP methods browsers may use cross-origin. @fastify/cors defaults to GET,HEAD,POST only,
 * which makes the browser block every PUT/PATCH/DELETE preflight the web app sends.
 */
export const CORS_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Resolves the CORS origin policy from the environment.
 *
 * `CORS_ORIGINS` is a comma-separated allowlist of exact origins. When it is unset, development keeps
 * the permissive behaviour (any origin); production refuses to start so an open API is never deployed by accident.
 */
export function corsOrigin(env: Record<string, string | undefined> = process.env): true | string[] {
  const allowlist = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowlist.length > 0) return allowlist;
  if (env.NODE_ENV === "production") throw new Error("CORS_ORIGINS must be set when NODE_ENV=production");
  return true;
}
