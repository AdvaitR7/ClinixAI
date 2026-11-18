import { expect, test, type Page } from "@playwright/test";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS" };
const doctorId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";

/** Uses synthetic HTTP boundaries to run the real SDK, route guards, pages and dialogs. */
async function clinicalServices(page: Page, role: "DOCTOR" | "PATIENT" = "DOCTOR") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: doctorId, aud: "authenticated", role: "authenticated", email: "synthetic-clinician@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: doctorId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "synthetic-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  const state = {
    items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet", route: "Oral", frequency: "Once daily" }],
    note: { assessment: "Synthetic initial assessment" } as Record<string, string>,
    final: false,
    failSave: false,
    staleDraft: false,
    completions: 0,
    amended: [] as Record<string, unknown>[],
    events: [] as string[],
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session });
  });
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const draft = { id: "synthetic-draft", patient_id: patientId, encounter_id: "synthetic-encounter", doctor_id: doctorId, patient_name: "Synthetic Patient", source: "DIRECT_ENTRY", status: "DRAFT", source_document_id: null, items: state.items };
    let body: unknown = {};
    let status = 200;
    if (path === "/me") body = { profile_id: doctorId, role, patient_id: role === "PATIENT" ? patientId : null, doctor_id: role === "DOCTOR" ? doctorId : null, verification_status: "VERIFIED" };
    else if (path === "/patients/self/dashboard") body = { upcoming_appointment: null, pending_followups: [], recent_timeline: [] };
    else if (path === "/patients/self/timeline") body = { entries: [] };
    else if (path === "/patients/self/medications") body = { medications: [] };
    else if (["/patients/self/appointments", "/patients/self/documents", "/patients/self/lab-reports", "/doctors"].includes(path)) body = [];
    else if (path === "/doctor/dashboard") body = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path.endsWith("/finalize")) {
      const reviewed = request.postDataJSON().reviewed_items;
      state.events.push("finalize");
      if (state.staleDraft || JSON.stringify(reviewed) !== JSON.stringify(state.items)) {
        status = 409;
        body = { error: { code: "DRAFT_CHANGED", message: "Synthetic draft changed after review" } };
      } else body = { id: "synthetic-prescription" };
    } else if (path === "/doctor/prescription-drafts/synthetic-draft") {
      if (method === "PATCH") {
        state.events.push("save-draft");
        state.items = request.postDataJSON().items;
        body = { ok: true };
      } else body = draft;
    } else if (path === "/doctor/prescriptions/synthetic-prescription") {
      const version = { version_number: 1, finalized_by: "Synthetic Clinician", finalized_at: "2026-10-25T09:00:00Z", amendment_reason: null, items: state.items };
      body = { id: "synthetic-prescription", patient_id: patientId, doctor_id: doctorId, status: "ACTIVE", created_at: "2026-10-25T09:00:00Z", current_version: version, versions: [version] };
    } else if (path.endsWith("/consultation")) body = { encounter_id: "synthetic-encounter", appointment: { id: "synthetic-appointment", patient_id: patientId, patient_name: "Synthetic Patient", scheduled_start: "2026-10-25T09:00:00Z", reason: "Synthetic review", appointment_type: "IN_PERSON", payment_status: "UNPAID", status: state.final ? "COMPLETED" : "CONFIRMED" }, note: state.note, note_is_final: state.final, note_amendments: state.amended, current_medications: [] };
    else if (path.endsWith("/note") && method === "PUT") {
      state.events.push("save-note");
      if (state.failSave) { status = 503; body = { error: { code: "UNAVAILABLE", message: "Synthetic note save failed" } }; }
      else { state.note = request.postDataJSON(); body = { ok: true }; }
    } else if (path.endsWith("/complete")) {
      expect(request.postDataJSON().reviewed_note).toEqual(state.note);
      state.events.push("complete");
      state.completions += 1;
      state.final = true;
      body = { ok: true };
    } else if (path.endsWith("/note/amend")) {
      const { reason, ...sections } = request.postDataJSON();
      state.amended.unshift({ id: "synthetic-amendment", doctor_id: doctorId, created_at: "2026-10-25T10:00:00Z", reason, sections });
      body = { ok: true };
    }
    await route.fulfill({ status, headers: cors, json: body });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(role === "DOCTOR" ? /\/app\/doctor$/ : /\/app\/patient$/);
  return state;
}

test("GAP-011 restores the existing Timeline destination from Vault, medications, Visits and booking", async ({ page }) => {
  await clinicalServices(page, "PATIENT");
  for (const source of ["vault", "medications", "appointments", "book"]) {
    await page.goto(`/app/patient/${source}`);
    const timeline = page.getByRole("navigation").getByRole("link", { name: "Timeline", exact: true });
    await expect(timeline).toHaveAttribute("href", "/app/patient/timeline");
    await timeline.click();
    await expect(page).toHaveURL(/\/app\/patient\/timeline$/);
    await expect(page.getByText("0 entries · All recorded history", { exact: true })).toBeVisible();
  }
});

test("SCR-033/035/058 saves current edits, supports Escape, and navigates to the final record", async ({ page }) => {
  const state = await clinicalServices(page);
  await page.setViewportSize({ width: 393, height: 1260 });
  await page.goto("/app/doctor/prescription-drafts/by-id?draftId=synthetic-draft");
  await page.getByLabel("Dose (e.g. 1 tab)").fill("2 tablets");
  await page.getByRole("button", { name: "Finalize prescription", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Finalize prescription?" });
  await expect(review).toBeVisible();
  await expect(review).toContainText("2 tablets");
  await page.screenshot({ path: "test-results/screens/implementation-scr-035-393.png" });
  await page.keyboard.press("Escape");
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize prescription", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Finalize prescription", exact: true }).click();
  await review.getByLabel("Allergies and current medicines reviewed with the patient").check();
  await review.getByLabel("Printable preview checked").check();
  await review.getByRole("button", { name: "Finalize prescription", exact: true }).click();
  await expect(page).toHaveURL(/\/prescriptions\/by-id\?prescriptionId=synthetic-prescription$/);
  await expect(page.getByText("Synthetic medicine", { exact: true })).toBeVisible();
  expect(state.events).toEqual(["save-draft", "save-draft", "finalize"]);
});

test("SCR-035 stale review keeps the draft open with an actionable failure", async ({ page }) => {
  const state = await clinicalServices(page);
  await page.goto("/app/doctor/prescription-drafts/by-id?draftId=synthetic-draft");
  await page.getByRole("button", { name: "Finalize prescription", exact: true }).click();
  state.staleDraft = true;
  await page.getByRole("dialog").getByLabel("Allergies and current medicines reviewed with the patient").check();
  await page.getByRole("dialog").getByLabel("Printable preview checked").check();
  await page.getByRole("dialog").getByRole("button", { name: "Finalize prescription", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic draft changed after review" })).toBeVisible();
  await expect(page).toHaveURL(/\/prescription-drafts\/by-id\?draftId=synthetic-draft$/);
  await expect(page.getByLabel("Dose (e.g. 1 tab)")).toHaveValue("1 tablet");
});

test("SCR-030/031 completion retains failed saves, retries, then exposes a dated amendment", async ({ page }) => {
  const state = await clinicalServices(page);
  await page.setViewportSize({ width: 393, height: 1180 });
  await page.goto("/app/doctor/consultation/by-id?appointmentId=synthetic-appointment");
  await page.getByLabel("Assessment", { exact: true }).fill("Synthetic reviewed assessment");
  await page.getByRole("button", { name: "Complete consultation", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Complete consultation?" });
  await expect(review).toContainText("Synthetic reviewed assessment");
  await page.screenshot({ path: "test-results/screens/implementation-scr-031-393.png" });
  state.failSave = true;
  await review.getByRole("button", { name: "Complete consultation", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Synthetic note save failed");
  expect(state.completions).toBe(0);
  state.failSave = false;
  await review.getByRole("button", { name: "Complete consultation", exact: true }).click();
  await expect(page.getByText("Note is finalized (immutable)")).toBeVisible();
  expect(state.events.slice(-2)).toEqual(["save-note", "complete"]);
  await page.getByRole("button", { name: "Amend note", exact: true }).click();
  await page.getByLabel("Assessment", { exact: true }).fill("Synthetic amended assessment");
  await page.getByLabel("Reason for amendment *").fill("Synthetic correction");
  await page.getByRole("button", { name: "Save amendment" }).click();
  await expect(page.getByText("Synthetic amended assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic reviewed assessment", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Synthetic amended assessment", { exact: true })).toBeVisible();
});

for (const width of [320, 768, 1440]) {
  test(`SCR-031 review contains keyboard focus and fits ${width}px`, async ({ page }) => {
    await clinicalServices(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/doctor/consultation/by-id?appointmentId=synthetic-appointment");
    await page.getByRole("button", { name: "Complete consultation", exact: true }).click();
    const review = page.getByRole("dialog");
    await expect(review).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await review.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    expect(await review.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await review.getByRole("button", { name: "Close", exact: true }).click();
    await expect(review).not.toBeVisible();
  });
}
