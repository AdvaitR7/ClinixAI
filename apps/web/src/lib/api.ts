"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@clinix/schemas";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export async function fetchApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const err = new Error(body?.error?.message ?? `Request failed (${res.status})`);
    (err as { code?: string }).code = body?.error?.code ?? "UNKNOWN";
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export type MeState =
  | { status: "loading" }
  | { status: "needs-onboarding" }
  | { status: "ready"; me: MeResponse };

/**
 * Resolves the app role from Fastify GET /me. A 403 ONBOARDING_REQUIRED means
 * the session is valid but the profile row doesn't exist yet → redirect to
 * /onboarding. Anything else throws.
 */
export function useMe() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<MeState>({ status: "loading" });

  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setState({ status: "loading" });
    const token = await getToken();
    if (!token) return;
    try {
      const me = await fetchApi<MeResponse>(token, "/me");
      setState({ status: "ready", me });
    } catch (err) {
      if ((err as { code?: string }).code === "ONBOARDING_REQUIRED") {
        setState({ status: "needs-onboarding" });
      } else {
        throw err;
      }
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

export type ApiDataState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

/**
 * Generic authenticated GET hook (no TanStack Query — Phase 1 precedent).
 * Pass a null path to hold in loading until the path is known.
 */
export function useApiData<T>(path: string | null) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<ApiDataState<T>>({ status: "loading" });

  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    if (!path) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });
    const token = await getToken();
    if (!token) return;
    try {
      const data = await fetchApi<T>(token, path);
      setState({ status: "ready", data });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : "Request failed",
      });
    }
  }, [getToken, isLoaded, isSignedIn, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
