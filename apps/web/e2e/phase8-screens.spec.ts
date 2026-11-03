import { expect, test, type Page } from "@playwright/test";

const userId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const practiceId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const doctorId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const eventId = "7a1d44f0-6f2b-4d57-9f0e-2d5b7f4c9a10";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

type Call = { method: string; path: string; body: Record<string, unknown> };
type Reply = { status?: number; json: unknown };
type Handler = (path: string, method: string, body: Record<string, unknown>) => Reply | undefined;

/** Minimal landing-page payloads so the post-sign-in dashboards render instead of crashing the harness. */
function landingDefaults(path: string): Reply | undefined {
  if (path === "/patients/self/dashboard") return { json: { upcoming_appointment: null, pending_followups: [], recent_timeline: [] } };
  if (path === "/staff/dashboard") return { json: { practice: { id: practiceId, name: "City Clinic" }, role: "RECEPTION", counts: { requested: 0, waiting: 0, unpaid: 0, contact: 0 }, appointments: [], assigned_followups: [] } };
  return undefined;
}

/** Runs the real pages, guards and SDK against controlled synthetic HTTP, then signs in. */
async function services(page: Page, me: Record<string, unknown>, handler: Handler, landing: RegExp) {
  const calls: Call[] = [];
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-user@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
    calls.push({ method, path, body });
    const reply = path === "/me" ? { json: me } : (handler(path, method, body) ?? landingDefaults(path));
    await route.fulfill({ status: reply?.status ?? 200, headers: cors, json: reply?.json ?? (method === "GET" ? [] : {}) }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(landing);
  return calls;
}

const patientMe = { profile_id: userId, role: "PATIENT", patient_id: patientId, doctor_id: null, verification_status: null, memberships: [] };
const doctorMe = { profile_id: userId, role: "DOCTOR", patient_id: null, doctor_id: doctorId, verification_status: "VERIFIED", memberships: [] };
const staffMe = { profile_id: userId, role: "CLINIC_STAFF", patient_id: null, doctor_id: null, verification_status: null, memberships: [{ member_id: "m1", practice_id: practiceId, practice_name: "City Clinic", role: "RECEPTION" }] };

const notification = (over: Record<string, unknown>) => ({
  id: "n1", type: "PRACTICE_INVITATION_ACCEPTED", title: "Invitation accepted", body: "A receptionist joined your practice.", read: false,
  related_resource_type: "practice_member", related_resource_id: "9d1c8a0e-6a5e-4a58-9a52-0f0b0d0c0e01", created_at: "2026-10-27T05:00:00Z", ...over,
});

test("notifications show unread state as text, mark read on open and mark all read", async ({ page }) => {
  const items = [notification({}), notification({ id: "n2", title: "Welcome", body: "Your account is ready.", read: true, related_resource_type: null, related_resource_id: null })];
  const calls = await services(page, patientMe, (path, method) => {
    if (path === "/notifications" && method === "GET") return { json: items };
    if (path === "/notifications/read-all") { items.forEach((n) => { n.read = true; }); return { json: { updated: 1 } }; }
    if (/^\/notifications\/n\d\/read$/.test(path)) { items.find((n) => path.includes(n.id))!.read = true; return { json: { read: true } }; }
    return undefined;
  }, /\/app\/patient$/);
  await page.setViewportSize({ width: 393, height: 900 });
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  await expect(page.getByText("1 unread")).toBeVisible();
  const unreadRow = page.getByRole("button", { name: /Invitation accepted/ });
  await expect(unreadRow.getByText("Unread")).toBeVisible();
  await expect(page.getByRole("button", { name: /Welcome/ }).getByText("Read", { exact: true })).toBeVisible();
  // A row with no destination stays on the page and only changes its read state.
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("You are up to date.")).toBeVisible();
  expect(calls.some((c) => c.path === "/notifications/read-all" && c.method === "POST")).toBe(true);
  await expect(page.getByRole("button", { name: "Mark all as read" })).toHaveCount(0);
});

test("opening an unread notification marks it read and follows its destination", async ({ page }) => {
  const calls = await services(page, doctorMe, (path, method) => {
    if (path === "/notifications" && method === "GET") return { json: [notification({})] };
    if (path === "/notifications/n1/read") return { json: { read: true } };
    return undefined;
  }, /\/app\/doctor$/);
  await page.goto("/notifications");
  await page.getByRole("button", { name: /Invitation accepted/ }).click();
  await expect.poll(() => calls.some((c) => c.path === "/notifications/n1/read" && c.method === "POST")).toBe(true);
  await expect(page).toHaveURL(/\/app\/doctor\/team/);
});

test("notifications show an empty state and an honest error state", async ({ page }) => {
  let fail = false;
  await services(page, patientMe, (path) => (path === "/notifications" ? (fail ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Internal error" } } } : { json: [] }) : undefined), /\/app\/patient$/);
  await page.goto("/notifications");
  await expect(page.getByText("No notifications yet.")).toBeVisible();
  fail = true;
  await page.reload();
  await expect(page.getByText("We could not load your notifications.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("SCR-041 shows the created patient and issues a claim code once", async ({ page }) => {
  const calls = await services(page, doctorMe, (path, method) => {
    if (path === "/doctor/patients" && method === "POST") return { status: 201, json: { patient_id: patientId } };
    if (path === `/doctor/patients/${patientId}/claim-invites`) return { status: 201, json: { invite_token: "synthetic-claim-code", expires_at: "2026-11-05T00:00:00Z" } };
    return undefined;
  }, /\/app\/doctor$/);
  await page.setViewportSize({ width: 393, height: 1100 });
  await page.goto("/app/doctor/patients/new");
  await page.getByLabel("Full name *").fill("Synthetic New Patient");
  await page.getByLabel("Mobile number *").fill("+919000000999");
  await page.getByLabel("Date of birth *").fill("1990-04-04");
  await page.getByLabel("Sex *").fill("Female");
  await page.getByRole("button", { name: "Review patient details" }).click();
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(page.getByRole("heading", { name: "Patient created" })).toBeVisible();
  await expect(page.getByText("Synthetic New Patient")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/doctor\/patients\/new$/);
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", `/app/doctor/patients/${patientId}`);
  await page.getByRole("button", { name: "Send claim invitation" }).click();
  await expect(page.getByText("synthetic-claim-code")).toBeVisible();
  await expect(page.getByText("cannot be shown again", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send claim invitation" })).toHaveCount(0);
  expect(calls.filter((c) => c.path.endsWith("/claim-invites"))).toHaveLength(1);
});

test("Page 13a links from a ledger row and shows structured receipt fields only", async ({ page }) => {
  await services(page, patientMe, (path) => {
    if (path === "/patients/self/access-ledger") {
      return { json: { events: [{ id: eventId, timestamp: "2026-10-25T10:00:00Z", category: "CLINICAL", actor: { type: "DOCTOR", display_name: "Synthetic Alpha" }, action: "Viewed", purpose: "Consultation", resource_label: "Clinical record summary", consent_id: "c1" }], total: 1, counts: { all: 1, clinical: 1, admin: 0, ai: 0 }, next_cursor: null } };
    }
    if (path === `/patients/self/access-events/${eventId}`) {
      return { json: { id: eventId, timestamp: "2026-10-25T10:00:00Z", category: "CLINICAL", actor: { type: "DOCTOR", role_label: "Doctor", display_name: "Synthetic Alpha" }, action: "Viewed", resource_label: "Clinical record summary", purpose: "Consultation", legal_basis: "Your consent", consent: { id: "c1", purpose: "Migraine follow-up", scopes: ["Medication history"] } } };
    }
    return undefined;
  }, /\/app\/patient$/);
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/app/patient/privacy");
  await page.getByRole("link", { name: "View receipt →" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/patient/privacy/access/${eventId}$`));
  await expect(page.getByRole("heading", { name: "Access receipt" })).toBeVisible();
  await expect(page.getByText("Synthetic Alpha · Doctor")).toBeVisible();
  await expect(page.getByText("Your consent", { exact: true })).toBeVisible();
  await expect(page.getByText("Medication history")).toBeVisible();
});

test("Page 13a shows an error and a way back when the receipt is not found", async ({ page }) => {
  await services(page, patientMe, (path) => (path.startsWith("/patients/self/access-events/") ? { status: 404, json: { error: { code: "NOT_FOUND", message: "Access event not found" } } } : undefined), /\/app\/patient$/);
  await page.goto(`/app/patient/privacy/access/${eventId}`);
  await expect(page.getByText("This receipt could not be loaded.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to ledger" })).toBeVisible();
});

test("the You dock item opens account settings", async ({ page }) => {
  await services(page, patientMe, () => undefined, /\/app\/patient$/);
  await page.setViewportSize({ width: 393, height: 900 });
  await expect(page.getByRole("navigation").getByRole("link", { name: "You" })).toHaveAttribute("href", "/settings");
});

test("staff add patient creates an unclaimed patient for a practice doctor and reports duplicates", async ({ page }) => {
  let duplicate = false;
  const calls = await services(page, staffMe, (path, method) => {
    if (path === "/staff/doctors") return { json: [{ doctor_id: doctorId, name: "Dr. Synthetic", speciality: "Medicine" }] };
    if (path === "/staff/patients" && method === "POST") return duplicate ? { status: 409, json: { error: { code: "DUPLICATE_PATIENT", message: "A patient with this mobile number already exists" } } } : { status: 201, json: { patient_id: patientId, doctor_id: doctorId } };
    if (path === `/staff/patients/${patientId}/claim-invites`) return { status: 201, json: { invite_token: "staff-claim-code" } };
    return undefined;
  }, /\/app\/staff$/);
  await page.setViewportSize({ width: 393, height: 1100 });
  await page.goto(`/app/staff/patients/new?practice_id=${practiceId}`);
  await page.getByLabel("Full name").fill("Synthetic Walk-in");
  await page.getByLabel("Mobile number").fill("+919000000888");
  await page.getByLabel("Date of birth").fill("1985-05-05");
  await page.getByLabel("Sex").selectOption("Female");
  await page.getByLabel("Doctor", { exact: true }).selectOption(doctorId);
  duplicate = true;
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(page.getByText("A patient with this mobile number already exists.")).toBeVisible();
  duplicate = false;
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Walk-in" })).toBeVisible();
  const create = calls.filter((c) => c.path === "/staff/patients" && c.method === "POST").at(-1)!;
  expect(create.body).toMatchObject({ doctor_id: doctorId, full_name: "Synthetic Walk-in" });
  await page.getByRole("button", { name: "Send claim invitation" }).click();
  await expect(page.getByText("staff-claim-code")).toBeVisible();
  await expect(page.getByRole("link", { name: "Book appointment" })).toBeVisible();
});

test("the staff Patients tab links to Add patient", async ({ page }) => {
  await services(page, staffMe, (path) => (path === "/staff/patients" ? { json: [] } : undefined), /\/app\/staff$/);
  await page.goto("/app/staff/schedule?tab=patients");
  await expect(page.getByRole("link", { name: "Add patient" })).toHaveAttribute("href", `/app/staff/patients/new?practice_id=${practiceId}`);
});
