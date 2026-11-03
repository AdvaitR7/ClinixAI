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
