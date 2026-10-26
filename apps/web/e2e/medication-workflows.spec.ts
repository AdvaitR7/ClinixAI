import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const rxId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const encounterId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };

/** Supplies explicit synthetic exposure statuses and two immutable prescription versions. */
function medicationState() {
  const base = { entry_id: "exposure:one", source_kind: "RECORDED_EXPOSURE", medicine_name: "Synthetic medicine A", strength: "10 mg", dose: "1 tablet", frequency: "Once daily", route: "Oral", duration: "8 weeks", timing: null, instructions: null, status: "CURRENT", prescribing_doctor: "Synthetic Author", prescribed_date: "2026-09-10T00:00:00Z", encounter_id: encounterId, prescription_id: rxId, prescription_version_number: 1, started_on: "2026-09-10", ended_on: null, reason_for_use: "Synthetic recorded indication", response: null, adverse_reaction: null, reason_stopped: null, recorded_at: "2026-09-10T00:00:00Z" };
  const item = { medicine_name: "Synthetic medicine A", medicine_code: null, strength: "10 mg", dose: "Original 1 tablet", frequency: "Once daily", route: "Oral", timing: "After food", duration: "8 weeks", instructions: "Synthetic original instruction" };
  const version = { version_number: 1, finalized_by: "Synthetic Author", finalized_at: "2026-09-10T00:00:00Z", amendment_reason: null as string | null, items: [item] };
  return {
    medications: [base, { ...base, entry_id: "exposure:two", medicine_name: "Synthetic medicine B", status: "PAST", adverse_reaction: "Recorded nausea", response: "Recorded improvement", ended_on: "2026-09-12" }, { ...base, entry_id: "exposure:three", medicine_name: "Synthetic medicine C", status: "DISCONTINUED", reason_stopped: "Recorded reason stopped", adverse_reaction: "Recorded irritation" }, { ...base, entry_id: "prescription:four", source_kind: "PRESCRIPTION", medicine_name: "Synthetic medicine D", status: "UNKNOWN_STATUS", reason_for_use: null, started_on: null, duration: "5 days", prescribing_doctor: "Synthetic Author" }],
    prescription: { id: rxId, patient_id: patientId, doctor_id: "doctor-own", status: "ACTIVE", created_at: version.finalized_at, current_version: { ...version, version_number: 2, amendment_reason: "Synthetic amendment", items: [{ ...item, dose: "Amended 2 tablets" }] }, versions: [version, { ...version, version_number: 2, amendment_reason: "Synthetic amendment", items: [{ ...item, dose: "Amended 2 tablets" }] }] },
    failMedications: false, failPrescription: false, failEncounter: false, absentEncounter: false, delayPrescription: false,
    calls: [] as string[], writes: [] as string[],
  };
}

/** Uses actual Next/SDK/guards and controlled HTTP services; no real account or clinical data is touched. */
async function services(page: Page, state = medicationState(), role: "PATIENT" | "DOCTOR" = "PATIENT") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: patientId, aud: "authenticated", role: "authenticated", email: "synthetic-medication@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: patientId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    state.calls.push(path);
    if (request.method() !== "GET") state.writes.push(path);
    let status = 200;
    let body: unknown = {};
    if (path === "/me") body = { profile_id: patientId, role, patient_id: role === "PATIENT" ? patientId : null, doctor_id: role === "DOCTOR" ? patientId : null };
    else if (path === "/patients/self/dashboard") body = { upcoming_appointment: null, pending_followups: [], recent_timeline: [] };
    else if (path === "/doctor/dashboard") body = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path === "/patients/self/medications") {
      if (state.failMedications) { status = 503; body = { error: { message: "Synthetic registry unavailable" } }; }
      else body = { medications: state.medications };
    } else if (path.startsWith("/patients/self/prescriptions/")) {
      if (state.delayPrescription) await new Promise((resolve) => setTimeout(resolve, 600));
      if (state.failPrescription || !path.endsWith(rxId)) { status = 404; body = { error: { message: "Synthetic prescription unavailable" } }; }
      else body = state.prescription;
    } else if (path === "/patients/self/timeline") {
      if (state.failEncounter) { status = 503; body = { error: { message: "Synthetic encounter unavailable" } }; }
      else body = { entries: [{ id: "unrelated", type: "ENCOUNTER", title: "Unrelated synthetic encounter", summary: "Unrelated private fixture", timestamp: "2026-09-10T00:00:00Z", date_formatted: "10 SEP", chapter: "SEPTEMBER 2026", provenance: "DOCTOR_AUTHORED", is_ai_derived: false, metadata: { encounter_id: "different-id" } }, ...state.absentEncounter ? [] : [{ id: `enc-${encounterId}`, type: "ENCOUNTER", title: "Selected synthetic encounter", summary: "Selected recorded concern", timestamp: "2026-09-10T00:00:00Z", date_formatted: "10 SEP", chapter: "SEPTEMBER 2026", provenance: "DOCTOR_AUTHORED", is_ai_derived: false, metadata: { encounter_id: encounterId, status: "COMPLETED" } }]] };
    } else if (["/patients/self/documents", "/patients/self/lab-reports", "/patients/self/appointments"].includes(path)) body = [];
    await route.fulfill({ status, headers: cors, json: body }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(role === "PATIENT" ? /\/app\/patient$/ : /\/app\/doctor$/);
  return state;
}

/** Opens an exact synthetic medication, independent of its position or status group. */
async function openRecord(page: Page, medicine = "A") {
  await page.getByRole("button", { name: `Open record for Synthetic medicine ${medicine}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("SCR-015/016 render source groups, fields, truthful status/reaction provenance and exact prescription version", async ({ page }) => {
  const state = await services(page);
  await page.setViewportSize({ width: 393, height: 1280 });
  await page.goto("/app/patient/medications");
  await expect(page.getByText("4 medication records", { exact: true })).toBeVisible();
  await expect(page.getByText("1 ACTIVE", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-015-393.png", fullPage: true });
  await openRecord(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Synthetic recorded indication", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reaction history not recorded", { exact: true })).toBeVisible();
  await expect(dialog.getByText("PATIENT-ASSERTED", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-016-393.png" });
  await dialog.getByRole("button", { name: "Original prescription", exact: false }).first().click();
  await expect(dialog.getByRole("heading", { name: "Prescription record", exact: true })).toBeFocused();
  await expect(dialog.getByText("Original 1 tablet", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Amended 2 tablets", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Prescription version", { exact: true }).selectOption("2");
  await expect(dialog.getByText("Amended 2 tablets", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Synthetic amendment", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Back to medication record", exact: true }).click();
  await dialog.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(dialog.getByText("Original 1 tablet", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("all/active/completed/discontinued/unknown filters work and closing detail preserves the selected filter and focus", async ({ page }) => {
  await services(page);
  await page.goto("/app/patient/medications");
  for (const [label, name] of [["Active", "A"], ["Completed", "B"], ["Discontinued", "C"], ["Status unknown", "D"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: /^Open record for/ })).toHaveCount(1);
    await openRecord(page, name);
    if (name === "C") await expect(page.getByRole("dialog").getByText("Reason stopped: Recorded reason stopped", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: `Open record for Synthetic medicine ${name}`, exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open record for/ })).toHaveCount(4);
  await openRecord(page);
  await page.getByRole("button", { name: "Back to medication record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("encounter chapter selects only the originating owned encounter and connects to full Timeline", async ({ page }) => {
  const state = await services(page);
  await page.goto("/app/patient/medications");
  await openRecord(page);
  await page.getByRole("button", { name: /Encounter chapter Selected/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Selected synthetic encounter", exact: true })).toBeVisible();
  await expect(dialog.getByText("Unrelated private fixture", { exact: true })).toHaveCount(0);
  await dialog.getByRole("link", { name: "Open full Timeline", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/timeline$/);
  await expect(page.getByRole("heading", { name: "Health timeline", exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("registry and source failures retry without unrelated or stale prescription/encounter content", async ({ page }) => {
  const state = await services(page); state.failMedications = true;
  await page.goto("/app/patient/medications");
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic registry unavailable" })).toBeVisible();
  state.failMedications = false;
  await page.getByRole("button", { name: "Retry medications", exact: true }).click();
  await openRecord(page); state.failPrescription = true;
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic prescription unavailable" })).toBeVisible();
  state.failPrescription = false;
  await page.getByRole("button", { name: "Retry prescription", exact: true }).click();
  await expect(page.getByText("Original 1 tablet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to medication record", exact: true }).click();
  state.failEncounter = true;
  await page.getByRole("button", { name: /Encounter chapter Selected/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic encounter unavailable" })).toBeVisible();
  state.failEncounter = false; state.absentEncounter = true;
  await page.getByRole("button", { name: "Retry encounter", exact: true }).click();
  await expect(page.getByText("This encounter is unavailable in your Timeline.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Unrelated private fixture", { exact: true })).toHaveCount(0);
  state.absentEncounter = false;
  await page.getByRole("button", { name: "Retry encounter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Selected synthetic encounter", exact: true })).toBeVisible();
});

test("missing links and unknown original versions stay explicit; newer versions never replace a missing linked original", async ({ page }) => {
  const state = await services(page);
  Object.assign(state.medications[0], { prescription_id: null, encounter_id: null, prescribing_doctor: null, prescribed_date: null });
  await page.goto("/app/patient/medications");
  await openRecord(page);
  await expect(page.getByRole("button", { name: /^Original prescription/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Encounter chapter/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  Object.assign(state.medications[0], { prescription_id: rxId, prescription_version_number: null });
  await page.reload(); await openRecord(page);
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(page.getByText("The original version was not recorded for this exposure. Showing the current prescription version.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  state.medications[0].prescription_version_number = 99;
  await page.reload(); await openRecord(page);
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(page.getByText("The linked original version is unavailable. A newer prescription has not been substituted.", { exact: true })).toBeVisible();
  await expect(page.getByText("Amended 2 tablets", { exact: true })).toHaveCount(0);
});

test("closing a pending source and opening a different denied source cannot leak the previous prescription", async ({ page }) => {
  const state = await services(page); state.delayPrescription = true;
  state.medications[1].prescription_id = "foreign-synthetic";
  await page.goto("/app/patient/medications"); await openRecord(page);
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await page.keyboard.press("Escape");
  await openRecord(page, "B");
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic prescription unavailable" })).toBeVisible();
  await expect(page.getByText("Original 1 tablet", { exact: true })).toHaveCount(0);
});

test("empty registry/filter states and existing Reports/Home/Visits connections remain usable", async ({ page }) => {
  const state = await services(page); state.medications = [];
  await page.goto("/app/patient/medications");
  await expect(page.getByText("No medications recorded.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discontinued", exact: true }).click();
  await expect(page.getByText("No medications recorded.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to reports", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/vault$/);
  state.medications = [{ ...medicationState().medications[0] }];
  await page.goto("/app/patient/medications");
  await page.getByRole("button", { name: "Discontinued", exact: true }).click();
  await expect(page.getByText("No medications match this filter.", { exact: true })).toBeVisible();
  for (const [label, path] of [["Home", ""], ["Visits", "/appointments"], ["Reports", "/vault"]]) {
    await page.goto("/app/patient/medications");
    await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/patient${path}$`));
  }
});

test("doctor accounts cannot enter the patient registry or fetch its source data", async ({ page }) => {
  const state = await services(page, medicationState(), "DOCTOR");
  await page.goto("/app/patient/medications");
  await expect(page).toHaveURL(/\/app\/doctor$/);
  expect(state.calls.some((path) => path.startsWith("/patients/self/medications"))).toBe(false);
});

for (const width of [320, 768, 1440]) test(`medication cards/detail/source fit ${width}px with contained focus and Escape return`, async ({ page }) => {
  await services(page); await page.setViewportSize({ width, height: 900 });
  await page.goto("/app/patient/medications");
  await expect(page.getByText("4 medication records", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openRecord(page);
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(width);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  await page.getByRole("button", { name: "OPEN ORIGINAL PRESCRIPTION", exact: true }).click();
  await expect(page.getByText("Original 1 tablet", { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open record for Synthetic medicine A", exact: true })).toBeFocused();
});
