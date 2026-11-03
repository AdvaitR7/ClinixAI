import Fastify from "fastify";
import cors from "@fastify/cors";
import { describe, expect, it } from "vitest";
import { CORS_METHODS, corsOrigin } from "./cors";

describe("corsOrigin", () => {
  it("keeps the development default when no allowlist is set", () => {
    expect(corsOrigin({})).toBe(true);
    expect(corsOrigin({ NODE_ENV: "development" })).toBe(true);
  });

  it("parses a comma-separated allowlist and trims blanks", () => {
    expect(corsOrigin({ CORS_ORIGINS: " https://app.example.test , http://localhost:3000 ,," })).toEqual([
      "https://app.example.test",
      "http://localhost:3000",
    ]);
  });

  it("refuses to run in production without an allowlist", () => {
    expect(() => corsOrigin({ NODE_ENV: "production" })).toThrow(/CORS_ORIGINS/);
    expect(corsOrigin({ NODE_ENV: "production", CORS_ORIGINS: "https://app.example.test" })).toEqual(["https://app.example.test"]);
  });
});

describe("CORS preflight methods", () => {
  /** Sends a browser-style preflight for one method and returns the allowed-methods header. */
  async function preflight(method: string) {
    const app = Fastify();
    await app.register(cors, { origin: ["https://app.example.test"], methods: CORS_METHODS });
    app.route({ method: method as "PUT", url: "/x", handler: async () => ({ ok: true }) });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/x",
      headers: { origin: "https://app.example.test", "access-control-request-method": method },
    });
    await app.close();
    return res;
  }

  it.each(["PUT", "PATCH", "DELETE"])("allows %s from the web origin", async (method) => {
    const res = await preflight(method);
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.test");
    expect(String(res.headers["access-control-allow-methods"])).toContain(method);
  });
});
