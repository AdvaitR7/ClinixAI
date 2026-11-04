import { expect, test, type Page } from "@playwright/test";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS" };
const doctorId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";

/** Uses synthetic HTTP boundaries to run the real SDK, route guards, pages and dialogs. */
async function gateServices(page: Page, source: "OCR" | "DIRECT_ENTRY" = "OCR") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: doctorId, aud: "authenticated", role: "authenticated", email: "synthetic-clinician@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };

  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: doctorId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`, refresh_token: "synthetic-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  const state = {
    source,
    items: (source === "OCR"
      ? [
          { id: "i1", sequence_number: 1, medicine_name: "Naproxen", dose: "5? mg", frequency: "Twice daily", needs_review: true, field_confidence: { confidence: 0.86 } },
          { id: "i2", sequence_number: 2, medicine_name: "Second medicine", needs_review: true, field_confidence: { confidence: 0.41 } },
        ]
      : [{ id: "i1", sequence_number: 1, medicine_name: "Amoxicillin", dose: "500 mg", needs_review: false, field_confidence: null }]) as { id: string; sequence_number: number; medicine_name: string; dose?: string; frequency?: string; needs_review: boolean; field_confidence: { confidence: number } | null }[],
    failSource: false,
    failWorkspace: false,
    rejectReview: false,
    events: [] as string[],
    patches: [] as { medicine_name: string; reviewed?: boolean }[][],
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
    const draft = { id: "synthetic-draft", patient_id: patientId, encounter_id: "synthetic-encounter", doctor_id: doctorId, patient_name: "Synthetic Patient", source: state.source, status: "DRAFT", source_document_id: state.source === "OCR" ? "synthetic-doc" : null, overall_confidence: 0.86, risk_flags: state.source === "OCR" ? ["handwriting unclear"] : [], items: state.items };
    let body: unknown = {};
    let status = 200;
    if (path === "/me") body = { profile_id: doctorId, role: "DOCTOR", patient_id: null, doctor_id: doctorId, verification_status: "VERIFIED" };
    else if (path === "/doctor/dashboard") body = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path === "/doctor/documents/synthetic-doc") {
      if (state.failSource) { status = 503; body = { error: { code: "UNAVAILABLE", message: "Synthetic source unavailable" } }; }
      else body = { id: "synthetic-doc", mime_type: "application/pdf", view_url: "http://127.0.0.1:4000/source.pdf" };
    } else if (path === `/doctor/patients/${patientId}/workspace`) {
      if (state.failWorkspace) { status = 503; body = { error: { code: "UNAVAILABLE", message: "Synthetic context unavailable" } }; }
      else body = { medications: [{ medicine_name: "Metformin", dose: "500 mg", frequency: "Daily", status: "CURRENT", entry_id: "m1" }, { medicine_name: "Old drug", status: "PAST", entry_id: "m2" }] };
    } else if (path === "/doctor/encounters/synthetic-encounter/prescription-drafts" && method === "POST") {
      state.events.push("create");
      state.source = "DIRECT_ENTRY";
      state.items = request.postDataJSON().items.map((item: object, index: number) => ({ id: `i${index}`, sequence_number: index + 1, needs_review: false, field_confidence: null, ...item }));
      status = 201; body = { id: "synthetic-draft" };
    } else if (path === "/doctor/prescription-drafts/synthetic-draft") {
      if (method === "PATCH") {
        const sent = request.postDataJSON().items as { medicine_name: string; dose?: string; reviewed?: boolean }[];
        state.patches.push(sent);
        state.events.push("save");
        state.items = sent.map((item, index) => {
          const prior = state.items.find((row) => row.medicine_name === item.medicine_name && row.dose === item.dose);
          const { reviewed, ...fields } = item;
          return { ...fields, id: `i${index}`, sequence_number: index + 1, needs_review: state.source === "DIRECT_ENTRY" ? false : reviewed ? false : prior ? prior.needs_review : true, field_confidence: prior?.field_confidence ?? null };
        });
        body = { ok: true };
      } else body = draft;
    } else if (path.endsWith("/finalize")) {
      state.events.push("finalize");
      if (state.rejectReview) { status = 409; body = { error: { code: "REVIEW_REQUIRED", message: "Synthetic server review gate" } }; }
      else body = { id: "synthetic-prescription" };
    } else if (path === "/doctor/prescriptions/synthetic-prescription") {
      const version = { version_number: 1, finalized_by: "Synthetic Clinician", finalized_at: "2026-10-25T09:00:00Z", amendment_reason: null, items: state.items };
      body = { id: "synthetic-prescription", patient_id: patientId, doctor_id: doctorId, status: "ACTIVE", created_at: "2026-10-25T09:00:00Z", current_version: version, versions: [version] };
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

const alertLocator = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const draftUrl = "/app/doctor/prescription-drafts/by-id?draftId=synthetic-draft";
const finalize = (page: Page) => page.getByRole("button", { name: "Finalize prescription", exact: true });

test("SCR-033 shows source recovery, safety context and blocks finalization until flagged lines are confirmed", async ({ page }) => {
  const state = await gateServices(page);
  state.failSource = true;
  await page.setViewportSize({ width: 393, height: 1260 });
  await page.goto(draftUrl);
  await expect(alertLocator(page).filter({ hasText: "Source unavailable" })).toBeVisible();
  state.failSource = false;
  await page.getByRole("button", { name: "Retry source" }).click();
  await expect(page.getByRole("link", { name: "Open original source →" })).toHaveAttribute("href", "http://127.0.0.1:4000/source.pdf");

  const safety = page.getByRole("region", { name: "Safety context" });
  await expect(safety).toContainText("Allergy data unavailable");
  await expect(safety).toContainText("Metformin · 500 mg · Daily");
  await expect(safety).not.toContainText("Old drug");
  await expect(safety).toContainText("OCR confidence86%");
  await expect(safety).toContainText("handwriting unclear");
  await expect(safety).toContainText("No interaction or dose-range check is performed");
  await expect(page.getByText(/Ambiguous · Confidence 41%/)).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-033-393.png", fullPage: true });

  await finalize(page).click();
  await expect(alertLocator(page)).toHaveText("Confirm 2 flagged medicines against the source before finalizing.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("I checked medication 1 against the source").check();
  await finalize(page).click();
  await expect(alertLocator(page)).toHaveText("Confirm 1 flagged medicine against the source before finalizing.");
  await page.getByLabel("I checked medication 2 against the source").check();
  await finalize(page).click();
  const review = page.getByRole("dialog", { name: "Finalize prescription?" });
  await expect(review).toBeVisible();
  expect(state.patches.map((sent) => sent.map((item) => item.reviewed))).toEqual([[false, false], [true, false], [undefined, true]]);

  const confirm = review.getByRole("button", { name: "Finalize prescription", exact: true });
  await expect(confirm).toBeDisabled();
  await review.getByLabel("Medicines match the original source").check();
  await review.getByLabel("Allergies and current medicines reviewed with the patient").check();
  await expect(confirm).toBeDisabled();
  await review.getByLabel("Printable preview checked").check();
  await expect(review.getByRole("link", { name: "Open full printable preview →" })).toHaveAttribute("target", "_blank");
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-035-393.png" });
  state.rejectReview = true;
  await confirm.click();
  await expect(alertLocator(page).filter({ hasText: "Synthetic server review gate" })).toBeVisible();
  await expect(page).toHaveURL(/\/prescription-drafts\/by-id\?draftId=synthetic-draft$/);
  state.rejectReview = false;
  await finalize(page).click();
  await review.getByLabel("Medicines match the original source").check();
  await review.getByLabel("Allergies and current medicines reviewed with the patient").check();
  await review.getByLabel("Printable preview checked").check();
  await review.getByRole("button", { name: "Finalize prescription", exact: true }).click();
  await expect(page).toHaveURL(/\/prescriptions\/by-id\?prescriptionId=synthetic-prescription$/);
});

test("editing a confirmed extracted line requires confirming it again, and a context failure is recoverable", async ({ page }) => {
  const state = await gateServices(page);
  state.failWorkspace = true;
  await page.goto(draftUrl);
  await expect(alertLocator(page).filter({ hasText: "Synthetic context unavailable" })).toBeVisible();
  state.failWorkspace = false;
  await page.getByRole("button", { name: "Retry medicine context" }).click();
  await expect(page.getByRole("region", { name: "Safety context" })).toContainText("Metformin");
  await page.getByLabel("I checked medication 1 against the source").check();
  await page.getByLabel("Dose (e.g. 1 tab)").first().fill("500 mg");
  await expect(page.getByLabel("I checked medication 1 against the source")).not.toBeChecked();
});

test("SCR-033/034 PREVIEW saves the current edits and shows a printable, clearly non-final copy", async ({ page }) => {
  const state = await gateServices(page, "DIRECT_ENTRY");
  await page.goto(draftUrl);
  await page.getByLabel("Dose (e.g. 1 tab)").fill("250 mg");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page).toHaveURL(/\/prescription-drafts\/by-id\/preview\?draftId=synthetic-draft$/);
  const sheet = page.getByRole("article", { name: "Printable prescription preview" });
  await expect(sheet).toContainText("Draft preview — not a finalized prescription");
  await expect(sheet).toContainText("Amoxicillin");
  await expect(sheet).toContainText("250 mg");
  await expect(page.getByRole("button", { name: "Print preview" })).toBeVisible();
  expect(state.events).toEqual(["save"]);
  await page.getByRole("link", { name: "Back to draft" }).click();
  await expect(page).toHaveURL(/\/prescription-drafts\/by-id\?draftId=synthetic-draft$/);
  await expect(page.getByLabel("Dose (e.g. 1 tab)")).toHaveValue("250 mg");
});

test("SCR-034 direct entry offers PREVIEW and FINALIZE, with free-text route/frequency/timing suggestions", async ({ page }) => {
  const state = await gateServices(page, "DIRECT_ENTRY");
  const url = `/app/doctor/prescription-drafts/new?encounterId=synthetic-encounter&patientId=${patientId}`;
  await page.goto(url);
  await page.getByLabel("Medicine name").fill("Paracetamol");
  await expect(page.getByLabel("Route (e.g. Oral)")).toHaveAttribute("list", /options$/);
  await page.getByLabel("Route (e.g. Oral)").fill("Sublingual");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page).toHaveURL(/\/prescription-drafts\/by-id\/preview\?draftId=synthetic-draft$/);
  await expect(page.getByRole("article", { name: "Printable prescription preview" })).toContainText("Sublingual");

  await page.goto(url);
  await page.getByLabel("Medicine name").fill("Paracetamol");
  await finalize(page).click();
  await expect(page.getByRole("dialog", { name: "Finalize prescription?" })).toBeVisible();
  expect(state.events).toEqual(["create", "create", "save"]);
  expect(state.events).not.toContain("finalize");
  await page.getByRole("button", { name: "Return to draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [320, 768, 1440]) test(`prescription draft, final review and preview fit ${width}px`, async ({ page }) => {
  await gateServices(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(draftUrl);
  await expect(page.getByRole("region", { name: "Safety context" })).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await fits()).toBe(true);
  await page.getByLabel("I checked medication 1 against the source").check();
  await page.getByLabel("I checked medication 2 against the source").check();
  await finalize(page).click();
  const review = page.getByRole("dialog", { name: "Finalize prescription?" });
  for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); expect(await review.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true); }
  expect(await fits()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(finalize(page)).toBeFocused();
  await page.goto("/app/doctor/prescription-drafts/by-id/preview?draftId=synthetic-draft");
  await expect(page.getByRole("article", { name: "Printable prescription preview" })).toBeVisible();
  expect(await fits()).toBe(true);
});
