import { describe, expect, it } from "vitest";
import { nativeAuthCallbackPath } from "./native";

const origin = "https://example.invalid";
describe("native authentication callback boundary", () => {
  it("preserves the one-time code and recovery destination for the local callback", () => {
    expect(nativeAuthCallbackPath(`${origin}/auth/callback?code=one-time&next=%2Freset-password`, origin)).toBe("/auth/callback?code=one-time&next=%2Freset-password");
  });
  it("rejects another host, another port, and an insecure scheme", () => {
    for (const url of ["https://evil.example/auth/callback?code=x", `${origin}:444/auth/callback`, "http://example.invalid/auth/callback"]) expect(nativeAuthCallbackPath(url, origin)).toBeNull();
  });
  it("rejects arbitrary routes and embedded credentials", () => {
    expect(nativeAuthCallbackPath(`${origin}/app/patient`, origin)).toBeNull();
    expect(nativeAuthCallbackPath("https://user:password@example.invalid/auth/callback", origin)).toBeNull();
  });
  it("fails closed for malformed links or missing configuration", () => {
    expect(nativeAuthCallbackPath("not-a-url", origin)).toBeNull();
    expect(nativeAuthCallbackPath(`${origin}/auth/callback`, undefined)).toBeNull();
  });
});
