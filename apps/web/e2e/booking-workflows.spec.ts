import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const alpha = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const beta = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
type Visit = {
  id: string;
  doctor_id: string;
  doctor_name: string;
  speciality: string;
  status: string;
  appointment_type: string;
  scheduled_start: string;
  scheduled_end: string | null;
  reason: string | null;
  payment_status: string;
};
/** Shares only non-sensitive synthetic service state between patient and doctor test browsers. */
function visitState() {
  const base = {
    doctor_id: alpha,
    doctor_name: "Synthetic Alpha",
    speciality: "Neurology",
    scheduled_end: null,
    reason: "Synthetic visit reason",
    payment_status: "UNPAID",
  };
  return {
    visits: [
      {
        ...base,
        id: "future-online",
        appointment_type: "ONLINE",
        status: "CONFIRMED",
        scheduled_start: "2099-10-26T10:00:00+05:30",
        payment_status: "PAID",
      },
      {
        ...base,
        id: "future-clinic",
        appointment_type: "IN_PERSON",
        status: "REQUESTED",
        scheduled_start: "2099-10-27T11:00:00+05:30",
      },
      {
        ...base,
        id: "past",
        appointment_type: "IN_PERSON",
        status: "COMPLETED",
        scheduled_start: "2020-01-01T10:00:00+05:30",
      },
      {
        ...base,
        id: "cancelled",
        appointment_type: "ONLINE",
        status: "CANCELLED",
        scheduled_start: "2099-10-28T10:00:00+05:30",
      },
    ] as Visit[],
    failDoctors: false,
    failAvailability: false,
    failBooking: false,
    failCancellation: false,
    failAppointments: false,
    delayAlpha: false,
    posts: [] as { path: string; body: Record<string, unknown> }[],
    queries: [] as string[],
  };
}

/** Runs actual SDK/guards/pages against controlled HTTP; no real accounts or clinical data are used. */
async function visitServices(
  page: Page,
  state = visitState(),
  role: "PATIENT" | "DOCTOR" = "PATIENT",
) {
  const userId = role === "PATIENT" ? patientId : alpha;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: `synthetic-visit-${role.toLowerCase()}@example.test`,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString(),
    identities: [],
    is_anonymous: false,
  };
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) =>
    route.fulfill({
      headers: cors,
      json: route.request().url().includes("/user") ? user : session,
    }),
  );
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const payload = request.postData() ? request.postDataJSON() : {};
    if (request.method() === "POST") state.posts.push({ path, body: payload });
    let body: unknown = {};
    let status = 200;
    if (path === "/me")
      body = {
        profile_id: userId,
        role,
        patient_id: role === "PATIENT" ? patientId : null,
        doctor_id: role === "DOCTOR" ? alpha : null,
        verification_status: "PENDING",
      };
    else if (path === "/patients/self/dashboard")
      body = {
        upcoming_appointment: null,
        pending_followups: [],
        recent_timeline: [],
      };
    else if (path === "/doctors") {
      if (state.failDoctors) {
        status = 503;
        body = { error: { message: "Synthetic doctor picker unavailable" } };
      } else
        body = [
          {
            doctor_id: alpha,
            name: "Synthetic Alpha",
            speciality: "Neurology",
            verification_status: "PENDING",
          },
          {
            doctor_id: beta,
            name: "Synthetic Beta",
            speciality: "General Medicine",
            verification_status: "VERIFIED",
          },
        ];
    } else if (path.endsWith("/availability")) {
      state.queries.push(url.search);
      if (state.failAvailability) {
        status = 503;
        body = { error: { message: "Synthetic availability failed" } };
      } else {
        const hour = path.includes(beta) ? "11" : "10";
        const date = url.searchParams.get("from");
        body = {
          slots: [
            {
              start: `${date}T${hour}:00:00+05:30`,
              end: `${date}T${hour}:30:00+05:30`,
            },
          ],
        };
        if (state.delayAlpha && path.includes(alpha))
          await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } else if (
      path === "/patients/self/appointments" &&
      request.method() === "POST"
    ) {
      if (state.failBooking) {
        status = 409;
        body = {
          error: { code: "SLOT_TAKEN", message: "Synthetic slot was taken" },
        };
      } else {
        const doctor = payload.doctor_id === alpha ? "Alpha" : "Beta";
        const visit: Visit = {
          id: `new-visit-${state.visits.length}`,
          doctor_id: payload.doctor_id,
          doctor_name: `Synthetic ${doctor}`,
          speciality: "Synthetic speciality",
          status: "REQUESTED",
          appointment_type: payload.appointment_type,
          scheduled_start: payload.scheduled_start,
          scheduled_end: null,
          reason: payload.reason ?? null,
          payment_status: "UNPAID",
        };
        state.visits.push(visit);
        body = { appointment: visit };
        status = 201;
      }
    } else if (path === "/patients/self/appointments") {
      if (state.failAppointments) {
        status = 503;
        body = { error: { message: "Synthetic appointments unavailable" } };
      } else body = state.visits;
    } else if (path.endsWith("/cancel")) {
      if (state.failCancellation) {
        status = 503;
        body = { error: { message: "Synthetic cancellation failed" } };
      } else {
        const id = path.split("/")[2];
        const visit = state.visits.find((v) => v.id === id)!;
        visit.status = "CANCELLED";
        body = { ok: true };
      }
    } else if (path.endsWith("/confirm")) {
      const id = path.split("/")[3];
      state.visits.find((visit) => visit.id === id)!.status = "CONFIRMED";
      body = { ok: true };
    } else if (path === "/doctor/dashboard")
      body = {
        incoming_requests: state.visits
          .filter((visit) => visit.status === "REQUESTED")
          .map((visit) => ({
            ...visit,
            patient_id: patientId,
            patient_name: "Synthetic Patient",
          })),
        today_appointments: [],
        draft_queue: { pending: 0 },
        followups_due: { due_today: 0, overdue: 0 },
      };
    else if (path === "/patients/self/timeline") body = { entries: [] };
    else if (
      [
        "/patients/self/documents",
        "/patients/self/lab-reports",
        "/patients/self/medications",
      ].includes(path)
    )
      body = [];
    await route.fulfill({ status, headers: cors, json: body }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "PATIENT" ? /\/app\/patient$/ : /\/app\/doctor$/,
  );
  return state;
}

/** Chooses a real returned slot; this helper never submits a booking itself. */
async function chooseVisit(
  page: Page,
  mode: "ONLINE" | "IN_PERSON" = "IN_PERSON",
) {
  await page.goto(`/app/patient/book?doctorId=${alpha}`);
  if (mode === "ONLINE")
    await page.getByRole("button", { name: /Online video/ }).click();
  await page.getByLabel("Choose date (India time)").fill("2099-11-02");
  await page.getByRole("button", { name: /10:00/ }).click();
}

test("SCR-022/023 reviews real doctor/mode/date/reason, preserves edits, and makes no sharing claim", async ({
  page,
}) => {
  const state = await visitServices(page);
  await page.setViewportSize({ width: 393, height: 1000 });
  await chooseVisit(page, "ONLINE");
  await expect(page.getByText("PENDING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit reason →" }).click();
  await page.getByLabel("Reason (optional)").fill("Synthetic follow-up reason");
  await page.getByRole("button", { name: "Use this reason" }).click();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-022-393.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review exact packet contents →" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Record sharing unavailable" }),
  ).toContainText("No health records are attached");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review consultation" }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic follow-up reason", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-023-393.png",
    fullPage: true,
  });
  expect(state.posts).toHaveLength(0);
  await page
    .getByRole("button", { name: "Review scope →", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Record sharing unavailable" }),
  ).toContainText("No health records are attached");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Online video/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /10:00/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to edit booking", exact: true })
    .click();
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click();
  await expect(page).toHaveURL(/\/appointments\?booked=new-visit-/);
  const submitted = state.posts.find(
    (entry) => entry.path === "/patients/self/appointments",
  )!.body;
  expect(submitted).toMatchObject({
    doctor_id: alpha,
    appointment_type: "ONLINE",
    reason: "Synthetic follow-up reason",
  });
  expect(submitted).not.toHaveProperty("consent_id");
  expect(submitted).not.toHaveProperty("encounter_id");
  await expect(
    page.getByText(/Your booking is recorded as requested/),
  ).toBeVisible();
});

test("blank optional reason is omitted and cancellation exits create no booking", async ({
  page,
}) => {
  const state = await visitServices(page);
  await page.goto("/app/patient/appointments");
  await page.getByRole("link", { name: "+ Book", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/book$/);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/appointments$/);
  await chooseVisit(page);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  expect(state.posts).toHaveLength(0);
  await chooseVisit(page);
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click({ clickCount: 2 });
  await expect(page).toHaveURL(/booked=new-visit-/);
  const bookings = state.posts.filter(
    (entry) => entry.path === "/patients/self/appointments",
  );
  expect(bookings).toHaveLength(1);
  expect(bookings[0].body).not.toHaveProperty("reason");
});

test("doctor/mode/date changes invalidate old slots and availability failures retry", async ({
  page,
}) => {
  const state = await visitServices(page);
  state.failAvailability = true;
  await page.goto(`/app/patient/book?doctorId=${alpha}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "availability failed" }),
  ).toBeVisible();
  state.failAvailability = false;
  await page
    .getByRole("button", { name: "Retry availability", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "availability failed" }),
  ).toHaveCount(0);
  await page.getByLabel("Choose date (India time)").fill("2099-11-02");
  await page.getByRole("button", { name: /10:00/ }).click();
  await page.getByRole("button", { name: "2099-11-03", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "REVIEW BOOKING", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /10:00/ }).click();
  await page.getByRole("button", { name: /Online video/ }).click();
  await expect(
    page.getByRole("button", { name: "REVIEW BOOKING", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /10:00/ }).click();
  state.delayAlpha = true;
  await page.getByRole("button", { name: "2099-11-04", exact: true }).click();
  await page.getByRole("button", { name: "Change doctor →" }).click();
  await page.getByRole("button", { name: /Dr. Synthetic Beta/ }).click();
  await page.getByRole("button", { name: /11:00/ }).click();
  await expect(page.getByRole("button", { name: /10:00/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "REVIEW BOOKING", exact: true }),
  ).toBeEnabled();
  expect(state.queries.some((query) => query.includes("type=ONLINE"))).toBe(
    true,
  );
});

test("failed confirmation keeps review data and permits a fresh slot selection", async ({
  page,
}) => {
  const state = await visitServices(page);
  state.failBooking = true;
  await chooseVisit(page);
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "slot was taken" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review consultation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose another time" }).click();
  await expect(
    page.getByRole("button", { name: "REVIEW BOOKING", exact: true }),
  ).toBeDisabled();
  state.failBooking = false;
  await page.getByRole("button", { name: /10:00/ }).click();
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click();
  await expect(page).toHaveURL(/booked=new-visit-/);
});

test("SCR-017 counts tabs, distinguishes manual payment and recovers a confirmed-visit cancellation", async ({
  page,
}) => {
  const state = await visitServices(page);
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/app/patient/appointments");
  await expect(page.getByRole("tab", { name: "Upcoming · 2" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Past · 1" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "JOIN ONLINE CONSULTATION" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open directions unavailable" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-017-393.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Past · 1" }).click();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel appointment", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Upcoming · 2" }).click();
  const cancel = page
    .getByRole("button", { name: "Cancel appointment", exact: true })
    .first();
  await cancel.click();
  const dialog = page.getByRole("dialog", { name: "Cancel appointment?" });
  await dialog.getByRole("button", { name: "Keep visit" }).click();
  await expect(cancel).toBeFocused();
  await cancel.click();
  await page.keyboard.press("Escape");
  await expect(cancel).toBeFocused();
  state.failCancellation = true;
  await cancel.click();
  await dialog.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(dialog).toContainText("Synthetic cancellation failed");
  expect(state.visits[0].status).toBe("CONFIRMED");
  state.failCancellation = false;
  await dialog.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(
    page.getByRole("tab", { name: "Cancelled · 2" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(state.visits[0].status).toBe("CANCELLED");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
});

test("reschedule explicitly cancels and rebooks with the owned doctor's mode/reason preserved", async ({
  page,
}) => {
  const state = await visitServices(page);
  await page.goto("/app/patient/appointments");
  await page
    .getByRole("button", { name: "Reschedule", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Choose another appointment time?",
  });
  await expect(dialog).toContainText("A replacement is not reserved");
  expect(state.posts).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Cancel and choose new time" })
    .click();
  await expect(page).toHaveURL(/book\?rebook=future-online$/);
  await expect(
    page.getByRole("button", { name: /Online video/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Synthetic visit reason", { exact: true }),
  ).toBeVisible();
  expect(state.visits[0].status).toBe("CANCELLED");
  await page.getByLabel("Choose date (India time)").fill("2099-11-02");
  await page.getByRole("button", { name: /10:00/ }).click();
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click();
  await expect(page).toHaveURL(/appointments\?booked=/);
  expect(state.visits.at(-1)).toMatchObject({
    doctor_id: alpha,
    appointment_type: "ONLINE",
    reason: "Synthetic visit reason",
    status: "REQUESTED",
  });
});

test("patient request reaches the doctor queue and confirmation returns to the patient's visit", async ({
  page,
  browser,
}) => {
  const state = visitState();
  state.visits = [];
  await visitServices(page, state);
  await chooseVisit(page);
  await page
    .getByRole("button", { name: "REVIEW BOOKING", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CONFIRM BOOKING", exact: true })
    .click();
  await expect(page).toHaveURL(/appointments\?booked=/);
  const context = await browser.newContext();
  try {
    const doctorPage = await context.newPage();
    await visitServices(doctorPage, state, "DOCTOR");
    await doctorPage
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(
      doctorPage.getByRole("button", { name: "Confirm", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("CONFIRMED", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("picker/list failures retry; foreign rebook and unsupported packet context never create false success", async ({
  page,
}) => {
  const state = await visitServices(page);
  state.failDoctors = true;
  await page.goto("/app/patient/book");
  await expect(
    page.getByRole("alert").filter({ hasText: "picker unavailable" }),
  ).toBeVisible();
  state.failDoctors = false;
  await page.getByRole("button", { name: "Retry booking data" }).click();
  await expect(
    page.getByRole("button", { name: "Select doctor →" }),
  ).toBeVisible();
  await page.goto("/app/patient/book?rebook=foreign");
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable in your record" }),
  ).toBeVisible();
  await page.goto(`/app/patient/book?doctorId=${alpha}&packetId=unsupported`);
  await expect(
    page.getByText(/Incoming packet context cannot be attached/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save as draft unavailable" }),
  ).toBeDisabled();
  state.failAppointments = true;
  await page.goto("/app/patient/appointments?booked=foreign");
  await expect(
    page.getByRole("alert").filter({ hasText: "appointments unavailable" }),
  ).toBeVisible();
  state.failAppointments = false;
  await page.getByRole("button", { name: "Retry appointments" }).click();
  await expect(page.getByRole("tab", { name: "Upcoming · 2" })).toBeVisible();
  await expect(page.getByText(/Your booking is recorded/)).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

for (const width of [320, 768, 1440])
  test(`visit forms and confirmations fit ${width}px with keyboard focus return`, async ({
    page,
  }) => {
    await visitServices(page);
    await page.setViewportSize({ width, height: 1000 });
    await chooseVisit(page);
    const reason = page.getByRole("button", { name: "Edit reason →" });
    await reason.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Reason for visit" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reason).toBeFocused();
    await page
      .getByRole("button", { name: "REVIEW BOOKING", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/app/patient/appointments");
    await page
      .getByRole("button", { name: "Cancel appointment", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Cancel appointment?" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
  });
