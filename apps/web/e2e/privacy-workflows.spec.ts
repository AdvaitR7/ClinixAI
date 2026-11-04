import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const alpha = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const beta = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const consentId = "5d1c8a0e-6a5e-4a58-9a52-0f0b0d0c0e01";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};

/** Synthetic privacy service state shared by the patient, doctor and staff browsers. */
function privacyState() {
  return {
    circle: [
      { doctor_id: alpha, doctor_name: "Synthetic Alpha", speciality: "Neurology", relationship_type: "PRIMARY_PHYSICIAN", preferred: true },
    ] as Record<string, unknown>[],
    consents: [
      { id: consentId, doctor_id: alpha, doctor_name: "Synthetic Alpha", speciality: "Neurology", purpose: "Migraine follow-up", status: "ACTIVE", starts_at: "2026-10-20T00:00:00Z", expires_at: "2099-10-27T00:00:00Z", revoked_at: null, scopes: [{ resource_type: "MEDICATION" }] },
    ] as Record<string, unknown>[],
    directory: [
      { doctor_id: alpha, name: "Synthetic Alpha", speciality: "Neurology", verification_status: "VERIFIED" },
      { doctor_id: beta, name: "Synthetic Beta", speciality: "Medicine", verification_status: "VERIFIED" },
    ],
    ledgerPages: [
      [
        { id: "e1", timestamp: "2026-10-25T10:00:00Z", category: "CLINICAL", actor: { type: "DOCTOR", display_name: "Synthetic Alpha" }, action: "Viewed", purpose: "Consultation", resource_label: "Clinical record summary", consent_id: consentId },
        { id: "e2", timestamp: "2026-10-25T09:00:00Z", category: "AI", actor: { type: "AI_SERVICE", display_name: "ClinixAI" }, action: "Analysed by AI", purpose: "CONSENSUS_ANALYSIS", resource_label: "AI check-in result", consent_id: null },
      ],
      [{ id: "e3", timestamp: "2026-10-20T09:00:00Z", category: "ADMIN", actor: { type: "CLINIC_STAFF", display_name: "Desk" }, action: "Viewed", purpose: null, resource_label: "Document", consent_id: null }],
    ],
    removals: [] as Record<string, unknown>[],
    doctorRequests: [
      { id: "req-1", patient_id: patientId, patient_name: "Synthetic Patient", target_doctor_id: alpha, target_doctor_name: "Synthetic Alpha", resource_type: "DOCUMENT", resource_id: null, reason: "Old image", status: "OPEN", requested_at: "2026-10-25T10:00:00Z", routed_at: null, routing_note: null, resolved_at: null, resolution_note: null, decisions: [] },
    ] as Record<string, unknown>[],
    calls: [] as { method: string; path: string; search: string; body: Record<string, unknown> }[],
    failRevoke: false,
  };
}
type State = ReturnType<typeof privacyState>;

/** Runs the real pages, guards and SDK against controlled HTTP; no real accounts or clinical data. */
async function privacyServices(page: Page, role: "PATIENT" | "DOCTOR" | "CLINIC_STAFF", state = privacyState()) {
  const userId = role === "PATIENT" ? patientId : alpha;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: `synthetic-${role.toLowerCase()}@example.test`, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = request.postData() ? request.postDataJSON() : {};
    if (method !== "GET") state.calls.push({ method, path, search: url.search, body });
    else state.calls.push({ method, path, search: url.search, body: {} });
    let status = 200;
    let json: unknown = {};
    if (path === "/me") json = { profile_id: userId, role, patient_id: role === "PATIENT" ? patientId : null, doctor_id: role === "DOCTOR" ? alpha : null, verification_status: "VERIFIED" };
    else if (path === "/patients/self/dashboard") json = { upcoming_appointment: null, pending_followups: [], recent_timeline: [] };
    else if (path === "/doctor/dashboard") json = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path === "/patients/self/doctors" && method === "GET") json = state.circle;
    else if (/^\/patients\/self\/doctors\/[^/]+\/relationships$/.test(path)) {
      const id = path.split("/")[4];
      if (method === "DELETE") state.circle = state.circle.filter((r) => r.doctor_id !== id);
      else state.circle.push({ doctor_id: id, doctor_name: "Synthetic Beta", speciality: "Medicine", relationship_type: "OTHER", preferred: false });
      json = { ok: true };
    } else if (path === "/doctors") {
      const q = url.searchParams.get("q")?.toLowerCase();
      json = state.directory.filter((d) => !q || `${d.name} ${d.speciality}`.toLowerCase().includes(q));
    } else if (path === "/patients/self/consents" && method === "GET") json = state.consents;
    else if (path === "/patients/self/consents/preview") json = { suggested_scopes: [
      { resource_type: "ENCOUNTER", label: "This consultation packet", recommended: false, available: true, unavailable_reason: null },
      { resource_type: "DOCUMENT", label: "Lab reports and documents", recommended: true, available: true, unavailable_reason: null },
      { resource_type: "MEDICATION", label: "Medication history", recommended: true, available: true, unavailable_reason: null },
      { resource_type: "ALLERGY", label: "Known allergies", recommended: false, available: false, unavailable_reason: "No allergy record exists in CliniX yet." },
    ] };
    else if (path === "/patients/self/consents" && method === "POST") {
      const created = { id: "new-consent", doctor_id: body.doctor_id, doctor_name: "Synthetic Alpha", speciality: "Neurology", purpose: body.purpose, status: "ACTIVE", starts_at: new Date().toISOString(), expires_at: null, revoked_at: null, scopes: body.scopes };
      state.consents.push(created);
      status = 201;
      json = created;
    } else if (path.endsWith("/revoke")) {
      if (state.failRevoke) { status = 500; json = { error: { code: "INTERNAL_ERROR", message: "Revoke failed", request_id: "r" } }; }
      else { state.consents = state.consents.map((c) => (c.id === consentId ? { ...c, status: "REVOKED", revoked_at: "2026-10-26T00:00:00Z" } : c)); json = { ok: true }; }
    } else if (path === "/patients/self/access-ledger") {
      const cursor = url.searchParams.get("cursor");
      const category = url.searchParams.get("category");
      const all = state.ledgerPages.flat();
      const events = category ? all.filter((e) => e.category === category) : cursor ? state.ledgerPages[1] : state.ledgerPages[0];
      json = { events, total: 3, counts: { all: 3, clinical: 1, admin: 1, ai: 1 }, next_cursor: !category && !cursor ? "2026-10-25T09:00:00.000Z" : null };
    } else if (path === "/patients/self/record-removal-requests" && method === "GET") json = state.removals;
    else if (path === "/patients/self/record-removal-requests" && method === "POST") {
      const created = { id: "rr-1", patient_id: patientId, patient_name: null, target_doctor_id: body.target_actor_id, target_doctor_name: "Synthetic Alpha", resource_type: body.resource_type, resource_id: null, reason: body.reason ?? null, status: "OPEN", requested_at: "2026-10-26T00:00:00Z", routed_at: null, routing_note: null, resolved_at: null, resolution_note: null, decisions: [] };
      state.removals.push(created);
      status = 201;
      json = created;
    } else if (path === "/doctor/record-removal-requests" && method === "GET") json = state.doctorRequests;
    else if (path.endsWith("/resolve")) {
      state.doctorRequests = state.doctorRequests.map((r) => ({ ...r, status: body.outcome, resolved_at: "2026-10-26T00:00:00Z", resolution_note: body.reason ?? null }));
      json = state.doctorRequests[0];
    }
    await route.fulfill({ status, headers: cors, json }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(role === "PATIENT" ? /\/app\/patient$/ : role === "DOCTOR" ? /\/app\/doctor$/ : /\/app\/staff$/);
  return state;
}
const posts = (state: State, path: string) => state.calls.filter((c) => c.method !== "GET" && c.path === path);

test("SCR-018 care circle shows sharing state, never shares by itself, and removes only the relationship", async ({ page }) => {
  const state = await privacyServices(page, "PATIENT");
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/app/patient/care");
  await expect(page.getByRole("heading", { name: "Dr. Synthetic Alpha" })).toBeVisible();
  await expect(page.getByText(/Medication history · Expires/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Message unavailable" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Share records" })).toHaveAttribute("href", `/app/patient/care/share/by-id?doctorId=${alpha}`);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Care" })).toHaveAttribute("href", "/app/patient/care");
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-018-393.png", fullPage: true });
  const remove = page.getByRole("button", { name: "Remove", exact: true });
  await remove.click();
  await expect(page.getByRole("dialog")).toContainText("Active sharing permissions are not changed");
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await remove.click();
  await page.getByRole("button", { name: "Remove from care circle" }).click();
  await expect(page.getByText(/No doctors in your care circle yet/)).toBeVisible();
  expect(state.calls.some((c) => c.method === "DELETE" && c.path === `/patients/self/doctors/${alpha}/relationships`)).toBe(true);
  expect(posts(state, "/patients/self/consents")).toHaveLength(0);
});

test("SCR-019 discover searches verified doctors and adding one grants no consent", async ({ page }) => {
  const state = await privacyServices(page, "PATIENT");
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/app/patient/care");
  await page.getByRole("tab", { name: "Discover verified doctors" }).click();
  await expect(page.getByRole("heading", { name: "Dr. Synthetic Beta" })).toBeVisible();
  await expect(page.getByText("Record access still requires your explicit consent.")).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-019-393.png", fullPage: true });
  await page.getByPlaceholder("Search name or speciality").fill("medicine");
  await expect(page.getByRole("heading", { name: "Dr. Synthetic Alpha" })).toHaveCount(0);
  expect(state.calls.some((c) => c.path === "/doctors" && c.search.includes("verified_only=true") && c.search.includes("q=medicine"))).toBe(true);
  await page.getByRole("button", { name: "Add to Care Circle" }).click();
  await expect(page.getByRole("tab", { name: /My Doctors · 2/ })).toBeVisible();
  expect(posts(state, `/patients/self/doctors/${beta}/relationships`)).toHaveLength(1);
  expect(posts(state, "/patients/self/consents")).toHaveLength(0);
});

test("SCR-020 scope picker needs a purpose, disables unavailable groups, and creates consent only after review", async ({ page }) => {
  const state = await privacyServices(page, "PATIENT");
  await page.setViewportSize({ width: 393, height: 1400 });
  await page.goto(`/app/patient/care/share/by-id?doctorId=${alpha}`);
  await expect(page.getByRole("checkbox", { name: /Known allergies/ })).toBeDisabled();
  await expect(page.getByText("No allergy record exists in CliniX yet.")).toBeVisible();
  const review = page.getByRole("button", { name: "REVIEW & CONFIRM SHARE" });
  await expect(review).toBeDisabled();
  await page.getByLabel("Purpose").fill("Migraine follow-up consultation");
  await page.getByRole("button", { name: "30 DAYS" }).click();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-020-393.png", fullPage: true });
  expect(posts(state, "/patients/self/consents")).toHaveLength(0);
  await review.click();
  const dialog = page.getByRole("dialog", { name: "Confirm sharing" });
  await expect(dialog).toContainText("Lab reports and documents · Medication history");
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
  await review.click();
  await dialog.getByRole("button", { name: "Confirm and share" }).click();
  await expect(page).toHaveURL(/\/app\/patient\/privacy\?shared=1/);
  expect(posts(state, "/patients/self/consents")[0].body).toEqual({
    doctor_id: alpha,
    purpose: "Migraine follow-up consultation",
    expiry: "30_DAYS",
    scopes: [{ resource_type: "DOCUMENT" }, { resource_type: "MEDICATION" }],
  });
});

test("SCR-020 returns to booking with the new consent id", async ({ page }) => {
  await privacyServices(page, "PATIENT");
  await page.goto(`/app/patient/care/share/by-id?from=book&encounterId=${beta}&doctorId=${alpha}`);
  await page.getByLabel("Purpose").fill("Visit review");
  await page.getByRole("button", { name: "REVIEW & CONFIRM SHARE" }).click();
  await page.getByRole("button", { name: "Confirm and share" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/patient/book\\?doctorId=${alpha}&consentId=new-consent`));
});

test("SCR-021 revoke confirms, failure keeps access, ledger filters and pages, removal requests send nothing destructive", async ({ page }) => {
  const state = await privacyServices(page, "PATIENT");
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/app/patient/privacy");
  await expect(page.getByText("1 active sharing permission", { exact: true })).toBeVisible();
  await expect(page.getByText("IMMUTABLE · READ ONLY · APPEND-ONLY")).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-021-393.png", fullPage: true });

  await page.getByRole("button", { name: "AI audit · 1" }).click();
  await expect(page.getByText("AI inference audit")).toBeVisible();
  expect(state.calls.some((c) => c.path === "/patients/self/access-ledger" && c.search.includes("category=AI"))).toBe(true);
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("button", { name: "Load older events" }).click();
  await expect(page.getByText("Desk")).toBeVisible();

  state.failRevoke = true;
  const revoke = page.getByRole("button", { name: "Revoke", exact: true });
  await revoke.click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Revoke failed");
  state.failRevoke = false;
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("0 active sharing permissions")).toBeVisible();
  await expect(page.getByText(/Expired and revoked/)).toBeVisible();

  await page.getByRole("button", { name: "Request record removal" }).click();
  await page.getByLabel("Doctor", { exact: true }).selectOption(alpha);
  await page.getByLabel("Reason (optional)").fill("Synthetic reason");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Your reason: Synthetic reason")).toBeVisible();
  expect(posts(state, "/patients/self/record-removal-requests")[0].body).toMatchObject({ target_actor_id: alpha, resource_type: "DOCUMENT" });
});

test("SCR-049/050 doctor decides with a required reason and an explicit confirmation", async ({ page }) => {
  const state = await privacyServices(page, "DOCTOR");
  await page.setViewportSize({ width: 393, height: 1400 });
  await page.goto("/app/doctor/requests");
  await expect(page.getByText("1 open request")).toBeVisible();
  const review = page.getByRole("button", { name: "REVIEW & CONFIRM DECISION" });
  await expect(review).toBeDisabled();
  await page.getByRole("radio", { name: /RETAIN REQUIRED RECORD/ }).click();
  await expect(review).toBeDisabled();
  await page.getByLabel(/Written reason/).fill("Retained as part of the clinical record.");
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-049-393.png", fullPage: true });
  await review.click();
  const dialog = page.getByRole("dialog", { name: "Confirm retention?" });
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-050-393.png", fullPage: true });
  expect(posts(state, "/doctor/record-removal-requests/req-1/resolve")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
  await review.click();
  await dialog.getByRole("button", { name: "CONFIRM DECISION" }).click();
  await expect(page.getByText("0 open requests")).toBeVisible();
  expect(posts(state, "/doctor/record-removal-requests/req-1/resolve")[0].body).toEqual({ outcome: "DENIED", reason: "Retained as part of the clinical record." });
});

test("SCR-050 partial approval records per-record outcomes", async ({ page }) => {
  const state = await privacyServices(page, "DOCTOR");
  await page.goto("/app/doctor/requests");
  await page.getByRole("radio", { name: /PARTIAL APPROVAL/ }).click();
  await page.getByLabel(/Written reason/).fill("Professional record retained.");
  await page.getByRole("button", { name: "REVIEW & CONFIRM DECISION" }).click();
  await page.getByRole("button", { name: "CONFIRM DECISION", exact: true }).click();
  await expect(page.getByText("0 open requests")).toBeVisible();
  expect(posts(state, "/doctor/record-removal-requests/req-1/resolve")[0].body).toMatchObject({
    outcome: "PARTIALLY_APPROVED",
    decisions: [expect.objectContaining({ decision: "REMOVE" }), expect.objectContaining({ decision: "RETAIN" })],
  });
});

test("SCR-051 staff see that decisions and routing are unavailable without practice membership", async ({ page }) => {
  await privacyServices(page, "CLINIC_STAFF");
  await page.setViewportSize({ width: 393, height: 900 });
  await page.goto("/app/staff/requests");
  await expect(page.getByRole("heading", { name: "Decision controls unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: /APPROVE|RETAIN|ROUTE/i })).toHaveCount(0);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-051-393.png", fullPage: true });
});

for (const width of [320, 768, 1440])
  test(`privacy screens fit ${width}px`, async ({ page }) => {
    await privacyServices(page, "PATIENT");
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/app/patient/care", `/app/patient/care/share/by-id?doctorId=${alpha}`, "/app/patient/privacy"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
