import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queues: vi.fn(), write: vi.fn(), sql: vi.fn() }));
vi.mock("node:fs", () => ({ writeFileSync: mocks.write }));
vi.mock("pg-boss", () => ({ PgBoss: class {
  on = vi.fn(); start = vi.fn(); createQueue = vi.fn(); work = vi.fn();
  getQueues = mocks.queues;
} }));
vi.mock("./db.js", () => ({ sql: mocks.sql }));
vi.mock("./handlers/document-extract.js", () => ({ handleDocumentExtract: vi.fn() }));
vi.mock("./handlers/ai-analyze.js", () => ({ handleAiAnalyze: vi.fn() }));
vi.mock("./gateway.js", () => ({ generateStructured: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("stops reporting healthy and exits after repeated queue failures despite a responsive application database", async () => {
  vi.useFakeTimers();
  vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/test");
  mocks.sql.mockResolvedValue([]);
  mocks.queues.mockResolvedValueOnce([]).mockRejectedValue(new Error("Queue connection stalled"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  await import("./index.js");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(1);
});
