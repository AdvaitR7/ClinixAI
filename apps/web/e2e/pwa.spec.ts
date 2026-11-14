import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE = "https://supabase.clinix.test";
const API = "https://api.clinix.test";
const userId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" };

/** Waits until the service worker is active and controlling the page. */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

/** Intercepts the synthetic Supabase and API origins (including requests made by the service worker). */
async function mockOrigins(context: BrowserContext) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-user@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  const hits = { api: 0, supabase: 0 };
  await context.route(`${SUPABASE}/**`, (route) => {
    hits.supabase += 1;
    return route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session });
  });
  await context.route(`${API}/**`, (route) => {
    hits.api += 1;
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = path === "/me" ? { profile_id: userId, role: "PATIENT", patient_id: "fdd87f59-23b7-4472-8fca-79cfad6a592d", doctor_id: null, verification_status: null, memberships: [] } : [];
    return route.fulfill({ headers: cors, json });
  });
  return hits;
}

test("manifest has the required fields and every icon resolves", async ({ page }) => {
  await page.goto("/sign-in");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "CliniX AI", short_name: "CliniX", start_url: "/", display: "standalone", orientation: "portrait", theme_color: "#F2F6F6", background_color: "#F2F6F6" });
  const purposes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await page.request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
});

test("theme colour, viewport cover and iOS web-app metadata are present", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#F2F6F6");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-180\.png/);
});

test("the service worker registers, is served uncached and takes control", async ({ page }) => {
  const res = await page.request.get("/sw.js");
  expect(res.headers()["content-type"]).toContain("javascript");
  expect(res.headers()["cache-control"]).toContain("no-cache");
  await page.goto("/sign-in");
  await controlled(page);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  expect(state).toBe("activated");
});

test("Chromium reports no installability errors for the manifest and service worker", async ({ page, context }) => {
  await page.goto("/sign-in");
  await controlled(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
  const { url, errors } = (await cdp.send("Page.getAppManifest")) as { url: string; errors: { message: string }[] };
  expect(url).toContain("/manifest.webmanifest");
  expect(errors.map((e) => e.message)).toEqual([]);
});

test("going offline shows the /~offline screen for a navigation", async ({ page, context }) => {
  await page.goto("/sign-in");
  await controlled(page);
  await context.setOffline(true);
  await page.goto("/settings").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await context.setOffline(false);
});

test("no API or Supabase response is ever stored in any cache", async ({ page, context }) => {
  const hits = await mockOrigins(context);
  await page.goto("/sign-in");
  await controlled(page);
  await page.getByLabel("Email", { exact: true }).fill("synthetic-user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  // Make sure authenticated API traffic really flowed through the controlled page.
  expect(hits.api).toBeGreaterThan(0);
  expect(hits.supabase).toBeGreaterThan(0);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return { names: await caches.keys(), urls };
  });
  expect(cached.urls.length).toBeGreaterThan(0);
  expect(cached.urls.some((url) => url.includes("/_next/static/"))).toBe(true);
  expect(cached.urls.filter((url) => url.startsWith(API) || url.startsWith(SUPABASE) || url.includes("/api/v1") || url.includes("/auth/v1"))).toEqual([]);
});

for (const width of [320, 393]) {
  test(`no horizontal overflow at ${width}px`, async ({ page, context }) => {
    await mockOrigins(context);
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/sign-in", "/~offline"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill("synthetic-user@example.test");
    await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/patient$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `patient home at ${width}px`).toBeLessThanOrEqual(0);
  });
}
