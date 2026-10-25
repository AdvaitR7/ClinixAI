import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { AuthVerificationUnavailableError, ensureProfile, ProfileRoleConflictError, verifySession } from "./supabase.js";

const subject = "2e036082-69a1-4b95-88d9-3190ded27f62";
let server: Server;
let projectUrl: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicJwk: Record<string, unknown>;
let legacyUser: Record<string, unknown>;
let jwksUnavailable = false;
let legacyStatus = 200;
let expectedLegacyToken: string | null = null;
const originalEnvironment = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  mode: process.env.SUPABASE_JWT_VERIFICATION_MODE,
  issuer: process.env.SUPABASE_JWT_ISSUER,
  algorithms: process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS,
};

/** Signs an isolated JWT with claims controlled by a single test. */
async function token(claims: Record<string, unknown> = {}, alg = "ES256", kid = "test-key", includeSubject = true) {
  const signer = alg === "HS256" ? new TextEncoder().encode("local-test-signing-key") : privateKey;
  const jwt = new SignJWT({ aud: "authenticated", role: "authenticated", ...claims })
    .setProtectedHeader({ alg, ...(alg !== "HS256" ? { kid } : {}) })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300);
  if (includeSubject && !("sub" in claims)) jwt.setSubject(subject);
  if (!("iss" in claims)) jwt.setIssuer(`${projectUrl}/auth/v1`);
  return jwt.sign(signer as never);
}

/** Provides an in-memory profile store for onboarding race tests. */
function profileStore() {
  let row: Record<string, unknown> | null = null;
  const insert = vi.fn().mockImplementation(() => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: async () => {
        if (!row) row = { id: "d01fc949-f7d5-44cb-b7e9-7804e83cff38", ...values };
      },
    }),
  }));
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => ({ for: async () => row ? [row] : [] }) }) }),
  }));
  return { executor: { select, insert } as never, insert, read: () => row };
}

/** Waits for the configured JWKS refresh cooldown before testing key rotation. */
async function waitForJwksRefreshWindow() {
  await new Promise((resolve) => setTimeout(resolve, 5_100));
}

describe("Supabase access token verification", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "test-key", use: "sig" };
    legacyUser = {
      id: subject,
      email: "synthetic@example.test",
      is_anonymous: false,
      app_metadata: { provider: "email" },
      user_metadata: { display_name: "Synthetic Test" },
    };

    server = createServer((request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        if (jwksUnavailable) {
          response.writeHead(503).end();
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (request.url === "/auth/v1/user") {
        if (legacyStatus !== 200 || request.headers.authorization !== `Bearer ${expectedLegacyToken}`) {
          response.writeHead(legacyStatus === 200 ? 401 : legacyStatus).end(JSON.stringify({ message: "synthetic verifier rejected token" }));
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(legacyUser));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    projectUrl = `http://127.0.0.1:${address.port}`;
    process.env.SUPABASE_URL = projectUrl;
    process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "asymmetric";
    process.env.SUPABASE_JWT_ISSUER = `${projectUrl}/auth/v1`;
    process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS = "ES256";
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (originalEnvironment.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalEnvironment.url;
    if (originalEnvironment.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalEnvironment.key;
    if (originalEnvironment.mode === undefined) delete process.env.SUPABASE_JWT_VERIFICATION_MODE;
    else process.env.SUPABASE_JWT_VERIFICATION_MODE = originalEnvironment.mode;
    if (originalEnvironment.issuer === undefined) delete process.env.SUPABASE_JWT_ISSUER;
    else process.env.SUPABASE_JWT_ISSUER = originalEnvironment.issuer;
    if (originalEnvironment.algorithms === undefined) delete process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS;
    else process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS = originalEnvironment.algorithms;
  });

  it("accepts a valid signature and returns only the verified identity", async () => {
    const verified = await verifySession(await token({ sub: subject, user_metadata: { display_name: "Synthetic Test" } }));
    expect(verified).toEqual({ userId: subject, displayName: "Synthetic Test" });
  });

  it("uses the verified email as a display fallback without treating metadata as a role", async () => {
    await expect(verifySession(await token({ email: "synthetic@example.test", user_metadata: { display_name: "", role: "ADMIN" } })))
      .resolves.toEqual({ userId: subject, displayName: "synthetic@example.test" });
  });

  it("rejects a valid signature without a subject", async () => {
    await expect(verifySession(await token({}, "ES256", "test-key", false)))
      .rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects a JWT without an expiration claim", async () => {
    const value = await new SignJWT({ aud: "authenticated", role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(`${projectUrl}/auth/v1`)
      .setSubject(subject)
      .sign(privateKey);
    await expect(verifySession(value)).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects a JWT without an issued-at time", async () => {
    const value = await new SignJWT({ aud: "authenticated", role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .setIssuer(`${projectUrl}/auth/v1`)
      .setSubject(subject)
      .sign(privateKey);
    await expect(verifySession(value)).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects malformed tokens", async () => {
    await expect(verifySession("not-a-jwt")).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects forged signatures", async () => {
    const value = await token({ sub: subject });
    const parts = value.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    await expect(verifySession(parts.join("."))).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects tokens with the wrong issuer", async () => {
    await expect(verifySession(await token({ iss: "https://wrong.example" })))
      .rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects tokens with the wrong audience", async () => {
    await expect(verifySession(await token({ aud: "other" })))
      .rejects.toThrow("Invalid Supabase access token");
  });

  it.each(["anon", "service_role"])("rejects API-key database role %s even with user-shaped claims", async (role) => {
    await expect(verifySession(await token({ role }))).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects anonymous identities", async () => {
    await expect(verifySession(await token({ is_anonymous: true }))).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects tokens that are not yet valid", async () => {
    await expect(verifySession(await token({ nbf: Math.floor(Date.now() / 1000) + 300 })))
      .rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects expired tokens", async () => {
    const value = await new SignJWT({ aud: "authenticated", role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .setIssuer(`${projectUrl}/auth/v1`)
      .setSubject(subject)
      .sign(privateKey);
    await expect(verifySession(value)).rejects.toThrow("Invalid Supabase access token");
  });

  it("rejects signing algorithms outside the configured allowlist", async () => {
    await expect(verifySession(await token({ sub: subject }, "HS256")))
      .rejects.toThrow("Invalid Supabase access token");
  });

  it("uses Supabase Auth getUser for legacy symmetric signing", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "auth_server";
    const signed = await token({ sub: subject, user_metadata: { display_name: "Synthetic Test" } }, "HS256");
    expectedLegacyToken = signed;
    await expect(verifySession(signed)).resolves.toEqual({ userId: subject, displayName: "Synthetic Test" });
  });

  it("rejects legacy tokens not accepted by Supabase Auth", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "auth_server";
    expectedLegacyToken = await token({ sub: subject }, "HS256");
    const forged = await token({ sub: subject, user_metadata: { display_name: "Synthetic Test" } }, "HS256");
    await expect(verifySession(forged)).rejects.toThrow("Invalid Supabase access token");
  });

  it("reports legacy verifier outages separately from invalid credentials", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "auth_server";
    legacyStatus = 503;
    const signed = await token({ sub: subject }, "HS256");
    expectedLegacyToken = signed;
    await expect(verifySession(signed)).rejects.toBeInstanceOf(AuthVerificationUnavailableError);
    legacyStatus = 200;
  });

  it("refreshes JWKS when a new signing key appears", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "asymmetric";
    await waitForJwksRefreshWindow();
    const rotated = await generateKeyPair("ES256");
    publicJwk = { ...(await exportJWK(rotated.publicKey)), alg: "ES256", kid: "rotated-key", use: "sig" };
    const value = await new SignJWT({ aud: "authenticated", role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "rotated-key" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .setIssuer(`${projectUrl}/auth/v1`)
      .setSubject(subject)
      .sign(rotated.privateKey);
    await expect(verifySession(value)).resolves.toMatchObject({ userId: subject });
  }, 10_000);

  it("returns an availability error when JWKS refresh cannot reach Supabase", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "asymmetric";
    await waitForJwksRefreshWindow();
    jwksUnavailable = true;
    const value = await token({ sub: subject }, "ES256", "unknown-key");
    await expect(verifySession(value)).rejects.toBeInstanceOf(AuthVerificationUnavailableError);
    jwksUnavailable = false;
  }, 10_000);

  it("reports connection failures while fetching JWKS as unavailable", async () => {
    const closedServer = createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
    const address = closedServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));
    const closedUrl = `http://127.0.0.1:${address.port}`;
    process.env.SUPABASE_URL = closedUrl;
    process.env.SUPABASE_JWT_ISSUER = `${closedUrl}/auth/v1`;
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "asymmetric";
    try {
      vi.resetModules();
      const isolated = await import("./supabase.js");
      await expect(isolated.verifySession(await token({ iss: `${closedUrl}/auth/v1` })))
        .rejects.toBeInstanceOf(isolated.AuthVerificationUnavailableError);
    } finally {
      process.env.SUPABASE_URL = projectUrl;
      process.env.SUPABASE_JWT_ISSUER = `${projectUrl}/auth/v1`;
    }
  });

  it("creates one profile under concurrent same-role onboarding", async () => {
    const store = profileStore();
    const identity = { userId: subject, displayName: "" };
    const results = await Promise.all([
      ensureProfile(identity, "PATIENT", store.executor),
      ensureProfile(identity, "PATIENT", store.executor),
    ]);
    expect(results.map((profile) => profile.id)).toEqual([
      "d01fc949-f7d5-44cb-b7e9-7804e83cff38",
      "d01fc949-f7d5-44cb-b7e9-7804e83cff38",
    ]);
    expect(store.insert).toHaveBeenCalledTimes(2);
    expect(store.read()).toMatchObject({ supabaseUserId: subject, primaryRole: "PATIENT" });
    expect(store.read()).not.toHaveProperty("legacyAuthSubject");
  });

  it("rejects concurrent onboarding requests that choose different roles", async () => {
    const store = profileStore();
    const identity = { userId: subject, displayName: "" };
    const results = await Promise.allSettled([
      ensureProfile(identity, "PATIENT", store.executor),
      ensureProfile(identity, "DOCTOR", store.executor),
    ]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(ProfileRoleConflictError) });
  });

  it("creates a new identity mapping without consulting legacy subjects or email", async () => {
    const store = profileStore();
    const profile = await ensureProfile({ userId: subject, displayName: "New Account" }, "PATIENT", store.executor);
    expect(profile).toMatchObject({ supabaseUserId: subject, displayName: "New Account" });
    expect(profile).not.toHaveProperty("legacyAuthSubject");
  });
});
