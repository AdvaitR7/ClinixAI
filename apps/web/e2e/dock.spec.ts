import { expect, test, type Page } from "@playwright/test";

const userId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const practiceId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" };

/** Minimal correctly shaped GET payloads for screens that crash on a bare empty list. */
const fixtures: Record<string, unknown> = {
  "/patients/self/dashboard": { upcoming_appointment: null, pending_followups: [], recent_timeline: [] },
  "/staff/dashboard": { practice: { id: practiceId, name: "City Clinic" }, role: "RECEPTION", counts: { requested: 0, waiting: 0, unpaid: 0, contact: 0 }, appointments: [], assigned_followups: [] },
  "/doctor/dashboard": { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } },
  "/doctors/self/availability": { configured: false, template: [], slot_duration_minutes: 30, rules: { breaks: [], blocked_dates: [], overrides: [], online_template: null } },
  "/doctors/self/profile": { locked: { display_name: "Dr. Synthetic", registration_number: "SYN-001", registration_authority: "Synthetic Council", qualification: null, speciality: null, verification_status: "VERIFIED" }, bio: null, languages: [], visit_duration_minutes: null, services: [], accepting_appointments: false, directory_visible: false },
  "/patients/self/medications": { medications: [] },
  "/patients/self/access-ledger": { events: [], total: 0, counts: { all: 0, clinical: 0, admin: 0, ai: 0 } },
  "/staff/schedule": { date: "2026-10-27", role: "RECEPTION", appointments: [] },
};

const roles = {
  patient: {
    me: { profile_id: userId, role: "PATIENT", patient_id: "fdd87f59-23b7-4472-8fca-79cfad6a592d", doctor_id: null, verification_status: null, memberships: [] },
    routes: ["/app/patient", "/app/patient/appointments", "/app/patient/book", "/app/patient/care", "/app/patient/vault", "/app/patient/timeline", "/app/patient/medications", "/app/patient/privacy", "/notifications", "/settings"],
  },
  doctor: {
    me: { profile_id: userId, role: "DOCTOR", patient_id: null, doctor_id: "d01fc949-f7d5-44cb-b7e9-7804e83cff38", verification_status: "VERIFIED", memberships: [] },
    routes: ["/app/doctor", "/app/doctor/schedule", "/app/doctor/profile", "/app/doctor/patients", "/app/doctor/drafts", "/app/doctor/followups", "/app/doctor/team", "/notifications", "/settings"],
  },
  staff: {
    me: { profile_id: userId, role: "CLINIC_STAFF", patient_id: null, doctor_id: null, verification_status: null, memberships: [{ member_id: "m1", practice_id: practiceId, practice_name: "City Clinic", role: "RECEPTION" }] },
    routes: ["/app/staff", "/app/staff/schedule", "/app/staff/followups", "/app/staff/claims", "/notifications", "/settings"],
  },
} as const;

/** Signs in against synthetic auth/API so real pages, guards and shells render. */
async function signIn(page: Page, me: object) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-user@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.sig`, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (r) => r.fulfill({ headers: cors, json: r.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (r) => {
    const path = new URL(r.request().url()).pathname.replace("/api/v1", "");
    const method = r.request().method();
    if (method === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    let json: unknown = method === "GET" ? [] : {};
    if (path === "/me") json = me;
    else if (method === "GET" && path in fixtures) json = fixtures[path];
    await r.fulfill({ headers: cors, json }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
}

for (const [role, { me, routes }] of Object.entries(roles)) {
  for (const width of [393, 1280]) {
    test(`${role} dock stays pinned to the viewport bottom at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 393 ? 852 : 800 });
      await signIn(page, me);
      for (const route of routes) {
        await page.goto(route);
        const dock = page.locator("nav[aria-label$='workspace']");
        await expect(page.getByText("Application error", { exact: false }), route).toHaveCount(0);
        await expect(dock, route).toBeVisible();
        const position = async () => dock.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { css: getComputedStyle(node).position, gap: Math.round(innerHeight - box.bottom), top: box.top };
        });
        // Pinned before any scrolling, whatever the page height (long pages and short pages alike).
        // Pages swap shells while data loads, so wait for a stable, attached dock first.
        await expect.poll(async () => (await position().catch(() => ({ css: "" }))).css, { message: route }).toBe("fixed");
        const top = await position();
        expect(top.gap, route).toBeGreaterThanOrEqual(15);
        expect(top.gap, route).toBeLessThanOrEqual(18);
        // Still pinned at the end of the page, and the last control is not hidden behind it.
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const end = await position();
        expect(end.gap, route).toBe(top.gap);
        const hidden = await page.evaluate((dockTop) => {
          const controls = [...document.querySelectorAll("main button:not(:disabled), main a, main input")].filter((n) => !n.closest("nav"));
          const last = controls.map((n) => n.getBoundingClientRect()).filter((b) => b.height > 0).sort((a, b) => b.bottom - a.bottom)[0];
          return last ? last.bottom > dockTop : false;
        }, end.top);
        expect(hidden, `${route}: last control sits under the dock`).toBe(false);
      }
    });
  }
}
