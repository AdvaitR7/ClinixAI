import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { profiles } from "../schema.js";
import type { UserRole } from "@clinix/schemas";

export class AuthVerificationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthVerificationUnavailableError";
  }
}

export class ProfileRoleConflictError extends Error {
  constructor() {
    super("This account already has a different application role.");
    this.name = "ProfileRoleConflictError";
  }
}

export type VerifiedIdentity = { userId: string; displayName: string };

type Database = NonNullable<typeof db>;
type DatabaseExecutor = Pick<Database, "select" | "insert">;

let verifier: ReturnType<typeof createRemoteJWKSet> | null = null;
let userClient: SupabaseClient | null = null;

/** Reads a required server setting without exposing its value in errors. */
function requiredSetting(name: string, value: string | undefined): string {
  if (!value) throw new AuthVerificationUnavailableError(`${name} is not configured`);
  return value;
}

/** Validates the project URL before any token-verification network request. */
function supabaseProjectUrl(): string {
  const configured = requiredSetting("SUPABASE_URL", process.env.SUPABASE_URL);
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new AuthVerificationUnavailableError("SUPABASE_URL must be an absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || (url.username || url.password) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new AuthVerificationUnavailableError("SUPABASE_URL must use a secure HTTPS endpoint in production");
  }
  return url.toString().replace(/\/$/, "");
}

/** Returns the exact trusted issuer configured for this Supabase project. */
function projectIssuer(): string {
  const configured = process.env.SUPABASE_JWT_ISSUER;
  if (configured) {
    let issuer: URL;
    try {
      issuer = new URL(configured);
    } catch {
      throw new AuthVerificationUnavailableError("SUPABASE_JWT_ISSUER must be an absolute URL");
    }
    if (process.env.NODE_ENV === "production" && issuer.protocol !== "https:") {
      throw new AuthVerificationUnavailableError("SUPABASE_JWT_ISSUER must use HTTPS in production");
    }
    return configured.replace(/\/$/, "");
  }
  const url = supabaseProjectUrl();
  return `${url}/auth/v1`;
}

/** Creates the cached remote key resolver for asymmetric JWT verification. */
function getRemoteVerifier() {
  if (verifier) return verifier;
  const url = supabaseProjectUrl();
  const algorithms = requiredSetting(
    "SUPABASE_JWT_ALLOWED_ALGORITHMS",
    process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS,
  ).split(",").map((item) => item.trim());
  if (!algorithms.length || algorithms.some((item) => !["ES256", "RS256", "EdDSA"].includes(item))) {
    throw new AuthVerificationUnavailableError("Configure supported asymmetric Supabase signing algorithms");
  }
  verifier = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), {
    cooldownDuration: 5_000,
  });
  return verifier;
}

/** Creates the server-side Supabase client used for legacy token verification. */
function getUserClient() {
  if (userClient) return userClient;
  const url = supabaseProjectUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  userClient = createClient(url, requiredSetting("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY", key), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return userClient;
}

/** Checks identity and time claims after signature or Auth-server verification. */
function assertUserClaims(claims: JWTPayload, userId: string): void {
  const issuer = projectIssuer();
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.sub !== userId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
    claims.iss !== issuer ||
    !audience.includes("authenticated") ||
    claims.role !== "authenticated" ||
    typeof claims.exp !== "number" || claims.exp <= now ||
    typeof claims.iat !== "number" || claims.iat > now + 60 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now))
  ) {
    throw new Error("Invalid Supabase access token claims");
  }
}

/** Reads a display label from signed user metadata without using it for access. */
function getDisplayName(user: User, claims: JWTPayload): string {
  const metadata = claims.user_metadata;
  if (metadata && typeof metadata === "object" && "display_name" in metadata) {
    const name = metadata.display_name;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 200);
  }
  return user.email ?? "";
}

/** Verifies a Supabase access token and returns its server-verified identity. */
export async function verifySession(token: string): Promise<VerifiedIdentity> {
  if (process.env.SUPABASE_JWT_VERIFICATION_MODE === "asymmetric") {
    try {
      const algorithms = requiredSetting(
        "SUPABASE_JWT_ALLOWED_ALGORITHMS",
        process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS,
      ).split(",").map((item) => item.trim());
      const { payload } = await jwtVerify(token, getRemoteVerifier(), {
        issuer: projectIssuer(),
        audience: "authenticated",
        algorithms,
      });
      const userId = typeof payload.sub === "string" ? payload.sub : "";
      assertUserClaims(payload, userId);
      const appMetadata = payload.app_metadata as Record<string, unknown> | undefined;
      if (payload.is_anonymous === true || appMetadata?.provider === "anonymous") {
        throw new Error("Anonymous or incomplete identity");
      }
      const displayMetadata = payload.user_metadata as Record<string, unknown> | undefined;
      const displayName = typeof displayMetadata?.display_name === "string" && displayMetadata.display_name.trim()
        ? displayMetadata.display_name.trim().slice(0, 200)
        : typeof payload.email === "string" ? payload.email.slice(0, 200) : "";
      return { userId, displayName };
    } catch (cause) {
      if (cause instanceof AuthVerificationUnavailableError) throw cause;
      const code = (cause as { code?: unknown })?.code;
      const networkCode = (cause as { cause?: { code?: unknown } })?.cause?.code ?? code;
      const message = cause instanceof Error ? cause.message : "";
      if (
        (typeof code === "string" && ["ERR_JWKS_TIMEOUT", "ERR_JWKS_FETCH", "ERR_JWKS_INVALID", "ERR_JWKS_MULTIPLE_MATCHING_KEYS"].includes(code)) ||
        (typeof networkCode === "string" && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(networkCode)) ||
        (cause instanceof TypeError && message === "fetch failed") ||
        (code === "ERR_JOSE_GENERIC" && message.includes("JSON Web Key Set"))
      ) {
        throw new AuthVerificationUnavailableError("Supabase signing keys are unavailable");
      }
      throw new Error("Invalid Supabase access token");
    }
  }

  if (process.env.SUPABASE_JWT_VERIFICATION_MODE !== "auth_server") {
    throw new AuthVerificationUnavailableError("Set SUPABASE_JWT_VERIFICATION_MODE to an inspected verification mode");
  }

  // Decode only to reject malformed/expired input early; getUser below must still
  // establish the identity cryptographically before any profile lookup.
  let claims: JWTPayload;
  try {
    claims = decodeJwt(token);
    assertUserClaims(claims, typeof claims.sub === "string" ? claims.sub : "");
  } catch (cause) {
    if (cause instanceof AuthVerificationUnavailableError) throw cause;
    throw new Error("Invalid Supabase access token");
  }

  let result;
  try {
    result = await getUserClient().auth.getUser(token);
  } catch {
    throw new AuthVerificationUnavailableError("Could not verify the access token with Supabase Auth");
  }
  if (result.error || !result.data.user) {
    const status = (result.error as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) throw new Error("Invalid Supabase access token");
    throw new AuthVerificationUnavailableError("Could not verify the access token with Supabase Auth");
  }
  const user = result.data.user;

  try {
    assertUserClaims(claims, user.id);
    if (user.is_anonymous || user.app_metadata.provider === "anonymous") throw new Error("Anonymous identity");
    return { userId: user.id, displayName: getDisplayName(user, claims) };
  } catch {
    throw new Error("Invalid Supabase access token");
  }
}

/** Finds or creates the verified profile and locks it until onboarding commits. */
export async function ensureProfile(
  identity: VerifiedIdentity,
  role: UserRole,
  executor: DatabaseExecutor = requireDb(),
) {
  const [existing] = await executor
    .select()
    .from(profiles)
    .where(eq(profiles.supabaseUserId, identity.userId))
    .limit(1)
    .for("update");
  if (existing) {
    if (existing.primaryRole !== role) throw new ProfileRoleConflictError();
    return existing;
  }

  await executor.insert(profiles).values({
    supabaseUserId: identity.userId,
    primaryRole: role,
    displayName: identity.displayName,
  }).onConflictDoNothing({ target: profiles.supabaseUserId });

  const [profile] = await executor
    .select()
    .from(profiles)
    .where(eq(profiles.supabaseUserId, identity.userId))
    .limit(1)
    .for("update");
  if (!profile) throw new Error("Could not create application profile");
  if (profile.primaryRole !== role) throw new ProfileRoleConflictError();
  return profile;
}

/** Returns the configured database handle for profile onboarding. */
function requireDb(): Database {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}
