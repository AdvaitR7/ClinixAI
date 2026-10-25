"use client";

import {
  assertCurrentIdentityToken,
  assertCurrentIdentityVersion,
  createIdentityRequest,
  getCurrentIdentityVersion,
  useAuth,
} from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@clinix/schemas";
import { getSupabaseClient } from "@/lib/supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

/** Validates and joins a relative API path to the configured backend origin. */
function apiUrl(path: string): string {
  if (!API_BASE?.trim()) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  let base: URL;
  try {
    base = new URL(API_BASE);
  } catch {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an absolute URL.");
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an HTTP endpoint without embedded credentials.");
  }
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new Error("The production API must use HTTPS.");
  }
  return `${base.toString().replace(/\/$/, "")}${path}`;
}

/** Converts the existing API error envelope into a typed client error. */
async function responseError(res: Response): Promise<Error & { code?: string; status?: number }> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  const err = new Error(body?.error?.message ?? `Request failed (${res.status})`) as Error & {
    code?: string;
    status?: number;
  };
  err.code = body?.error?.code ?? "UNKNOWN";
  err.status = res.status;
  return err;
}

/** Retries only safe GET requests after Supabase refreshes a rejected token. */
async function authenticatedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const url = apiUrl(path);
  const first = await fetch(url, { ...init, headers });
  if (first.status !== 401 || (init?.method && init.method.toUpperCase() !== "GET")) return first;
  if (init?.signal?.aborted) throw new DOMException("Request aborted", "AbortError");

  const { data, error } = await getSupabaseClient().auth.refreshSession();
  if (error || !data.session?.access_token) return first;
  if (init?.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(url, { ...init, headers });
}

/** Sends an authenticated API request and keeps the existing response shape. */
export async function fetchApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  assertCurrentIdentityToken(token);
  const identityRequest = createIdentityRequest(init?.signal ?? undefined);
  try {
    const res = await authenticatedFetch(token, path, { ...init, signal: identityRequest.signal });
    assertCurrentIdentityVersion(identityRequest.identityVersion);
    if (!res.ok) throw await responseError(res);
    const data = await res.json() as T;
    assertCurrentIdentityVersion(identityRequest.identityVersion);
    return data;
  } finally {
    identityRequest.release();
  }
}

export type MeState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "recovery" }
  | { status: "needs-onboarding" }
  | { status: "error"; error: string }
  | { status: "ready"; me: MeResponse };

/** Returns an authenticated response as a Blob, such as a prescription PDF. */
export async function fetchApiBlob(token: string, path: string, init?: RequestInit): Promise<Blob> {
  assertCurrentIdentityToken(token);
  const identityRequest = createIdentityRequest(init?.signal ?? undefined);
  try {
    const res = await authenticatedFetch(token, path, { ...init, signal: identityRequest.signal });
    assertCurrentIdentityVersion(identityRequest.identityVersion);
    if (!res.ok) throw await responseError(res);
    const blob = await res.blob();
    assertCurrentIdentityVersion(identityRequest.identityVersion);
    return blob;
  } finally {
    identityRequest.release();
  }
}

/** Resolves the application role through Fastify after auth state is ready. */
export function useMe() {
  const { getToken, isLoaded, isSignedIn, identityVersion, status: authStatus } = useAuth();
  const [state, setState] = useState<MeState>({ status: "loading" });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!isLoaded) {
      setState({ status: "loading" });
      return;
    }
    if (authStatus === "recovery") {
      setState({ status: "recovery" });
      return;
    }
    if (!isSignedIn) {
      setState({ status: "signed-out" });
      return;
    }
    setState({ status: "loading" });
    try {
      const token = await getToken();
      if (signal?.aborted) return;
      if (identityVersion !== getCurrentIdentityVersion()) return;
      if (!token) {
        setState({ status: "signed-out" });
        return;
      }
      const me = await fetchApi<MeResponse>(token, "/me", { signal });
      if (!signal?.aborted && identityVersion === getCurrentIdentityVersion()) setState({ status: "ready", me });
    } catch (cause) {
      if (signal?.aborted) return;
      if ((cause as { code?: string }).code === "ONBOARDING_REQUIRED") {
        setState({ status: "needs-onboarding" });
      } else {
        setState({ status: "error", error: cause instanceof Error ? cause.message : "The API is unavailable." });
      }
    }
  }, [authStatus, getToken, identityVersion, isLoaded, isSignedIn]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void refresh(controller.signal);
    });
    return () => controller.abort();
  }, [refresh]);

  return { ...state, refresh };
}

export type ApiDataState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

/** Loads authenticated GET data and resets it when account identity changes. */
export function useApiData<T>(path: string | null) {
  const { getToken, isLoaded, isSignedIn, identityVersion } = useAuth();
  const [state, setState] = useState<ApiDataState<T>>({ status: "loading" });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!isLoaded || !isSignedIn || !path) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });
    try {
      const token = await getToken();
      if (signal?.aborted) return;
      if (identityVersion !== getCurrentIdentityVersion()) return;
      if (!token) {
        setState({ status: "loading" });
        return;
      }
      const data = await fetchApi<T>(token, path, { signal });
      if (!signal?.aborted && identityVersion === getCurrentIdentityVersion()) setState({ status: "ready", data });
    } catch (cause) {
      if (!signal?.aborted) {
        setState({ status: "error", error: cause instanceof Error ? cause.message : "Request failed" });
      }
    }
  }, [getToken, identityVersion, isLoaded, isSignedIn, path]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void refresh(controller.signal);
    });
    return () => controller.abort();
  }, [refresh]);

  return { ...state, refresh };
}
