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
