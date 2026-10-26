import { expect, test, type Page } from "@playwright/test";

const doctorId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const otherId = "2e036082-69a1-4b95-88d9-3190ded27f62";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
};

/** Runs the actual browser SDK and module against non-sensitive controlled service responses. */
async function recordServices(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: doctorId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic-record@example.test",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString(),
    identities: [],
    is_anonymous: false,
  };
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: doctorId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  const visit = {
    id: "synthetic-visit",
    patient_id: patientId,
    doctor_id: doctorId,
    patient_name: "Synthetic One",
    scheduled_start: "2099-10-25T09:00:00Z",
    scheduled_end: null,
    reason: "Synthetic review",
    appointment_type: "IN_PERSON",
    payment_status: "UNPAID",
    status: "CONFIRMED",
  };
  const record = {
    patient_id: patientId,
    status: "CLAIMED",
    identity: {
      full_name: "Synthetic One",
      phone_last4: "0011",
      date_of_birth: null,
      sex_at_registration: null,
    },
    allergies: [],
    consent_active: null,
    access_scope: "DOCTOR_OWN_RECORDS",
    current_concern: "Synthetic concern",
    current_concern_at: "2026-10-25T09:00:00Z",
    relationships: [],
    appointments: [visit],
    timeline: [
      {
        id: "synthetic-encounter",
        kind: "encounter",
        at: "2026-10-25T09:00:00Z",
        label: "Synthetic encounter",
        provenance: "PATIENT_REPORTED",
      },
      {
        id: "older",
        kind: "encounter",
        at: "2026-10-24T09:00:00Z",
        label: "Older clinician entry",
        provenance: "DOCTOR_AUTHORED",
      },
    ],
    medications: [
      {
        medicine_name: "Synthetic medicine",
        dose: "1 tablet",
        route: "Oral",
        frequency: "Daily",
        status: "UNKNOWN_STATUS",
        prescribed_date: "2026-10-25T09:00:00Z",
        prescription_id: "synthetic-rx",
      },
    ],
    prescriptions: [
      {
        id: "synthetic-rx",
        encounter_id: "synthetic-encounter",
        finalized_at: "2026-10-25T09:00:00Z",
      },
    ],
    documents: [
      {
        document_id: "synthetic-doc",
        document_type: "LAB_REPORT",
        original_filename: "synthetic.png",
        mime_type: "image/png",
        processing_status: "COMPLETE",
        created_at: "2026-10-25T09:00:00Z",
      },
    ],
    reports: [
      {
        report_id: "synthetic-report",
        laboratory_name: "Synthetic laboratory",
        source_document_id: "synthetic-doc",
        report_date: "2026-10-25",
        observations: [
          {
            id: "synthetic-observation",
            test_name: "Synthetic test",
            value_numeric: 7,
            unit: "units",
            reference_text: "5–9",
            needs_review: true,
          },
        ],
      },
    ],
  };
  const state = {
    failPut: false,
    failComplete: false,
    failDirectory: false,
    deny: false,
    failSource: false,
    visits: true,
    unclaimed: false,
    methods: [] as string[],
    calls: [] as string[],
    queries: [] as string[],
    record,
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) =>
    route.fulfill({
      headers: cors,
      json: route.request().url().includes("/user") ? user : session,
    }),
  );
  await page.route("https://storage.example.test/**", (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    state.methods.push("PUT");
    return route.fulfill({
      status: state.failPut ? 503 : 200,
      headers: cors,
      body: "",
    });
  });
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    state.calls.push(path);
    state.queries.push(url.search);
    let status = 200;
    let body: unknown = {};
    if (path === "/me")
      body = {
        profile_id: doctorId,
        role: "DOCTOR",
        doctor_id: doctorId,
        patient_id: null,
        verification_status: "VERIFIED",
      };
    else if (path === "/doctor/dashboard")
      body = {
        incoming_requests: [],
        today_appointments: [],
        draft_queue: { pending: 0 },
        followups_due: { due_today: 0, overdue: 0 },
      };
    else if (path === "/doctor/patients") {
      if (state.failDirectory) {
        status = 503;
        body = {
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic directory unavailable",
          },
        };
      } else
        body = [
          {
            patient_id: patientId,
            full_name: "Synthetic One",
            phone: "9999000011",
            status: "CLAIMED",
            relationship_status: "ACTIVE",
            last_encounter_at: "2026-10-25T09:00:00Z",
            next_appointment_at: visit.scheduled_start,
          },
        ];
    } else if (path.endsWith("/workspace")) {
      if (state.deny) {
        status = 403;
        body = {
          error: { code: "FORBIDDEN", message: "Synthetic forbidden record" },
        };
      } else if (path.includes(otherId))
        body = {
          ...record,
          patient_id: otherId,
          identity: { ...record.identity, full_name: "Synthetic Two" },
          current_concern: null,
          medications: [],
          reports: [],
          documents: [],
          timeline: [],
          appointments: [],
          allergies: ["Synthetic allergy"],
        };
      else
        body = {
          ...record,
          status: state.unclaimed ? "UNCLAIMED" : "CLAIMED",
          appointments: state.visits ? [visit] : [],
        };
    } else if (path.includes("/documents/upload-init")) {
      state.methods.push("INIT");
      body = {
        document_id: "new-doc",
        upload_url: "https://storage.example.test/synthetic",
        expires_in: 7200,
      };
    } else if (path.endsWith("/upload-complete")) {
      state.methods.push("COMPLETE");
      if (state.failComplete) {
        status = 503;
        body = {
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic completion failed",
          },
        };
      } else {
        record.documents.push({
          ...record.documents[0],
          document_id: "new-doc",
          original_filename: "uploaded.png",
          processing_status: "PROCESSING",
        });
        body = { ok: true };
      }
    } else if (path === "/doctor/documents/synthetic-doc") {
      if (state.failSource) {
        status = 403;
        body = {
          error: { code: "FORBIDDEN", message: "Synthetic source denied" },
        };
      } else
        body = {
          ...record.documents[0],
          view_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        };
    } else if (path.endsWith("/claim-invites"))
      body = {
        invite_token: "SYNTHETIC-CODE",
        expires_at: "2099-10-25T10:00:00Z",
      };
    else if (path === "/doctor/encounters")
      body = { encounter_id: "synthetic-new-encounter" };
    else if (path.endsWith("/consultation"))
      body = {
        appointment: visit,
        encounter_id: "synthetic-encounter",
        note: {},
        note_is_final: false,
        current_medications: [],
      };
    else if (path === "/doctor/prescriptions/synthetic-rx") {
      const version = {
        version_number: 1,
        finalized_by: "Synthetic clinician",
        finalized_at: "2026-10-25T09:00:00Z",
        items: record.medications,
      };
      body = {
        id: "synthetic-rx",
        current_version: version,
        versions: [version],
        created_at: "2026-10-25T09:00:00Z",
        status: "ACTIVE",
      };
    }
    await route.fulfill({ status, headers: cors, json: body });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/doctor$/);
  return state;
}

test("directory → compact context → dossier → selected consultation, with truthful unknown safety", async ({
  page,
}) => {
  const state = await recordServices(page);
  await page.setViewportSize({ width: 393, height: 1450 });
  await page.goto("/app/doctor/patients");
  await page.getByRole("link", { name: /Synthetic One/ }).click();
  await expect(page).toHaveURL(/\/context$/);
  await expect(
    page.getByText("Allergy status not confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Consent status unavailable", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-028-393.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review consent scope →" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "other specialties and external reports remain locked",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: "Open patient record", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));
  await expect(page.getByText("Penicillin", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Migraine", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("No current use confirmed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-029-393.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Begin consultation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/consultation\/synthetic-visit$/);
  expect(state.calls.filter((path) => path.includes("ai-assistance"))).toEqual(
    [],
  );
});

test("directory filters, search, creation link and direct prescription entry remain connected", async ({
  page,
}) => {
  const state = await recordServices(page);
  await page.setViewportSize({ width: 393, height: 1450 });
  await page.goto("/app/doctor/patients");
  await page.getByRole("button", { name: "upcoming", exact: true }).click();
  await expect
    .poll(() =>
      state.queries.some((query) => query.includes("filter=upcoming")),
    )
    .toBe(true);
  await page.getByRole("button", { name: "unclaimed", exact: true }).click();
  await expect
    .poll(() =>
      state.queries.some((query) => query.includes("filter=unclaimed")),
    )
    .toBe(true);
  await page.getByRole("button", { name: "recent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "recent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search patient directory").fill("Synthetic");
  await expect
    .poll(() => state.queries.some((query) => query.includes("q=Synthetic")))
    .toBe(true);
  await expect(
    page.getByRole("link", { name: "Add", exact: true }),
  ).toHaveAttribute("href", "/app/doctor/patients/new");
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-027-393.png",
    fullPage: true,
  });
  state.failDirectory = true;
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic directory unavailable" }),
  ).toBeVisible();
  state.failDirectory = false;
  await page.getByRole("button", { name: "Retry directory" }).click();
  await expect(page.getByRole("link", { name: /Synthetic One/ })).toBeVisible();
  await page.goto(`/app/doctor/patients/${patientId}`);
  await page
    .getByRole("button", { name: "Create prescription", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/prescription-drafts/new\\?encounterId=synthetic-new-encounter&patientId=${patientId}`,
    ),
  );
  await expect(page.getByLabel("Medicine name")).toBeVisible();
});

test("denied original source never displays the previous preview and can be retried", async ({
  page,
}) => {
  const state = await recordServices(page);
  await page.goto(`/app/doctor/patients/${patientId}`);
  state.failSource = true;
  await page.getByRole("button", { name: "Open report & source →" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic source denied",
  );
  await expect(page.getByRole("dialog").getByRole("img")).toHaveCount(0);
  await page.keyboard.press("Escape");
  state.failSource = false;
  await page.getByRole("button", { name: "Open report & source →" }).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
});

test("record section navigation, timeline, source and prescription history remain patient scoped", async ({
  page,
}) => {
  await recordServices(page);
  await page.goto(`/app/doctor/patients/${patientId}`);
  await page
    .getByRole("navigation", { name: "Patient record sections" })
    .getByRole("link", { name: "Reports", exact: true })
    .click();
  await expect(page).toHaveURL(/#reports$/);
  await page.getByRole("button", { name: "Open report & source →" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("img", { name: "Original synthetic.png" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open full timeline →" }).click();
  await expect(page.getByRole("dialog")).toContainText("PATIENT REPORTED");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open medication & prescription history →" })
    .click();
  const history = page.getByRole("dialog");
  await expect(history).toContainText("Current use not confirmed");
  await history
    .getByRole("link", { name: "Open original prescription" })
    .click();
  await expect(page).toHaveURL(/\/prescriptions\/synthetic-rx$/);
});

test("upload rejects a failed PUT and retries completion without repeating a successful PUT", async ({
  page,
}) => {
  const state = await recordServices(page);
  await page.goto(`/app/doctor/patients/${patientId}`);
  await page
    .getByRole("button", { name: "Upload record", exact: true })
    .click();
  await page.getByLabel("Document type").selectOption("LAB_REPORT");
  await page
    .getByLabel("Source document")
    .setInputFiles({
      name: "uploaded.png",
      mimeType: "image/png",
      buffer: Buffer.from("synthetic-file"),
    });
  state.failPut = true;
  await page.getByRole("button", { name: "Upload source document" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "file upload failed",
  );
  expect(state.methods).toEqual(["INIT", "PUT"]);
  state.failPut = false;
  state.failComplete = true;
  await page.getByRole("button", { name: "Upload source document" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic completion failed",
  );
  state.failComplete = false;
  await page.getByRole("button", { name: "Upload source document" }).click();
  await expect(page.getByRole("status")).toContainText("Uploaded uploaded.png");
  expect(state.methods).toEqual(["INIT", "PUT", "PUT", "COMPLETE", "COMPLETE"]);
  state.record.documents.find(
    (doc) => doc.document_id === "new-doc",
  )!.processing_status = "COMPLETE";
  await expect(page.getByText("PROCESSING", { exact: true })).toHaveCount(0, {
    timeout: 7000,
  });
});

test("empty, unclaimed and forbidden records have working exits and no invented facts", async ({
  page,
}) => {
  const state = await recordServices(page);
  state.visits = false;
  state.unclaimed = true;
  await page.goto(`/app/doctor/patients/${patientId}`);
  await expect(
    page.getByRole("button", { name: "Begin consultation", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Generate claim invite" }).click();
  await expect(page.getByText("SYNTHETIC-CODE")).toBeVisible();
  await page.goto(`/app/doctor/patients/${otherId}`);
  await expect(
    page.getByText("Synthetic allergy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No concern recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic medicine", { exact: true }),
  ).toHaveCount(0);
  state.deny = true;
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic forbidden record" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Synthetic Two", exact: true }),
  ).toHaveCount(0);
  state.deny = false;
  await page.getByRole("button", { name: "Retry record" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic Two", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to directory" }).click();
  await expect(page).toHaveURL(/\/patients$/);
});

for (const width of [320, 768, 1440]) {
  test(`record dialogs and compact context fit ${width}px with keyboard return`, async ({
    page,
  }) => {
    await recordServices(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/doctor/patients/${patientId}/context`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Open full timeline →" }).click();
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByRole("dialog")
          .evaluate((dialog) => dialog.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open full timeline →" }),
    ).toBeFocused();
  });
}
