import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCurrentIdentityToken, AuthProvider, createIdentityRequest, useAuth } from "@/lib/auth";

const mockState = vi.hoisted(() => ({
  listener: null as ((event: string, session: unknown) => void) | null,
  client: {
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockState.client,
}));

function AuthState() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.email ?? "no-user"}</span>
      <button onClick={() => void auth.signOut()}>Sign out</button>
      <button onClick={() => void auth.signIn("doctor@example.test", "synthetic-password")}>Sign in</button>
      <button onClick={() => mockState.listener?.("PASSWORD_RECOVERY", testSession("user-recovery", "recovery@example.test"))}>Recovery</button>
      <button onClick={() => void auth.getToken().then((token) => document.body.setAttribute("data-token", token ?? ""))}>Get token</button>
    </div>
  );
}

/** Represents public form state that must survive the callback signing in. */
function PublicDraft() {
  const [value, setValue] = useState("");
  return <input aria-label="Public form draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

/** Creates a synthetic browser session for auth lifecycle tests. */
function testSession(id: string, email: string) {
  return { access_token: `token-${id}`, user: { id, email } };
}

describe("browser authentication lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.listener = null;
    mockState.client.auth.onAuthStateChange.mockImplementation((listener) => {
      mockState.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockState.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mockState.client.auth.signOut.mockImplementation(async () => {
      mockState.listener?.("SIGNED_OUT", null);
      return { error: null };
    });
  });

  it("restores a session, provides its access token, and clears the user on sign-out", async () => {
    const session = testSession("user-a", "patient@example.test");
    mockState.client.auth.getSession.mockResolvedValue({ data: { session }, error: null });

    render(<AuthProvider><AuthState /></AuthProvider>);
    expect(await screen.findByText("patient@example.test")).toBeInTheDocument();
    expect(screen.getByText("signed-in")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Get token" }));
    await waitFor(() => expect(document.body).toHaveAttribute("data-token", session.access_token));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("no-user")).toBeInTheDocument());
    expect(screen.getByText("signed-out")).toBeInTheDocument();
  });

  it("updates account state when Supabase changes identity", async () => {
    render(<AuthProvider><AuthState /></AuthProvider>);
    await screen.findByText("signed-out");

    await act(async () => {
      mockState.listener?.("SIGNED_IN", testSession("user-b", "doctor@example.test"));
    });

    expect(screen.getByText("doctor@example.test")).toBeInTheDocument();
    expect(screen.getByText("signed-in")).toBeInTheDocument();
  });

  it("leaves loading with a safe error when session restoration rejects", async () => {
    mockState.client.auth.getSession.mockRejectedValue(new Error("synthetic storage failure"));
    render(<AuthProvider><AuthState /></AuthProvider>);
    expect(await screen.findByText("error")).toBeInTheDocument();
    expect(screen.getByText("no-user")).toBeInTheDocument();
  });

  it("does not remount public callback/form state when identity changes", async () => {
    render(<AuthProvider><PublicDraft /></AuthProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "in-progress callback" } });
    await act(async () => {
      mockState.listener?.("SIGNED_IN", testSession("user-public", "public@example.test"));
    });
    expect(screen.getByRole("textbox")).toHaveValue("in-progress callback");
  });

  it("signs in through Supabase and observes the restored session", async () => {
    const session = testSession("user-login", "doctor@example.test");
    mockState.client.auth.signInWithPassword.mockImplementation(async () => {
      mockState.listener?.("SIGNED_IN", session);
      return { error: null };
    });
    render(<AuthProvider><AuthState /></AuthProvider>);
    await screen.findByText("signed-out");

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("doctor@example.test")).toBeInTheDocument());
    expect(mockState.client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "doctor@example.test",
      password: "synthetic-password",
    });
  });

  it("marks recovery sessions and aborts requests when the account changes", async () => {
    render(<AuthProvider><AuthState /></AuthProvider>);
    await screen.findByText("signed-out");
    const request = createIdentityRequest();

    await act(async () => {
      mockState.listener?.("PASSWORD_RECOVERY", testSession("user-recovery", "recovery@example.test"));
    });
    expect(screen.getByText("recovery")).toBeInTheDocument();

    await act(async () => {
      mockState.listener?.("SIGNED_IN", testSession("user-other", "other@example.test"));
    });
    expect(request.signal.aborted).toBe(true);
    expect(screen.getByText("other@example.test")).toBeInTheDocument();
    request.release();
  });

  it("rejects a previously acquired token after switching accounts", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    const first = testSession("old-account", "old@example.test");
    await act(async () => { mockState.listener?.("SIGNED_IN", first); });
    mockState.client.auth.getSession.mockResolvedValue({ data: { session: first }, error: null });
    const token = await result.current.getToken();
    expect(() => assertCurrentIdentityToken(token!)).not.toThrow();
    await act(async () => { mockState.listener?.("SIGNED_IN", testSession("next-account", "next@example.test")); });
    expect(() => assertCurrentIdentityToken(token!)).toThrow("account changed");
  });

  it("rejects a token lookup that resolves after an account change", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    const first = testSession("pending-account", "pending@example.test");
    await act(async () => { mockState.listener?.("SIGNED_IN", first); });
    let finish!: (value: unknown) => void;
    mockState.client.auth.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const token = result.current.getToken();
    const rejection = expect(token).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => { mockState.listener?.("SIGNED_IN", testSession("new-account", "new@example.test")); });
    finish({ data: { session: first }, error: null });
    await rejection;
  });
});
