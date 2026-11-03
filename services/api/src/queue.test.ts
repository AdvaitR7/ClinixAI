import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("pg-boss", () => ({
  PgBoss: class {
    constructor() { return mocks.create(); }
  },
}));

describe("API queue lifecycle", () => {
  let candidate: EventEmitter & { start: ReturnType<typeof vi.fn>; createQueue: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    candidate = Object.assign(new EventEmitter(), {
      start: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue("job-id"),
    });
    mocks.create.mockReset().mockReturnValue(candidate);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("contains background error events before and after startup instead of crashing the API", async () => {
    candidate.start.mockImplementation(async () => {
      expect(() => candidate.emit("error", new Error("connection interrupted"))).not.toThrow();
    });
    const queue = await import("./queue.js");
    await queue.startQueue();
    expect(() => candidate.emit("error", new Error("idle connection lost"))).not.toThrow();
    expect(queue.queueReady()).toBe(true);
    await queue.sendAiAnalysis("synthetic-session", "synthetic-encounter");
    expect(candidate.send).toHaveBeenCalledWith("ai.analyze", {
      aiSessionId: "synthetic-session", encounterId: "synthetic-encounter",
    });
  });

  it("waits for queue creation before reporting readiness or sending concurrent jobs", async () => {
    let finish!: () => void;
    candidate.createQueue.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const queue = await import("./queue.js");
    const startup = queue.startQueue();
    await vi.waitFor(() => expect(candidate.createQueue).toHaveBeenCalled());
    const send = queue.sendDocumentExtract("synthetic-document");
    expect(queue.queueReady()).toBe(false);
    expect(candidate.send).not.toHaveBeenCalled();
    finish();
    await Promise.all([startup, send]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(queue.queueReady()).toBe(true);
    expect(candidate.send).toHaveBeenCalledWith("document.extract", { documentId: "synthetic-document" });
  });

  it("cleans up failed startup and allows a later retry", async () => {
    candidate.createQueue.mockRejectedValueOnce(new Error("database unavailable"));
    const queue = await import("./queue.js");
    expect(await queue.startQueue()).toBeNull();
    expect(queue.queueReady()).toBe(false);
    expect(candidate.stop).toHaveBeenCalledWith({ graceful: false });
    expect(await queue.startQueue()).toBe(candidate);
    expect(queue.queueReady()).toBe(true);
  });
});
