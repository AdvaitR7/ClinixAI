import { expect, test, type Page } from "@playwright/test";

const userId = "2e036082-69a1-4b95-88d9-3190ded27f62";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" };

/** Produces synthetic Auth responses; no real accounts, keys, or clinical data are used. */
function session(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const subject = email.startsWith("other") ? "5d167a2b-d772-4938-8fb8-747154bfc3b5" : userId;
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: subject, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`;
  const user = { id: subject, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  return { access_token: token, refresh_token: "synthetic-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
}

/** Exercises the real browser SDK against controlled HTTP Auth and Fastify boundaries. */
async function controlledServices(page: Page, hasProfile = true) {
  const state = { email: "synthetic@example.test", registeredName: "", passwordRequests: 0, exchanges: 0, resends: 0, updates: 0, apiUnavailable: false, refreshRejected: false };
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    let body: unknown = {};
    let status = 200;
    if (url.pathname.endsWith("/token")) {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        state.passwordRequests += 1;
        state.email = request.postDataJSON().email;
      } else if (grant === "pkce") {
        state.exchanges += 1;
        if (!request.postDataJSON().code_verifier) return route.fulfill({ status: 400, headers: cors, json: { code: "validation_failed", message: "Synthetic missing verifier" } });
      } else if (state.refreshRejected) {
        return route.fulfill({ status: 400, headers: cors, contentType: "application/json", body: JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic expired session" }) });
      }
      body = session(state.email);
    } else if (url.pathname.endsWith("/signup")) {
      state.email = request.postDataJSON().email;
      state.registeredName = request.postDataJSON().data.display_name;
      body = session(state.email).user;
    } else if (url.pathname.endsWith("/resend")) state.resends += 1;
    else if (url.pathname.endsWith("/user")) {
      if (request.method() === "PUT") state.updates += 1;
      body = session(state.email).user;
    } else if (url.pathname.endsWith("/logout")) status = 204;
    await route.fulfill({ status, headers: cors, contentType: "application/json", ...(status !== 204 ? { body: JSON.stringify(body) } : {}) });
  });
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (state.apiUnavailable) return route.fulfill({ status: 503, headers: cors, json: { error: { code: "AUTH_UNAVAILABLE", message: "Synthetic verifier outage" } } });
    if (path.endsWith("/me")) {
      return route.fulfill({ status: hasProfile ? 200 : 403, headers: cors, json: hasProfile
        ? { profile_id: "d01fc949-f7d5-44cb-b7e9-7804e83cff38", role: "PATIENT", patient_id: "fdd87f59-23b7-4472-8fca-79cfad6a592d", doctor_id: null, verification_status: null }
        : { error: { code: "ONBOARDING_REQUIRED", message: "Complete onboarding" } } });
    }
    await route.fulfill({ headers: cors, json: { upcoming_appointment: null, pending_followups: [], recent_timeline: [] } });
  });
  return state;
}

/** Signs in through the user-facing form rather than injecting a stored session. */
async function signIn(page: Page, email = "synthetic@example.test") {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("SDK sign-in restores on refresh, and sign-out clears the protected screen", async ({ page }) => {
  const state = await controlledServices(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/patient$/);
  await expect(page.getByRole("heading", { name: "Your care, at a glance" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your care, at a glance" })).toBeVisible();
  expect(state.passwordRequests).toBe(1);
  await page.getByLabel("Account options", { exact: true }).click();
  await expect(page.getByText("synthetic@example.test", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Your care, at a glance" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
});

test("confirmation-required registration waits without a session and permits resend", async ({ page }) => {
  const state = await controlledServices(page, false);
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Synthetic Registration");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(state.registeredName).toBe("Synthetic Registration");
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByRole("button", { name: "Resend confirmation" }).click();
  await expect.poll(() => state.resends).toBe(1);
  await page.goto("/auth/callback?code=synthetic-confirmation-code");
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  expect(state.exchanges).toBe(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("recovery exchanges PKCE once and validates the password before updating", async ({ page }) => {
  const state = await controlledServices(page, false);
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account matches");
  await page.goto("/auth/callback?code=synthetic-recovery-code&next=%2Freset-password");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("new-synthetic-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-synthetic-password");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
  expect(state.updates).toBe(0);
  await page.getByLabel("Confirm password", { exact: true }).fill("new-synthetic-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  expect(state.exchanges).toBe(1);
  expect(state.updates).toBe(1);
});

test("a backend outage holds the workspace until access can be confirmed", async ({ page }) => {
  const state = await controlledServices(page);
  state.apiUnavailable = true;
  await signIn(page);
  await expect(page.getByText("We could not load your account. Please try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your care, at a glance" })).toHaveCount(0);
  state.apiUnavailable = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
});

test("an expired refresh session returns to sign-in without exposing private content", async ({ page }) => {
  const state = await controlledServices(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/patient$/);
  state.refreshRejected = true;
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith("auth-token"));
    if (!key) throw new Error("Synthetic persisted session missing");
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 120;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Your care, at a glance" })).toHaveCount(0);
});

test("cancelled and expired callbacks provide restart paths", async ({ page }) => {
  await controlledServices(page);
  await page.goto("/auth/callback#error=access_denied&error_code=otp_expired");
  await expect(page.getByRole("status")).toContainText("has expired");
  await page.goto("/auth/callback?error=access_denied");
  await expect(page.getByRole("status")).toContainText("was cancelled");
  await expect(page.getByRole("link", { name: "Return to sign in" })).toBeVisible();
});

test("a code opened without this browser's PKCE verifier has a restart path", async ({ page }) => {
  await controlledServices(page);
  await page.goto("/auth/callback?code=synthetic-code-from-another-browser");
  await expect(page.getByRole("status")).toContainText("opened on another device");
  await expect(page.getByRole("link", { name: "Resend confirmation" })).toBeVisible();
});

test("switching accounts discards a private response still in flight", async ({ page }) => {
  const state = await controlledServices(page);
  let releaseOld!: () => void;
  let oldFinished!: () => void;
  const waitForRelease = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldDone = new Promise<void>((resolve) => { oldFinished = resolve; });
  let requests = 0;
  await page.route("http://127.0.0.1:4000/api/v1/patients/self/dashboard", async (route) => {
    const first = ++requests === 1;
    if (first) await waitForRelease;
    try {
      await route.fulfill({ headers: cors, json: {
        upcoming_appointment: { scheduled_start: new Date().toISOString(), status: "CONFIRMED", reason: first ? "Old account synthetic visit" : "New account synthetic visit" },
        pending_followups: [], recent_timeline: [],
      } });
    } finally { if (first) oldFinished(); }
  });
  await signIn(page);
  await expect.poll(() => requests).toBe(1);
  await page.getByLabel("Account options", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, "other-synthetic@example.test");
  await expect(page.getByText("New account synthetic visit", { exact: true })).toBeVisible();
  releaseOld();
  await oldDone;
  await expect(page.getByText("Old account synthetic visit", { exact: true })).toHaveCount(0);
  expect(state.email).toBe("other-synthetic@example.test");
});
