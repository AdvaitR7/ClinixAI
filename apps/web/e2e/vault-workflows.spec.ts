import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const documentId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const reportId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const fieldId = "dcecc24a-d5b7-47f9-9c6d-07ab508b196c";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS" };

/** Builds a real, two-page PDF containing synthetic source text and no patient information. */
function syntheticPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 460] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 460] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...[1, 2].map((number) => {
      const content = `BT /F1 14 Tf 20 420 Td (SYNTHETIC LAB SOURCE - PAGE ${number}) Tj 0 -35 Td /F1 11 Tf (Vitamin D 24 ng/mL) Tj 0 -28 Td (Reference 30-100) Tj 0 -28 Td (Source content retained unchanged.) Tj ET`;
      return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

/** Shares isolated extraction, storage and correction state with the actual SDK/pages. */
function vaultState() {
  const observation = {
    id: fieldId, test_name: "Vitamin D", test_code: null, value_numeric: 24, value_text: null, unit: "ng/mL",
    reference_low: 30, reference_high: 100, reference_text: "30–100", flag: "LOW", observed_at: "2026-06-18T00:00:00Z", confidence: 0.4, needs_review: true, confirmed_at: null as string | null,
  };
  const report = {
    report_id: reportId, laboratory_name: "Synthetic Lab", collection_date: "2026-06-18", report_date: null,
    source_document_id: documentId, created_at: "2026-06-18T00:00:00Z", observations: [
      { ...observation, id: "hemoglobin", test_name: "Hemoglobin", value_numeric: 13.8, unit: "g/dL", reference_low: 12, reference_high: 16, reference_text: "12–16", flag: null, confidence: 0.99, needs_review: false },
      observation,
      { ...observation, id: "wbc", test_name: "WBC", value_numeric: 7.2, unit: "×10⁹/L", reference_low: 4, reference_high: 11, reference_text: "4–11", flag: null, confidence: 0.99, needs_review: false },
    ],
  };
  const doc = {
    document_id: documentId, document_type: "LAB_REPORT", original_filename: "Synthetic CBC + Vitamin D.pdf", mime_type: "application/pdf",
    file_size_bytes: syntheticPdf().length, processing_status: "NEEDS_REVIEW", created_at: "2026-06-18T00:00:00Z", view_url: null as string | null,
  };
  return {
    doc, report, observation, docs: [doc, { ...doc, document_id: "photo", original_filename: "Synthetic prescription.png", document_type: "PRESCRIPTION", mime_type: "image/png", processing_status: "COMPLETE" }, { ...doc, document_id: "receipt", original_filename: "Synthetic receipt.pdf", processing_status: "COMPLETE" }, { ...doc, document_id: "older", original_filename: "Synthetic older.pdf", processing_status: "COMPLETE" }],
    reportsReady: true, empty: false, failVault: false, failPut: false, failComplete: false, failSource: false, failDownload: false, failCorrection: false, failTrend: false, delayedSource: false, delayVitamin: false,
    methods: [] as string[], calls: [] as string[], patches: [] as Record<string, unknown>[], trendCalls: [] as string[],
  };
}

/** Authenticates a non-sensitive test account and routes external APIs to controlled HTTP fixtures. */
async function services(page: Page, state = vaultState(), role: "PATIENT" | "DOCTOR" = "PATIENT") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: patientId, aud: "authenticated", role: "authenticated", email: "synthetic-vault@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(), identities: [], is_anonymous: false };
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: patientId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ headers: cors, json: route.request().url().includes("/user") ? user : session }));
  await page.context().route("https://storage.example.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (route.request().method() === "PUT") {
      state.methods.push("PUT");
      return route.fulfill({ status: state.failPut ? 503 : 200, headers: cors, body: "" });
    }
    if (state.failDownload) return route.fulfill({ status: 403, headers: cors, body: "Synthetic expired source" });
    if (route.request().url().endsWith("photo")) return route.fulfill({ headers: cors, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=", "base64") });
    return route.fulfill({ headers: cors, contentType: "application/pdf", body: syntheticPdf() });
  });
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    state.calls.push(path);
    let status = 200;
    let body: unknown = {};
    if (path === "/me") body = { profile_id: patientId, role, patient_id: role === "PATIENT" ? patientId : null, doctor_id: role === "DOCTOR" ? patientId : null };
    else if (path === "/patients/self/dashboard") body = { upcoming_appointment: null, pending_followups: [], recent_timeline: [] };
    else if (path === "/doctor/dashboard") body = { incoming_requests: [], today_appointments: [], draft_queue: { pending: 0 }, followups_due: { due_today: 0, overdue: 0 } };
    else if (path.endsWith("/upload-init")) {
      state.methods.push("INIT");
      body = { document_id: "uploaded", upload_url: "https://storage.example.test/uploaded", token: "synthetic", path: "synthetic", expires_in: 7200 };
    } else if (path.endsWith("/upload-complete")) {
      state.methods.push("COMPLETE");
      if (state.failComplete) { status = 503; body = { error: { message: "Synthetic queue unavailable" } }; }
      else { state.doc.processing_status = "PROCESSING"; state.reportsReady = false; body = { ok: true }; }
    } else if (path === "/patients/self/documents") {
      if (state.failVault) { status = 503; body = { error: { message: "Synthetic vault unavailable" } }; }
      else body = state.empty ? [] : state.docs;
    } else if (path.startsWith("/patients/self/documents/")) {
      if (state.delayedSource) await new Promise((resolve) => setTimeout(resolve, 500));
      if (state.failSource) { status = 403; body = { error: { message: "Synthetic source access denied" } }; }
      else {
        const doc = state.docs.find((item) => item.document_id === path.split("/").at(-1));
        body = doc ? { ...doc, view_url: `https://storage.example.test/${doc.document_id}` } : {};
      }
    } else if (path === "/patients/self/lab-reports") body = state.empty || !state.reportsReady ? [] : [state.report];
    else if (path === "/patients/self/lab-observations" && request.method() === "GET") {
      const name = url.searchParams.get("test_name") ?? "";
      state.trendCalls.push(name);
      if (state.delayVitamin && name === "Vitamin D") await new Promise((resolve) => setTimeout(resolve, 650));
      if (state.failTrend) { status = 503; body = { error: { message: "Synthetic trend unavailable" } }; }
      else body = { test_name: name, points: [18, 22, name === "Vitamin D" ? state.observation.value_numeric : 13.8].map((value, index) => ({ observed_at: `2026-0${index + 1}-18T00:00:00Z`, value_numeric: value, report_id: reportId, confidence: 0.99 })) };
    } else if (path.includes("/lab-observations/") && request.method() === "PATCH") {
      const payload = request.postDataJSON(); state.patches.push(payload);
      if (state.failCorrection) { status = 503; body = { error: { message: "Synthetic correction unavailable" } }; }
      else { Object.assign(state.observation, payload, { needs_review: false, confirmed_at: "2026-10-26T00:00:00Z", flag: payload.value_numeric >= 30 ? null : "LOW" }); state.doc.processing_status = "COMPLETE"; body = state.observation; }
    } else if (path === "/patients/self/medications") body = { medications: [] };
    else if (["/patients/self/timeline", "/patients/self/appointments", "/patients/self/medications", "/doctors"].includes(path)) body = [];
    await route.fulfill({ status, headers: cors, json: body }).catch(() => {});
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(role === "PATIENT" ? /\/app\/patient$/ : /\/app\/doctor$/);
  return state;
}

/** Opens the actual file input and chooses a safe synthetic PDF. */
async function uploadFile(page: Page) {
  await page.getByRole("button", { name: "＋ Upload", exact: true }).click();
  await page.getByLabel("Select file (PNG, JPG, PDF)").setInputFiles({ name: "synthetic-two-page.pdf", mimeType: "application/pdf", buffer: syntheticPdf() });
}

/** Waits for a real page render, including its accessible original text. */
async function openSource(page: Page) {
  await page.getByRole("button", { name: /PDF Synthetic CBC/ }).click();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/SYNTHETIC LAB SOURCE - PAGE 1/)).toBeAttached();
}

test("SCR-013/014 match source structure and render, paginate, open and download the original source", async ({ page }) => {
  const state = await services(page);
  await page.setViewportSize({ width: 393, height: 980 });
  await page.goto("/app/patient/vault");
  await expect(page.getByText("4 source documents", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-013-393.png", fullPage: true });
  await openSource(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Previous source page" })).toBeDisabled();
  await page.screenshot({ path: "../../docs/architecture/evidence/implementation-scr-014-393.png" });
  await dialog.getByRole("button", { name: "Next source page" }).click();
  await expect(dialog.getByText("Page 2 of 2")).toBeVisible();
  await expect(dialog.getByText(/SYNTHETIC LAB SOURCE - PAGE 2/)).toBeAttached();
  await expect(dialog.getByRole("button", { name: "Next source page" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Previous source page" }).click();
  await expect(dialog.getByText("Page 1 of 2")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "OPEN ORIGINAL PDF" })).toHaveAttribute("href", `https://storage.example.test/${documentId}`);
  // This headless harness leaves native PDF tabs blank; verify the actual navigation request.
  const originalRequest = page.context().waitForEvent("request", (request) => request.isNavigationRequest() && request.url() === `https://storage.example.test/${documentId}`);
  const opened = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "OPEN ORIGINAL PDF" }).click();
  await originalRequest;
  const original = await opened;
  await original.close();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download source", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(state.doc.original_filename);
  expect(await readFile((await saved.path())!)).toEqual(syntheticPdf());
  await dialog.getByRole("button", { name: "View extracted observations →" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("region", { name: "Extracted observations", exact: true })).toBeFocused();
});

test("upload rejects failed PUTs, retries the same source and refreshes completed extraction and trends without reload", async ({ page }) => {
  const state = await services(page);
  state.reportsReady = false; state.doc.processing_status = "COMPLETE";
  await page.goto("/app/patient/vault");
  await uploadFile(page);
  state.failPut = true;
  await page.getByRole("button", { name: "Upload to vault", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "File upload failed (503)" })).toBeVisible();
  expect(state.methods).toEqual(["INIT", "PUT"]);
  state.failPut = false; state.failComplete = true;
  await page.getByRole("button", { name: "Upload to vault", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic queue unavailable" })).toBeVisible();
  expect(state.methods).toEqual(["INIT", "PUT", "PUT", "COMPLETE"]);
  state.failComplete = false;
  await page.getByRole("button", { name: "Upload to vault", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.methods).toEqual(["INIT", "PUT", "PUT", "COMPLETE", "COMPLETE"]);
  await expect(page.getByText("Extracting text…", { exact: true })).toBeVisible();
  state.doc.processing_status = "NEEDS_REVIEW"; state.reportsReady = true;
  await expect(page.getByRole("button", { name: "REVIEW", exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("row", { name: /Vitamin D/ })).toContainText("24 ng/mL");
  await expect(page.getByRole("img", { name: /Vitamin D recorded values/ })).toBeVisible();
});

test("low-confidence review preserves edits on error, confirms exact values and refreshes corrected trends and queue", async ({ page }) => {
  const state = await services(page);
  await page.goto("/app/patient/vault");
  await page.getByRole("button", { name: "REVIEW", exact: true }).click();
  const field = page.getByLabel("Correct Vitamin D value", { exact: true });
  await expect(page.getByRole("region", { name: "Extracted observations", exact: true })).toBeFocused();
  await field.fill("NaN");
  await page.getByRole("button", { name: "Confirm value", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "finite numeric" })).toBeVisible();
  expect(state.patches).toHaveLength(0);
  await field.fill("34"); state.failCorrection = true;
  await page.getByRole("button", { name: "Confirm value", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic correction unavailable" })).toBeVisible();
  await expect(field).toHaveValue("34");
  state.failCorrection = false;
  await page.getByRole("button", { name: "Confirm value", exact: true }).click();
  await expect(page.getByText("Patient confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("No documents awaiting processing or review.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Vitamin D recorded values: 18, 22, 34", exact: true })).toBeVisible();
  expect(state.patches.at(-1)).toEqual({ value_numeric: 34, confirmed: true });
});

test("all sources, images, close and Escape preserve keyboard focus; late source data never reopens a closed drawer", async ({ page }) => {
  const state = await services(page);
  await page.goto("/app/patient/vault");
  const all = page.getByRole("button", { name: "View all 4", exact: true });
  await all.click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(all).toBeFocused();
  await all.click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Synthetic older.pdf/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Synthetic prescription.png/ }).click();
  const image = page.getByRole("dialog").getByRole("img", { name: "Synthetic prescription.png", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(all).toBeFocused();
  state.delayedSource = true;
  await page.getByRole("button", { name: /PDF Synthetic CBC/ }).click();
  await page.getByRole("button", { name: "Close source preview", exact: true }).click();
  await expect(page.getByRole("button", { name: /PDF Synthetic CBC/ })).toBeFocused();
  await page.waitForTimeout(750);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Vault/source/trend failures are recoverable and different measurement responses stay isolated", async ({ page }) => {
  const state = await services(page); state.failVault = true;
  await page.goto("/app/patient/vault");
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic vault unavailable" })).toBeVisible();
  state.failVault = false;
  await page.getByRole("button", { name: "Retry vault", exact: true }).click();
  state.failSource = true;
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic source access denied" })).toBeVisible();
  state.failSource = false;
  await page.getByRole("button", { name: "Retry source", exact: true }).click();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  state.failDownload = true;
  await page.getByRole("button", { name: "Download source", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Download failed" })).toBeVisible();
  await page.keyboard.press("Escape");
  state.failTrend = true;
  await page.getByRole("button", { name: "Hemoglobin", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic trend unavailable" })).toBeVisible();
  state.failTrend = false;
  await page.getByRole("button", { name: "Retry trend", exact: true }).click();
  await expect(page.getByRole("img", { name: /Hemoglobin recorded values/ })).toBeVisible();
  state.delayVitamin = true;
  await page.getByRole("button", { name: "Vitamin D", exact: true }).click();
  await page.getByRole("button", { name: "WBC", exact: true }).click();
  await expect(page.getByRole("img", { name: /WBC recorded values/ })).toBeVisible();
  await page.waitForTimeout(750);
  await expect(page.getByRole("img", { name: /Vitamin D recorded values/ })).toHaveCount(0);
});

test("failed extraction uses existing upload completion retry and cannot display a fabricated percentage", async ({ page }) => {
  const state = await services(page); state.doc.processing_status = "FAILED";
  await page.goto("/app/patient/vault");
  await page.getByRole("button", { name: "Retry processing", exact: true }).click();
  await expect(page.getByText("Extracting text…", { exact: true })).toBeVisible();
  expect(state.methods).toEqual(["COMPLETE"]);
  state.doc.processing_status = "UPLOADED";
  state.failComplete = true;
  await page.goto("/app/patient/vault");
  await page.getByRole("button", { name: "Check uploaded file", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic queue unavailable" })).toBeVisible();
  state.failComplete = false;
  await page.getByRole("button", { name: "Check uploaded file", exact: true }).click();
  await expect(page.getByText("Extracting text…", { exact: true })).toBeVisible();
  expect(state.methods).toEqual(["COMPLETE", "COMPLETE", "COMPLETE"]);
  await expect(page.getByText(/68%|Encrypted|CONSENT ACTIVE/)).toHaveCount(0);
});

test("empty Vault, upload close, parent exit and all existing module connections remain usable", async ({ page }) => {
  const state = await services(page); state.empty = true;
  await page.goto("/app/patient/vault");
  await expect(page.getByText("0 source documents", { exact: true })).toBeVisible();
  await expect(page.getByText("No extracted lab observations yet.")).toBeVisible();
  await page.getByRole("button", { name: "＋ Upload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upload to vault", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "＋ Upload", exact: true })).toBeFocused();
  for (const [label, path] of [["Timeline", "timeline"], ["Visits", "appointments"], ["Medications", "medications"]]) {
    await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/patient/${path}$`));
    await expect(page.getByRole("heading", { name: label === "Timeline" ? "Health timeline" : label === "Visits" ? "Appointments" : "Medication history", exact: true })).toBeVisible();
    await page.goto("/app/patient/vault");
  }
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
});

test("report selection opens the selected source and mixed-unit values are not plotted together", async ({ page }) => {
  const state = await services(page);
  await page.route("http://127.0.0.1:4000/api/v1/patients/self/lab-reports", (route) => route.fulfill({ headers: cors, json: [state.report, { ...state.report, report_id: "report-two", source_document_id: "older", observations: [{ ...state.observation, id: "different-unit", value_numeric: 60, unit: "nmol/L" }] }] }));
  await page.goto("/app/patient/vault");
  await expect(page.getByText("These observations use different units.", { exact: false })).toBeVisible();
  await page.getByLabel("Select report", { exact: true }).selectOption("report-two");
  await expect(page.getByRole("heading", { name: "From Synthetic older.pdf", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Synthetic older.pdf", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "OPEN ORIGINAL PDF" })).toHaveAttribute("href", "https://storage.example.test/older");
});

test("protected Vault rejects a doctor account before requesting patient sources", async ({ page }) => {
  const state = await services(page, vaultState(), "DOCTOR");
  await page.goto("/app/patient/vault");
  await expect(page).toHaveURL(/\/app\/doctor$/);
  expect(state.calls.some((path) => path.includes("/patients/self/documents"))).toBe(false);
});

test("Vault and source drawer fit narrow/mobile/tablet/desktop and retain native dialog focus", async ({ page }) => {
  await services(page);
  for (const width of [320, 393, 768, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    await page.goto("/app/patient/vault");
    await expect(page.getByText("4 source documents", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openSource(page);
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(width);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 2 === 0 ? "Tab" : "Shift+Tab");
      expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /PDF Synthetic CBC/ })).toBeFocused();
  }
});


test("source PDF loading errors retry against original bytes rather than fabricating page count", async ({ page }) => {
  const state = await services(page); state.failDownload = true;
  await page.goto("/app/patient/vault");
  await page.getByRole("button", { name: /PDF Synthetic CBC/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The source could not be loaded" })).toBeVisible();
  await expect(page.getByText("Page count unavailable", { exact: true })).toBeVisible();
  state.failDownload = false;
  await page.getByRole("button", { name: "Retry PDF preview", exact: true }).click();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/SYNTHETIC LAB SOURCE - PAGE 1/)).toBeAttached();
});


test("image access errors refresh the signed source and recover the actual image", async ({ page }) => {
  const state = await services(page); state.failDownload = true;
  await page.goto("/app/patient/vault");
  await page.getByRole("button", { name: /PHOTO Synthetic prescription/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Image preview unavailable" })).toBeVisible();
  state.failDownload = false;
  await page.getByRole("button", { name: "Retry image preview", exact: true }).click();
  const image = page.getByRole("dialog").getByRole("img", { name: "Synthetic prescription.png", exact: true });
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
