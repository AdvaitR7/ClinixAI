import { expect, test, type Page } from "@playwright/test";

const userId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const practiceId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const apptId = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

type Role = "RECEPTION" | "ASSISTANT" | "OWNER" | "NONE";

/** Synthetic staff service state. No real accounts, patients or clinical data. */
function staffState(role: Role) {
  return {
    role,
    intake: null as string | null,
    vitals: [] as Record<string, unknown>[],
    followupOpen: true,
    payment: "UNPAID",
    calls: [] as { method: string; path: string; body: Record<string, unknown> }[],
  };
}

/** Runs the real pages, guards and SDK against controlled HTTP. */
async function staffServices(page: Page, role: Role, startPath: string) {
  const state = staffState(role);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-staff@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = request.postData() ? request.postDataJSON() : {};
    state.calls.push({ method, path, body });
    let json: unknown = {};
    let status = 200;
    const assistant = state.role === "ASSISTANT";
    if (path === "/me") {
      json = {
        profile_id: userId, role: "CLINIC_STAFF", patient_id: null, doctor_id: null, verification_status: null,
        memberships: state.role === "NONE" ? [] : [{ member_id: "m1", practice_id: practiceId, practice_name: "City Clinic", role: state.role }],
      };
    } else if (path === "/staff/dashboard") {
      json = {
        practice: { id: practiceId, name: "City Clinic" }, role: state.role,
        counts: { requested: 1, waiting: 0, unpaid: 1, contact: 1 },
        appointments: [{ id: apptId, patient_name: "Synthetic Patient", scheduled_start: "2026-10-27T04:30:00Z", reason: "Routine review", status: "CONFIRMED", payment_status: "UNPAID", appointment_type: "IN_PERSON", intake_status: state.intake }],
        assigned_followups: [{ id: "f1", patient_name: "Synthetic Patient", reason: "Confirm availability", due_at: "2026-10-27T10:00:00Z", contact_status: "UNREACHED" }],
      };
    } else if (path === "/staff/doctors") json = [{ doctor_id: "d1", name: "Dr. Synthetic", speciality: "Medicine" }];
    else if (path === "/doctors/d1/availability") json = { slots: [{ start: "2026-10-30T05:00:00Z" }] };
    else if (path === "/staff/appointments" && method === "POST") { status = 201; json = { appointment: { id: "new", status: "REQUESTED" } }; }
    else if (path === `/staff/appointments/${apptId}/receipt`) json = { appointment_id: apptId, patient_name: "Synthetic Patient", scheduled_start: "2026-10-27T04:30:00Z", payment_status: state.payment, fee_inr: 600, events: [] };
    else if (path === `/staff/appointments/${apptId}/payment-status`) { state.payment = String(body.payment_status); json = { payment_status: state.payment }; }
    else if (path === "/staff/claim-invitations") json = [{ patient_id: "p9", patient_name: "Synthetic Unclaimed", invited_at: null, state: "NONE" }];
    else if (path === "/staff/patients/p9/claim-invites") { status = 201; json = { invite_token: "abc123claim" }; }
    else if (path === "/staff/record-removal-requests") json = [{ id: "rr1", resource_type: "DOCUMENT", status: "OPEN", requested_at: "2026-10-27T00:00:00Z", target_doctor_id: "d0", target_doctor_name: "Dr. Other" }];
    else if (/^\/record-removal-requests\/rr1\/route$/.test(path)) json = { ok: true };
    else if (path === "/staff/schedule") {
      json = { date: "2026-10-27", role: state.role, appointments: [{ id: apptId, patient_name: "Synthetic Patient", scheduled_start: "2026-10-27T04:30:00Z", reason: "Routine review", status: "CONFIRMED", payment_status: "UNPAID", appointment_type: "IN_PERSON", intake_status: state.intake }] };
    } else if (path === "/staff/patients") {
      json = [{ patient_id: "p1", full_name: "Synthetic Patient", claim_status: "UNCLAIMED", phone_hint: "\u2022\u2022\u2022 4321", next_appointment_at: "2026-10-28T06:30:00Z" }];
    } else if (path === `/staff/appointments/${apptId}/arrive`) { state.intake = "ARRIVED"; json = { intake_status: "ARRIVED" }; }
    else if (path === `/staff/appointments/${apptId}/intake`) {
      json = { appointment_id: apptId, patient_name: "Synthetic Patient", scheduled_start: "2026-10-27T04:30:00Z", reason: "Routine review", intake_status: state.intake, clinical_intake_locked: !assistant, vitals: assistant ? state.vitals : [] };
    } else if (path === `/staff/appointments/${apptId}/vitals`) {
      state.vitals.push({ id: "v1", temperature_c: body.temperature_c ?? null, pulse_bpm: null, systolic_mmhg: null, diastolic_mmhg: null, spo2_percent: null, weight_kg: null, needs_doctor_review: Number(body.temperature_c) >= 38, provenance: "CLINIC_STAFF", recorded_at: "2026-10-27T04:40:00Z" });
      status = 201; json = state.vitals[0];
    } else if (path === `/staff/appointments/${apptId}/ready`) { state.intake = "READY_FOR_DOCTOR"; json = { intake_status: "READY_FOR_DOCTOR" }; }
    else if (path === "/followups" && method === "GET") json = [{ id: "f1", patient_name: "Synthetic Patient", practice_id: practiceId, due_at: "2026-10-28T10:00:00Z", reason: "Confirm availability", status: "OPEN", assigned_member_id: null, contact_status: "UNREACHED", outcome: null }];
    else if (path === "/followups/f1" && method === "GET") json = { id: "f1", patient_name: "Synthetic Patient", practice_id: practiceId, due_at: "2026-10-28T10:00:00Z", reason: "Confirm availability", status: state.followupOpen ? "OPEN" : "COMPLETED", assigned_member_id: null, contact_status: "UNREACHED", outcome: null };
    else if (path === "/followups/f1/complete") { state.followupOpen = false; json = {}; }
    await route.fulfill({ status, headers: cors, json }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/staff$/);
  if (startPath !== "/app/staff") await page.goto(startPath);
  return state;
}

test("SCR-005 style no-membership state explains that access needs an accepted invitation", async ({ page }) => {
  await staffServices(page, "NONE", "/app/staff");
  await expect(page.getByText("You have no active practice")).toBeVisible();
});

test("SCR-042 receptionist marks arrival and sees clinical intake locked (SCR-045)", async ({ page }) => {
  const state = await staffServices(page, "RECEPTION", "/app/staff");
  await page.setViewportSize({ width: 393, height: 1100 });
  await expect(page.getByRole("heading", { name: "Today at City Clinic" })).toBeVisible();
  await page.getByRole("button", { name: "Mark arrival" }).click();
  await expect(page.getByRole("link", { name: "Arrival details" })).toBeVisible();
  expect(state.calls.some((c) => c.path === `/staff/appointments/${apptId}/arrive`)).toBe(true);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-042-393.png", fullPage: true });
  await page.getByRole("link", { name: "Arrival details" }).click();
  await expect(page.getByText("Clinical intake locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save vitals" })).toHaveCount(0);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-045-393.png", fullPage: true });
});

test("SCR-044 assistant records vitals with staff provenance and marks ready for doctor", async ({ page }) => {
  const state = await staffServices(page, "ASSISTANT", "/app/staff");
  await page.setViewportSize({ width: 393, height: 1400 });
  await page.getByRole("button", { name: "Mark arrival" }).click();
  await page.getByRole("link", { name: "Open intake" }).click();
  await expect(page.getByRole("button", { name: "Mark ready for doctor" })).toBeDisabled();
  await page.getByLabel("Temperature (°C)").fill("38.6");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText("Clinical assistant entered ·")).toBeVisible();
  await expect(page.getByText("Needs doctor review")).toBeVisible();
  await expect(page.getByText(/diagnos/i, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Mark ready for doctor" }).click();
  await expect(page.getByRole("button", { name: "Ready for doctor" })).toBeDisabled();
  expect(state.vitals).toHaveLength(1);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-044-393.png", fullPage: true });
});

test("SCR-037 staff follow-up detail locks the clinical outcome", async ({ page }) => {
  await staffServices(page, "RECEPTION", "/app/staff/followups");
  await page.setViewportSize({ width: 393, height: 900 });
  await page.getByRole("link", { name: /Synthetic Patient/ }).click();
  await expect(page.getByText("Locked. Only the doctor records the clinical outcome.")).toBeVisible();
  await page.getByRole("button", { name: "Mark task completed" }).click();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-037-393.png", fullPage: true });
});

test("SCR-042 dock opens the restricted schedule, patient list and assistant-only intake queue", async ({ page }) => {
  const state = await staffServices(page, "ASSISTANT", "/app/staff/schedule");
  await page.setViewportSize({ width: 393, height: 1000 });
  await expect(page.getByRole("navigation", { name: "Operational views" }).getByRole("link", { name: "Intake" })).toBeVisible();
  await page.getByRole("button", { name: "Mark arrival" }).click();
  await page.getByRole("link", { name: "Patients" }).first().click();
  await expect(page).toHaveURL(/tab=patients/);
  await expect(page.getByText("Synthetic Patient · UNCLAIMED · ••• 4321")).toBeVisible();
  await expect(page.getByText(/diagnos|prescription/i).first()).toBeVisible(); // only the boundary note, never clinical data
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-023g-patients-393.png", fullPage: true });
  await page.goto("/app/staff/schedule?tab=intake");
  await expect(page.getByRole("link", { name: "Open intake" })).toBeVisible();
  expect(state.calls.some((c) => c.path === "/staff/patients")).toBe(true);
});

test("receptionist has no intake tab", async ({ page }) => {
  await staffServices(page, "RECEPTION", "/app/staff/schedule?tab=intake");
  await expect(page.getByRole("navigation", { name: "Operational views" }).getByRole("link", { name: "Intake" })).toHaveCount(0);
  await expect(page.getByText("Schedule · today")).toBeVisible();
});

test("SCR 23d staff books from published times; 23e receipt updates payment; 23f claim code shown once", async ({ page }) => {
  const state = await staffServices(page, "RECEPTION", "/app/staff/book?practice_id=" + practiceId);
  await page.setViewportSize({ width: 393, height: 1100 });
  await page.getByLabel("Doctor", { exact: true }).selectOption("d1");
  await expect(page.getByRole("group", { name: "Available times" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request appointment" })).toBeDisabled();
  await page.getByRole("group", { name: "Available times" }).getByRole("button").first().click();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-023d-393.png", fullPage: true });
  await page.goto(`/app/staff/receipt/${apptId}?practice_id=${practiceId}`);
  await expect(page.getByText("Fee ₹600")).toBeVisible();
  await page.getByRole("button", { name: "Paid", exact: true }).click();
  expect(state.calls.some((c) => c.path.endsWith("/payment-status") && c.body.payment_status === "PAID")).toBe(true);
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-023e-393.png", fullPage: true });
  await page.goto(`/app/staff/claims?practice_id=${practiceId}`);
  await page.getByRole("button", { name: "Send invitation →" }).click();
  await expect(page.getByText("Claim code (shown once): abc123claim")).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-023f-393.png", fullPage: true });
});

test("SCR-051 staff can route a request but have no decision controls", async ({ page }) => {
  const state = await staffServices(page, "RECEPTION", "/app/staff/requests");
  await expect(page.getByText("document request · open")).toBeVisible();
  await expect(page.getByRole("button", { name: /APPROVE|RETAIN/i })).toHaveCount(0);
  await page.getByLabel("Route to doctor").selectOption("d1");
  await page.getByRole("button", { name: "Route request" }).click();
  expect(state.calls.some((c) => c.path === "/record-removal-requests/rr1/route" && c.body.doctor_id === "d1")).toBe(true);
});
