import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { verifiedBearer } from "./bearer.js";
import authPlugin, { publicRoute } from "./context.js";

const previousMode = process.env.SUPABASE_JWT_VERIFICATION_MODE;
const previousUrl = process.env.SUPABASE_URL;
const previousIssuer = process.env.SUPABASE_JWT_ISSUER;
const previousAlgorithms = process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS;

/** Builds a small Fastify server that exercises the production auth hook. */
async function testServer() {
  const app = Fastify();
  await app.register(authPlugin);
  app.get("/private", async (request) => ({ role: request.auth.role }));
  app.post("/onboarding", { config: publicRoute() }, async (request, reply) => {
    const identity = await verifiedBearer(request, reply);
    if (!identity) return reply;
    return { user_id: identity.userId };
  });
  await app.ready();
  return app;
}

describe("Fastify Supabase authentication boundary", () => {
  afterEach(() => {
    if (previousMode === undefined) delete process.env.SUPABASE_JWT_VERIFICATION_MODE;
    else process.env.SUPABASE_JWT_VERIFICATION_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousIssuer === undefined) delete process.env.SUPABASE_JWT_ISSUER;
    else process.env.SUPABASE_JWT_ISSUER = previousIssuer;
    if (previousAlgorithms === undefined) delete process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS;
    else process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS = previousAlgorithms;
  });

  it("rejects a missing bearer token on a protected route", async () => {
    const app = await testServer();
    const response = await app.inject({ method: "GET", url: "/private" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });

  it("requires bearer verification on onboarding routes that bypass the global hook", async () => {
    const app = await testServer();
    const response = await app.inject({ method: "POST", url: "/onboarding" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });

  it("rejects malformed tokens without attempting database profile resolution", async () => {
    process.env.SUPABASE_JWT_VERIFICATION_MODE = "asymmetric";
    process.env.SUPABASE_URL = "http://127.0.0.1:4567";
    process.env.SUPABASE_JWT_ISSUER = "http://127.0.0.1:4567/auth/v1";
    process.env.SUPABASE_JWT_ALLOWED_ALGORITHMS = "ES256";
    const app = await testServer();
    const response = await app.inject({
      method: "GET",
      url: "/private",
      headers: { authorization: "Bearer malformed" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });
});
