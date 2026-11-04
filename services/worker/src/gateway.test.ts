import { describe, expect, it } from "vitest";
import { gatewayBaseUrl } from "./gateway.js";

describe("9Router base URL", () => {
  it("adds the OpenAI-compatible API prefix when it is missing", () => {
    expect(gatewayBaseUrl("https://router.example.com")).toBe("https://router.example.com/v1");
  });

  it("keeps one API prefix when the URL already includes it", () => {
    expect(gatewayBaseUrl("https://router.example.com/gateway/v1/")).toBe("https://router.example.com/gateway/v1");
  });

  it("allows HTTP only for local router development", () => {
    expect(gatewayBaseUrl("http://localhost:20128")).toBe("http://localhost:20128/v1");
    expect(() => gatewayBaseUrl("http://router.example.com")).toThrow(/HTTPS/);
  });

  it("rejects an unset URL", () => {
    expect(() => gatewayBaseUrl(undefined)).toThrow(/NINEROUTER_BASE_URL/);
  });
});
