"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";

type AuthStatus = "loading" | "signed-out" | "signed-in" | "recovery" | "error";

type AuthValue = {
  status: AuthStatus;
  error: string | null;
  session: Session | null;
  user: User | null;
  identityVersion: number;
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  completeCallback: (code: string, recovery: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
let currentIdentityVersion = 0;
const identityRequests = new Set<AbortController>();
const identityObjectUrls = new Set<string>();

/** Cancels pending work and releases private browser data when accounts change. */
function invalidateIdentityState(): number {
  currentIdentityVersion += 1;
  for (const controller of identityRequests) controller.abort();
  identityRequests.clear();
  for (const objectUrl of identityObjectUrls) URL.revokeObjectURL(objectUrl);
  identityObjectUrls.clear();
  return currentIdentityVersion;
}

/** Binds a fetch to the current account and allows auth changes to abort it. */
export function createIdentityRequest(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  identityRequests.add(controller);
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    identityVersion: currentIdentityVersion,
    release: () => {
      identityRequests.delete(controller);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

/** Rejects a request when its token came from an earlier account session. */
export function assertCurrentIdentityToken(token: string): void {
  const tokenIdentityVersion = tokenVersions.get(token);
  if (tokenIdentityVersion !== undefined && tokenIdentityVersion !== currentIdentityVersion) {
    throw new Error("Your account changed. Retry the request.");
  }
}

/** Rejects a response after the browser switches to a different account. */
export function assertCurrentIdentityVersion(version: number): void {
  if (version !== currentIdentityVersion) {
    throw new Error("Your account changed before this request finished.");
  }
}

/** Returns the active browser identity generation for request cleanup. */
export function getCurrentIdentityVersion(): number {
  return currentIdentityVersion;
}

/** Creates a Blob URL that is revoked when the signed-in account changes. */
export function createIdentityObjectUrl(blob: Blob): string {
  const objectUrl = URL.createObjectURL(blob);
  identityObjectUrls.add(objectUrl);
  return objectUrl;
}

const tokenVersions = new Map<string, number>();

/** Builds a fixed same-app callback URL and requires HTTPS in production. */
function redirectUrl(path: string): string {
  const configuredBase = process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredBase) {
    throw Object.assign(new Error("NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL must be configured in production."), { code: "auth_redirect_configuration" });
  }
  const base = configuredBase || window.location.origin;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw Object.assign(new Error("Authentication redirect URL must be an absolute URL."), { code: "auth_redirect_configuration" });
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw Object.assign(new Error("Authentication redirect URL must use HTTPS in production."), { code: "auth_redirect_configuration" });
  }
  return new URL(path, parsed).toString();
}

/** Shares one Supabase session and auth lifecycle across the browser app. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [identityVersion, setIdentityVersion] = useState(0);
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    let receivedAuthEvent = false;

    try {
      const supabase = getSupabaseClient();
      const result = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!active) return;
        receivedAuthEvent = true;
        const nextUserId = nextSession?.user.id ?? null;
        if (previousUserId.current !== nextUserId) {
          previousUserId.current = nextUserId;
          const nextVersion = invalidateIdentityState();
          setIdentityVersion(nextVersion);
        }
        setSession(nextSession);
        setError(null);
        setStatus(
          event === "PASSWORD_RECOVERY" || (window.location.pathname === "/reset-password" && Boolean(nextSession))
            ? "recovery"
            : nextSession
              ? "signed-in"
              : "signed-out",
        );
      });
      subscription = result.data.subscription;
      void supabase.auth.getSession().then(({ data, error: sessionError }) => {
        if (!active || receivedAuthEvent) return;
        if (sessionError) {
          setError("Could not restore your session. Please sign in again.");
          setStatus("error");
          return;
        }
        const initialSession = data.session;
        previousUserId.current = initialSession?.user.id ?? null;
        if (initialSession) {
          tokenVersions.set(initialSession.access_token, currentIdentityVersion);
        }
        setSession(initialSession);
        setStatus(initialSession
          ? window.location.pathname === "/reset-password" ? "recovery" : "signed-in"
          : "signed-out");
      }).catch(() => {
        if (!active || receivedAuthEvent) return;
        setError("Could not restore your session. Please sign in again.");
        setStatus("error");
      });
    } catch (cause) {
      queueMicrotask(() => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Authentication is unavailable.");
        setStatus("error");
      });
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const getToken = useCallback(async () => {
    const requestedVersion = currentIdentityVersion;
    const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (requestedVersion !== currentIdentityVersion) {
      throw new DOMException("Your account changed.", "AbortError");
    }
    if (sessionError) throw sessionError;
    const token = data.session?.access_token ?? null;
    if (token) tokenVersions.set(token, currentIdentityVersion);
    return token;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error: authError } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (authError) throw authError;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const redirectTo = redirectUrl("/auth/callback");
    const { data, error: authError } = await getSupabaseClient().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: redirectTo },
    });
    if (authError) throw authError;
    return Boolean(data.session);
  }, []);

  const signOut = useCallback(async () => {
    const { error: authError } = await getSupabaseClient().auth.signOut();
    if (authError) throw authError;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error: authError } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl("/auth/callback?next=%2Freset-password"),
    });
    if (authError) throw authError;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error: authError } = await getSupabaseClient().auth.updateUser({ password });
    if (authError) throw authError;
    setStatus("signed-in");
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error: authError } = await getSupabaseClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectUrl("/auth/callback") },
    });
    if (authError) throw authError;
  }, []);

  const completeCallback = useCallback(async (code: string, recovery: boolean) => {
    const { data, error: authError } = await getSupabaseClient().auth.exchangeCodeForSession(code);
    if (authError) throw authError;
    if (!data.session) throw new Error("The sign-in link has expired. Request a new one.");
    setSession(data.session);
    setStatus(recovery ? "recovery" : "signed-in");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      error,
      session,
      user: session?.user ?? null,
      identityVersion,
      isLoaded: status !== "loading",
      isSignedIn: Boolean(session),
      getToken,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      completeCallback,
    }),
    [completeCallback, error, getToken, identityVersion, requestPasswordReset, resendConfirmation, session, signIn, signOut, signUp, status, updatePassword],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/** Returns the auth actions and state shared by all browser screens. */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Returns the current Supabase user after session restoration completes. */
export function useCurrentUser() {
  const { user, isLoaded, status } = useAuth();
  return { user, isLoaded, status };
}

/** Returns the current Supabase session without exposing storage details. */
export function useSession() {
  const { session, isLoaded, status } = useAuth();
  return { session, isLoaded, status };
}
