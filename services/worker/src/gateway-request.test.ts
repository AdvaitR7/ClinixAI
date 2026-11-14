import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructuredTracked } from "./gateway.js";

const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { mocks.options(options); }
  chat = { completions: { create: mocks.create } };
} }));

afterEach(() => vi.unstubAllEnvs());

it.each(['{"ok":true}', '```json\n{"ok":true}\n```'])("validates a bounded non-streaming completion: %s", async (content) => {
  vi.stubEnv("NINEROUTER_BASE_URL", "https://router.example.test/v1");
  vi.stubEnv("NINEROUTER_API_KEY", "synthetic-key");
  vi.stubEnv("MODEL_ROUTE_OCR", "ag/gemini-3.8-flash-high");
  mocks.create.mockResolvedValue({ choices: [{ message: { content } }] });
  await expect(generateStructuredTracked({ role: "OCR", schema: z.object({ ok: z.literal(true) }), messages: [{ role: "user", content: "Return JSON" }] }))
    .resolves.toEqual({ value: { ok: true }, source: "live" });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "ag/gemini-3.8-flash-high", stream: false }));
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60_000, maxRetries: 0 }));
});
