import { describe, expect, it } from "vitest";
import { corsOrigin } from "./cors";

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
