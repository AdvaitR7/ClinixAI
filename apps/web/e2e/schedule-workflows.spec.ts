import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const doctorId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const date = "2099-10-26";
const root = `/app/doctor/schedule?date=${date}`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" };

/** Keeps synthetic HTTP persistence separate from the rendered Next application. */
function scheduleState() {
  return {
    config: { configured: true, template: [{ day_of_week: 1, start_time: "08:30", end_time: "12:00" }, { day_of_week: 1, start_time: "14:00", end_time: "18:00" }], slot_duration_minutes: 45, rules: { breaks: [{ day_of_week: 1, start_time: "10:00", end_time: "10:30" }], blocked_dates: [{ date: "2099-11-01", reason: "Synthetic leave" }], overrides: [{ date: "2099-11-02", intervals: [{ start_time: "11:00", end_time: "13:00" }, { start_time: "15:00", end_time: "16:00" }] }], online_template: [{ day_of_week: 1, start_time: "14:00", end_time: "16:00" }] as { day_of_week: number; start_time: string; end_time: string }[] | null } },
    appointments: Array.from({ length: 8 }, (_, index) => ({ id: `appointment-${index}`, patient_id: patientId, doctor_id: doctorId, patient_name: `Synthetic Patient ${index}`, doctor_name: "Synthetic Doctor", reason: `Recorded concern ${index}`, appointment_type: index % 2 ? "IN_PERSON" : "ONLINE", scheduled_start: `${index === 7 ? "2099-10-27" : date}T${String(index + 3).padStart(2, "0")}:30:00Z`, scheduled_end: `${index === 7 ? "2099-10-27" : date}T${String(index + 4).padStart(2, "0")}:00:00Z`, status: ["CONFIRMED", "REQUESTED", "CANCELLED", "COMPLETED"][index % 4], payment_status: "UNPAID", created_at: "2099-10-01T00:00:00Z" })),
    calls: [] as string[], writes: [] as { path: string; body: unknown }[], failSave: false, failRead: false, failAppointments: false, denyRecord: false, failMutation: false,
  };
}

/** Exercises the actual SDK, role layout and UI with safe synthetic auth/API responses. */
async function services(page: Page, state = scheduleState()) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: doctorId, aud: "authenticated", role: "authenticated", email: "synthetic-schedule@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: doctorId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    state.calls.push(path); let status = 200; let body: unknown = {};
    if (request.method() !== "GET") state.writes.push({ path, body: request.postDataJSON() });
    if (path === "/me") body = { profile_id: doctorId, role: "DOCTOR", doctor_id: doctorId, patient_id: null };
    else if (path === "/doctor/dashboard") body = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path === "/doctor/appointments") { body = state.appointments; if (state.failAppointments) { status = 503; body = { error: { message: "Synthetic schedule unavailable" } }; } }
    else if (path === "/doctors/self/availability") {
      if (request.method() === "PUT") {
        if (state.failSave) { status = 503; body = { error: { message: "Synthetic save unavailable" } }; }
        else { state.config = { configured: true, ...request.postDataJSON() }; body = { ok: true }; }
      } else if (state.failRead) { status = 503; body = { error: { message: "Synthetic availability unavailable" } }; }
      else body = state.config;
    } else if (path.endsWith("/workspace")) {
      if (state.denyRecord) { status = 403; body = { error: { message: "Synthetic record access denied" } }; }
      else body = { patient: { id: patientId, name: "Synthetic Patient 0" }, identity: { patient_id: patientId, name: "Synthetic Patient 0", age: null, sex: null }, access_scope: "OWN_RECORDS", timeline: [], appointments: state.appointments, medications: [], allergies: [], consent: null, ai_summaries: [], documents: [], lab_reports: [] };
    } else if (/\/(confirm|cancel|payment-status)$/.test(path)) {
      if (state.failMutation) { status = 503; body = { error: { message: "Synthetic transition unavailable" } }; }
      else { const row = state.appointments.find((item) => path.includes(item.id)); if (row) { if (path.endsWith("/confirm")) row.status = "CONFIRMED"; else if (path.endsWith("/cancel")) row.status = "CANCELLED"; else row.payment_status = request.postDataJSON().payment_status; } body = { ok: true }; }
    }
    await route.fulfill({ status, headers: cors, json: body }).catch(() => {});
  });
  await page.goto("/sign-in"); await page.getByLabel("Email", { exact: true }).fill(user.email); await page.getByLabel("Password", { exact: true }).fill("synthetic-password"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/app\/doctor$/);
  return state;
}

/** Opens availability through its actual schedule navigation control. */
async function availability(page: Page) {
  await page.goto(root); await page.getByRole("link", { name: "Availability", exact: true }).click(); await expect(page.getByLabel("Default visit duration (minutes)")).toHaveValue("45");
}

test("SCR-024 day/week/date/status and SCR-026 back/close preserve calendar context without creating encounters", async ({ page }) => {
  const state = await services(page); await page.setViewportSize({ width: 393, height: 1100 }); await page.goto(root);
  await expect(page.getByText(`${date} · 7 APPOINTMENTS`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Later on this date" })).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-024-393.png", fullPage: true });
  await page.getByRole("link", { name: "Week", exact: true }).click(); await expect(page.getByText(/8 APPOINTMENTS/)).toBeVisible();
  await page.getByRole("link", { name: "CONFIRMED", exact: true }).click(); await expect(page).toHaveURL(/status=CONFIRMED/);
  await page.getByRole("link", { name: "Open context →", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Synthetic Patient 0", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open →/ })).toHaveCount(3);
  for (const button of await page.getByRole("button", { name: /^Open →/ }).all()) await expect(button).toBeDisabled();
  await expect(page.getByText("Allergy data unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "OPEN PATIENT RECORD", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "START CONSULTATION", exact: false })).toHaveAttribute("href", "/app/doctor/consultation/appointment-0");
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-026-393.png", fullPage: true });
  await page.getByRole("link", { name: "Back to schedule", exact: true }).click(); await expect(page).toHaveURL(/view=week&status=CONFIRMED/);
  await page.getByRole("link", { name: "Open context →", exact: true }).first().click(); await page.getByRole("link", { name: "Close", exact: true }).click(); await expect(page).toHaveURL(/view=week&status=CONFIRMED/);
  await page.getByLabel("Schedule date (India time)").fill("2099-11-10"); await expect(page.getByText("No appointments match this date and filter.")).toBeVisible();
  expect(state.calls.some((path) => path.endsWith("/consultation"))).toBe(false); expect(state.writes).toEqual([]);
});

test("missing/foreign appointments and denied patient records fail closed; cancelled/requested cannot start", async ({ page }) => {
  const state = await services(page); await page.goto(`/app/doctor/schedule/foreign?date=${date}`);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("This appointment is unavailable in your schedule."); expect(state.calls.some((path) => path.endsWith("/workspace"))).toBe(false);
  state.denyRecord = true; await page.goto(`/app/doctor/schedule/appointment-1?date=${date}`);
  await expect(page.getByRole("button", { name: "Consultation cannot start while requested" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Patient record access unavailable" })).toBeDisabled();
  state.denyRecord = false; await page.getByRole("button", { name: "Retry patient record access" }).click(); await expect(page.getByRole("link", { name: "OPEN PATIENT RECORD" })).toBeVisible();
  await page.goto(`/app/doctor/schedule/appointment-2?date=${date}`); await expect(page.getByRole("button", { name: "Consultation cannot start while cancelled" })).toBeDisabled();
});

test("confirm/payment/cancel failures preserve state, cancellation Escape/Keep return focus, and retries complete", async ({ page }) => {
  const state = await services(page); await page.goto(root); state.failMutation = true;
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("Synthetic transition unavailable"); state.failMutation = false;
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click(); await expect(page.getByRole("status")).toHaveText("Appointment confirmed.");
  state.failMutation = true; await page.getByLabel("Payment for Synthetic Patient 0", { exact: true }).selectOption("PAID"); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible(); await expect(page.getByLabel("Payment for Synthetic Patient 0", { exact: true })).toHaveValue("UNPAID");
  state.failMutation = false; await page.getByLabel("Payment for Synthetic Patient 0", { exact: true }).selectOption("PAID"); await expect(page.getByRole("status")).toHaveText("Payment status recorded.");
  const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first(); await cancel.click(); await page.keyboard.press("Escape"); await expect(cancel).toBeFocused();
  await cancel.click(); await page.getByRole("button", { name: "Keep appointment" }).click(); await expect(cancel).toBeFocused();
  await cancel.click(); state.failMutation = true; await page.getByRole("button", { name: "Yes, cancel" }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  state.failMutation = false; await page.getByRole("button", { name: "Yes, cancel" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(state.appointments[0].status).toBe("CANCELLED"); expect(state.appointments[0].payment_status).toBe("PAID");
});

test("SCR-025 loads saved multi-window configuration, toggles without loss, retains failed saves and confirms persisted rules", async ({ page }) => {
  const state = await services(page); const original = structuredClone(state.config); await page.setViewportSize({ width: 393, height: 1100 }); await availability(page);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-025-393.png", fullPage: true });
  await page.getByRole("button", { name: "Mon enabled", exact: true }).click(); await page.getByRole("button", { name: "Mon enabled", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Mon working hours" })).toHaveText("08:30–12:00, 14:00–18:00");
  await page.getByLabel("Default visit duration (minutes)").fill("20"); await page.getByRole("link", { name: "Schedule", exact: true }).first().click(); await page.getByRole("link", { name: "Availability", exact: true }).click(); await expect(page.getByLabel("Default visit duration (minutes)")).toHaveValue("20");
  state.failSave = true; await page.getByRole("button", { name: "SAVE AVAILABILITY" }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("Synthetic save unavailable"); await expect(page.getByLabel("Default visit duration (minutes)")).toHaveValue("20"); state.failSave = false;
  await page.getByRole("button", { name: "SAVE AVAILABILITY" }).click(); await expect(page.getByRole("status")).toHaveText("Availability saved and reloaded."); expect(state.config.template).toEqual(original.template); expect(state.config.rules).toEqual(original.rules); expect(state.config.slot_duration_minutes).toBe(20);
  await page.reload(); await page.getByRole("link", { name: "Availability", exact: true }).click(); await expect(page.getByLabel("Default visit duration (minutes)")).toHaveValue("20");
  await page.getByRole("button", { name: "SAVE AVAILABILITY" }).click(); await expect(page.getByRole("status")).toHaveText("Availability saved and reloaded."); expect(state.config.rules).toEqual(original.rules);
});

test("working/break/online/blocked/one-off editors validate, update and remove actual rules", async ({ page }) => {
  const state = await services(page); await availability(page);
  await page.getByRole("button", { name: "Edit Mon working hours" }).click(); await page.getByLabel("Window 1 start", { exact: true }).fill("08:00"); await page.getByRole("button", { name: "Add window", exact: true }).click(); await page.getByRole("button", { name: "Remove window 3" }).click(); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Edit Mon working hours" })).toBeFocused();
  await page.getByRole("button", { name: /^Breaks/ }).click(); await page.getByLabel("Window 1 end", { exact: true }).fill("10:45"); await page.getByRole("button", { name: "Return to availability" }).click();
  await page.getByRole("button", { name: "Edit online hours" }).click(); await page.getByLabel("Use working hours for online slots").check(); await page.getByLabel("Use working hours for online slots").uncheck(); await page.getByRole("button", { name: "Add window", exact: true }).click(); await page.getByLabel("Window 1 start", { exact: true }).fill("14:30"); await page.getByLabel("Window 1 end", { exact: true }).fill("16:00"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ Add", exact: true }).click(); await page.getByLabel("Blocked date", { exact: true }).fill("2099-11-03"); await page.getByLabel("Reason", { exact: true }).fill("Synthetic training"); await page.getByRole("button", { name: "Add blocked date", exact: true }).click(); await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Remove blocked 2099-11-01" }).click();
  await page.getByRole("button", { name: "Edit →", exact: true }).click(); await expect(page.getByLabel("Override date", { exact: true })).toHaveValue("2099-11-02"); await page.getByLabel("Override end", { exact: true }).fill("10:00"); await page.getByRole("button", { name: "Set one-off hours" }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); await page.getByLabel("Override end", { exact: true }).fill("14:00"); await page.getByRole("button", { name: "Set one-off hours" }).click(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "SAVE AVAILABILITY" }).click(); await expect(page.getByRole("status")).toHaveText("Availability saved and reloaded."); expect(state.config.template[0].start_time).toBe("08:00"); expect(state.config.rules.breaks[0].end_time).toBe("10:45"); expect(state.config.rules.blocked_dates).toEqual([{ date: "2099-11-03", reason: "Synthetic training" }]); expect(state.config.rules.overrides[0].intervals).toEqual([{ start_time: "11:00", end_time: "14:00" }]); expect(state.config.rules.online_template?.[0].start_time).toBe("14:30");
});

test("schedule/availability read failures retry and no saved week is invented for an unconfigured doctor", async ({ page }) => {
  const state = await services(page); state.failAppointments = true; state.failRead = true; await page.goto(root); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').first()).toHaveText("Synthetic schedule unavailableRetry schedule"); state.failAppointments = false; await page.getByRole("button", { name: "Retry schedule" }).click(); await expect(page.getByText(/7 APPOINTMENTS/)).toBeVisible();
  await page.getByRole("link", { name: "Availability", exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("Synthetic availability unavailableRetry availability"); state.failRead = false; state.config.configured = false; state.config.template = []; await page.getByRole("button", { name: "Retry availability" }).click(); await expect(page.getByText("No availability has been published. Enable working windows before saving.")).toBeVisible(); for (const button of await page.getByRole("button", { name: / enabled$/ }).all()) await expect(button).toHaveAttribute("aria-pressed", "false");
});

for (const width of [320, 768, 1440]) test(`schedule, availability editor and appointment context fit ${width}px`, async ({ page }) => {
  await services(page); await page.setViewportSize({ width, height: 900 }); await page.goto(root); await expect(page.getByText(/7 APPOINTMENTS/)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Availability", exact: true }).click(); await page.getByRole("button", { name: "Edit Mon working hours" }).click(); for (let i = 0; i < 18; i++) { await page.keyboard.press("Tab"); expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true); } expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Edit Mon working hours" })).toBeFocused();
  await page.goto(`/app/doctor/schedule/appointment-0?date=${date}`); await expect(page.getByRole("heading", { name: "Synthetic Patient 0", exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
