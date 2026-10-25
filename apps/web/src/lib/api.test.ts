import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:4000/api/v1";
  return { refreshSession: vi.fn() };
});

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ auth: { refreshSession: mocks.refreshSession } }),
}));

import { fetchApi } from "@/lib/api";

describe("authenticated API retries", () => {
  beforeEach(() => {
    mocks.refreshSession.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requires HTTPS even for loopback API endpoints in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fetchApi("test-token", "/me")).rejects.toThrow("production API must use HTTPS");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries a safe read once with the refreshed token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    mocks.refreshSession.mockResolvedValue({ data: { session: { access_token: "refreshed-test-token" } }, error: null });

    await expect(fetchApi("initial-test-token", "/me")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get("Authorization"))
      .toBe("Bearer refreshed-test-token");
  });

  it.each([
    [401, "POST"],
    [403, "GET"],
  ])("does not refresh or replay status %s for %s", async (status, method) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code: "DENIED" } }, { status }));

    await expect(fetchApi("test-token", "/synthetic", { method })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("does not replay a request cancelled while refresh is in progress", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    let finishRefresh!: (value: unknown) => void;
    mocks.refreshSession.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const controller = new AbortController();
    const request = fetchApi("test-token", "/me", { signal: controller.signal });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(mocks.refreshSession).toHaveBeenCalledOnce());
    controller.abort();
    finishRefresh({ data: { session: { access_token: "next-test-token" } }, error: null });

    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
