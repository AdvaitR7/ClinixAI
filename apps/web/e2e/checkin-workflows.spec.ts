import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const patientId = "fdd87f59-23b7-4472-8fca-79cfad6a592d";
const encounterId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const interactionId = "b7b33529-904e-44d4-93b0-3c32c69c4651";
const sessionId = "d01fc949-f7d5-44cb-b7e9-7804e83cff38";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
const alert = {
  severity: "CRITICAL",
  action: "BLOCK_NORMAL_FLOW",
  triggered_rule_ids: ["SYNTHETIC"],
  message: "Synthetic urgent signal requires assessment",
  emergency_number: "112 / 108",
};
const blocks = [
  {
    id: "31ee236b-20fe-4167-902d-1b6cc571ce96",
    sequence_number: 1,
    block_type: "single_select",
    title: "How long have you had this symptom?",
    help_text: "Select the closest answer.",
    options: [
      { id: "short", label: "Less than 24 hours" },
      { id: "days", label: "1–3 days" },
      { id: "week", label: "4–7 days" },
      { id: "longer", label: "More than a week" },
      { id: "other", label: "Something else" },
    ],
    allow_free_text: true,
  },
  {
    id: "9ae75ceb-b4dc-45b6-8cf1-c505fc0ac50b",
    sequence_number: 2,
    block_type: "single_select",
    title: "How severe is it?",
    help_text: "Select the closest answer.",
    options: [
      { id: "mild", label: "Mild" },
      { id: "other", label: "Something else" },
    ],
    allow_free_text: true,
  },
  {
    id: "0b442fe8-113b-4949-bb8a-f1e100f50469",
    sequence_number: 3,
    block_type: "single_select",
    title: "Any other symptoms?",
    help_text: "Select the closest answer.",
    options: [
      { id: "none", label: "No other symptoms" },
      { id: "other", label: "Something else" },
    ],
    allow_free_text: true,
  },
];

/** Uses controlled HTTP services to verify real auth guards, screens, native dialogs and downloads. */
async function checkinServices(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: patientId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic-checkin@example.test",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString(),
    identities: [],
    is_anonymous: false,
  };
  const auth = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: patientId, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  const state = {
    concern: "Synthetic concern",
    step: 1,
    interactionStatus: "IN_PROGRESS",
    disposition: "SELF_CARE",
    aiStatus: "SUCCEEDED",
    noOutcome: false,
    failAnalysis: false,
    failResult: false,
    failEvidence: false,
    initialEmergency: false,
    answers: new Map<
      number,
      { selectedOptionIds: string[]; freeText: string | null }
    >(),
    calls: [] as string[],
    submissions: [] as Record<string, unknown>[],
    creates: 0,
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) =>
    route.fulfill({
      headers: cors,
      json: route.request().url().includes("/user") ? user : auth,
    }),
  );
  await page.route("http://127.0.0.1:4000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    state.calls.push(path);
    let status = 200;
    let body: unknown = {};
    const outcome = {
      disposition: state.disposition,
      requires_urgent_escalation: state.disposition === "URGENT",
      requires_doctor_review: state.disposition === "DOCTOR_REVIEW",
      summary:
        state.disposition === "URGENT"
          ? "Get urgent medical help now."
          : state.disposition === "DOCTOR_REVIEW"
            ? "A doctor should review this check-in."
            : "Self-care guidance is available for this check-in.",
      low_risk_guidance:
        state.disposition === "URGENT" ? [] : ["Record symptom changes"],
      uncertainty_level: state.disposition === "SELF_CARE" ? "LOW" : "HIGH",
      questions_for_doctor: ["Discuss symptom changes"],
      historical_matches: [],
      statutory_warning: "Prior treatment is not authorization for reuse.",
    };
    if (path === "/me")
      body = {
        profile_id: patientId,
        role: "PATIENT",
        patient_id: patientId,
        doctor_id: null,
      };
    else if (path === "/patients/self/dashboard")
      body = {
        upcoming_appointment: null,
        pending_followups: [],
        recent_timeline: [],
      };
    else if (path === "/patients/self/encounters") {
      state.creates++;
      state.concern = request.postDataJSON().chief_concern;
      body = { encounter_id: encounterId };
    } else if (path.endsWith("/interaction/start")) {
      if (state.initialEmergency) state.interactionStatus = "ESCALATED";
      body = {
        interaction_session_id: interactionId,
        status: state.initialEmergency
          ? "SAFETY_ESCALATION"
          : "NEEDS_MORE_INFORMATION",
        safety_alert: state.initialEmergency ? alert : undefined,
        next_block: blocks[0],
        total_steps: 3,
      };
    } else if (path === `/interactions/${interactionId}`)
      body = {
        session: {
          id: interactionId,
          encounterId,
          status: state.interactionStatus,
          currentStep: state.step,
        },
        chief_concern: state.concern,
        total_steps: 3,
        history: blocks
          .slice(0, state.initialEmergency ? 0 : state.step)
          .map((block) => ({
            block,
            answer: state.answers.get(block.sequence_number) ?? null,
          })),
        safety_alert: state.interactionStatus === "ESCALATED" ? alert : null,
      };
    else if (path.endsWith("/responses")) {
      const submitted = request.postDataJSON();
      state.submissions.push(submitted);
      const block = blocks.find((b) => b.id === submitted.block_id)!;
      state.answers.set(block.sequence_number, {
        selectedOptionIds: submitted.selected_option_ids,
        freeText: submitted.free_text,
      });
      if (submitted.free_text?.includes("urgent")) {
        state.interactionStatus = "ESCALATED";
        body = { status: "SAFETY_ESCALATION", safety_alert: alert };
      } else if (block.sequence_number === 3) {
        state.interactionStatus = "COMPLETED";
        body = { status: "READY_FOR_ANALYSIS" };
      } else {
        state.step = block.sequence_number + 1;
        body = {
          status: "NEEDS_MORE_INFORMATION",
          next_block: blocks[state.step - 1],
        };
      }
    } else if (path.endsWith("/ai-analysis")) {
      if (state.failAnalysis) {
        status = 503;
        body = {
          error: {
            code: "ANALYSIS_UNAVAILABLE",
            message: "Synthetic queue offline; answers saved",
          },
        };
      } else body = { ai_session_id: sessionId, status: "QUEUED" };
    } else if (path.endsWith("/evidence")) {
      if (state.failEvidence) {
        status = 503;
        body = { error: { message: "Synthetic evidence unavailable" } };
      } else
        body = {
          ai_session_id: sessionId,
          sources: [
            {
              resource_type: "CURRENT_CONCERN",
              resource_id: encounterId,
              description: state.concern,
              date: null,
            },
            {
              resource_type: "PATIENT_ANSWER",
              resource_id: "answer",
              description: "How long?: 1–3 days",
              date: null,
            },
            {
              resource_type: "LAB_REPORT",
              resource_id: "lab-0",
              description: "Synthetic linked lab: 7 units",
              date: "2026-10-25T09:00:00Z",
            },
          ],
        };
    } else if (path.startsWith("/ai-sessions/")) {
      if (state.failResult) {
        status = 404;
        body = { error: { message: "Synthetic result not found" } };
      } else
        body = {
          ai_session_id: sessionId,
          encounter_id: encounterId,
          status: state.aiStatus,
          outcome: state.noOutcome ? null : outcome,
          started_at: "2026-10-25T09:00:00Z",
          completed_at: "2026-10-25T09:01:00Z",
        };
    } else if (path === "/patients/self/timeline")
      body = {
        entries: [
          {
            id: "ai-entry",
            type: "AI_CHECKIN",
            title: "Synthetic concern check-in",
            summary: outcome.summary,
            timestamp: "2026-10-25T09:01:00Z",
            date_formatted: "25 OCT",
            chapter: "OCTOBER 2026",
            provenance: "AI_DERIVED",
            is_ai_derived: true,
            metadata: { ai_session_id: sessionId, encounter_id: encounterId },
          },
        ],
      };
    else if (
      [
        "/doctors",
        "/patients/self/documents",
        "/patients/self/lab-reports",
      ].includes(path)
    )
      body = [];
    await route.fulfill({ status, headers: cors, json: body });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
  return state;
}

test("SCR-008 restores real questions and answers, resumes after reload, retries analysis without replaying responses", async ({
  page,
}) => {
  const state = await checkinServices(page);
  await page.setViewportSize({ width: 393, height: 980 });
  await page.goto("/app/patient/checkin");
  await page.getByLabel("Current symptom or concern").fill("Synthetic concern");
  await page.getByRole("button", { name: "START ASSESSMENT" }).click();
  await expect(page.getByText("STEP 1 OF 3")).toBeVisible();
  await page.getByRole("button", { name: "1–3 days" }).click();
  await expect(page.getByRole("button", { name: "1–3 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-008-393.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How severe is it?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "BACK", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How long have you had this symptom?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "1–3 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "View basis" }).click();
  await expect(
    page.getByText(/part of the configured check-in sequence/),
  ).toBeVisible();
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "How severe is it?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Something else" }).click();
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText(
    "select an answer",
  );
  await page
    .getByLabel("Describe in your own words")
    .fill("Synthetic manageable symptoms");
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await page.getByRole("button", { name: "No other symptoms" }).click();
  state.failAnalysis = true;
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText(
    "queue offline",
  );
  const count = state.submissions.length;
  state.failAnalysis = false;
  await page.getByRole("button", { name: "START ANALYSIS" }).click();
  await expect(page).toHaveURL(new RegExp(`/checkin/result/${sessionId}$`));
  await expect(
    page.getByRole("heading", { name: "Check-in complete" }),
  ).toBeVisible();
  expect(state.creates).toBe(1);
  expect(state.submissions).toHaveLength(count);
  await page.getByRole("link", { name: "BOOK DOCTOR", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/book\?encounterId=/);
});

test("SCR-009 answer review and reload preserve safety actions and never resume analysis", async ({
  page,
}) => {
  const state = await checkinServices(page);
  await page.setViewportSize({ width: 393, height: 980 });
  await page.goto("/app/patient/checkin");
  await page.getByLabel("Current symptom or concern").fill("Synthetic concern");
  await page.getByRole("button", { name: "START ASSESSMENT" }).click();
  await page.getByRole("button", { name: "Something else" }).click();
  await page
    .getByLabel("Describe in your own words")
    .fill("Synthetic urgent answer");
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Get urgent medical help now" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-009-393.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("link", { name: "CALL EMERGENCY SERVICES" }),
  ).toHaveAttribute("href", "tel:112");
  await expect(
    page.getByRole("link", { name: "FIND NEAREST EMERGENCY DEPARTMENT" }),
  ).toHaveAttribute("target", "_blank");
  const review = page.getByRole("button", {
    name: "Review the answers that triggered this alert",
  });
  await review.click();
  const dialog = page.getByRole("dialog", {
    name: "Answers for this safety alert",
  });
  await expect(dialog).toContainText("Synthetic urgent answer");
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
  await expect(
    page.getByRole("button", { name: "CONTINUE", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Get urgent medical help now" }),
  ).toBeVisible();
  expect(state.calls.some((path) => path.endsWith("/ai-analysis"))).toBe(false);
});

test("SCR-009 restores an interrupt before the first question", async ({
  page,
}) => {
  const state = await checkinServices(page);
  state.initialEmergency = true;
  await page.goto("/app/patient/checkin");
  await page
    .getByLabel("Current symptom or concern")
    .fill("Synthetic urgent initial concern");
  await page.getByRole("button", { name: "START ASSESSMENT" }).click();
  await expect(
    page.getByRole("heading", { name: "Get urgent medical help now" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Get urgent medical help now" }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic urgent initial concern", { exact: true }),
  ).toBeVisible();
});

test("SCR-010 evidence retry, scoped export, timeline detail and cross-module exits work", async ({
  page,
}) => {
  const state = await checkinServices(page);
  state.failEvidence = true;
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto(`/app/patient/checkin/result/${sessionId}`);
  await expect(page.getByText("SAVED TO RECORD · VIEW TIMELINE")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SHARE WITH DOCTOR", exact: true }),
  ).toHaveAttribute("href", "/app/patient/care");
  const basis = page.getByRole("button", { name: "View result basis" });
  await basis.click();
  const dialog = page.getByRole("dialog", { name: "Result basis" });
  await expect(dialog).toContainText("Synthetic evidence unavailable");
  state.failEvidence = false;
  await dialog.getByRole("button", { name: "Retry evidence" }).click();
  await expect(dialog).toContainText("How long?: 1–3 days");
  await page.keyboard.press("Escape");
  await expect(basis).toBeFocused();
  await expect(
    page.getByText("Synthetic linked lab: 7 units", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Recent CBC", { exact: true })).toHaveCount(0);
  await page
    .getByRole("heading", { name: "Check-in complete", exact: true })
    .click();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-010-393.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "What sharing includes" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sharing scope" }),
  ).toContainText("Nothing is shared yet");
  await page.keyboard.press("Escape");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD RESULT" }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.outcome.disposition).toBe("SELF_CARE");
  expect(exported.evidence).toHaveLength(3);
  expect(exported).not.toHaveProperty("consent");
  await page
    .getByRole("link", { name: "SAVED TO RECORD · VIEW TIMELINE" })
    .click();
  await page.getByRole("link", { name: "View details & sources →" }).click();
  await expect(page).toHaveURL(new RegExp(`/timeline/checkins/${sessionId}$`));
  await expect(
    page.getByRole("heading", { name: "Check-in record" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/architecture/evidence/implementation-scr-012-393.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Check-in answers/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Check-in answers" }),
  ).toContainText("How long?: 1–3 days");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Close", exact: true }),
  ).toHaveAttribute("href", "/app/patient/timeline");
  await expect(
    page.getByRole("link", { name: "Back to timeline", exact: true }),
  ).toHaveAttribute("href", "/app/patient/timeline");
  await page.getByRole("link", { name: "Open full result →" }).click();
  await expect(page).toHaveURL(new RegExp(`/checkin/result/${sessionId}$`));
  await page.getByRole("link", { name: "Review reports →" }).click();
  await expect(page).toHaveURL(/\/app\/patient\/vault$/);
});

test("checked urgent and review outcomes never render unconditional low-risk reassurance", async ({
  page,
}) => {
  const state = await checkinServices(page);
  state.disposition = "URGENT";
  await page.goto(`/app/patient/checkin/result/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Get urgent medical help now" }),
  ).toBeVisible();
  await expect(
    page.getByText(/LOW RISK|no red-flag|Self-care is appropriate/),
  ).toHaveCount(0);
  state.disposition = "DOCTOR_REVIEW";
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "A doctor should review this check-in.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Uncertainty: high.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/LOW RISK|no red-flag/)).toHaveCount(0);
});

test("pending, denied, legacy and failed results expose safe recovery without fabricated content", async ({
  page,
}) => {
  const state = await checkinServices(page);
  state.aiStatus = "RUNNING";
  await page.goto(`/app/patient/checkin/result/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Preparing your check-in result…" }),
  ).toBeVisible();
  state.aiStatus = "SUCCEEDED";
  await expect(
    page.getByRole("heading", { name: "Check-in complete" }),
  ).toBeVisible();
  state.failResult = true;
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText(
    "result not found",
  );
  state.failResult = false;
  await page.getByRole("button", { name: "Retry status" }).click();
  await expect(
    page.getByRole("heading", { name: "Check-in complete" }),
  ).toBeVisible();
  state.noOutcome = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Check-in result unavailable" }),
  ).toBeVisible();
  await expect(page.getByText(/LOW RISK|Recent CBC|Vitamin D/)).toHaveCount(0);
  state.noOutcome = false;
  state.aiStatus = "FAILED";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Check-in result unavailable" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Dashboard" }).click();
  await expect(page).toHaveURL(/\/app\/patient$/);
});

for (const width of [320, 768, 1440])
  test(`check-in/result/detail preserve fit and keyboard dialog focus at ${width}px`, async ({
    page,
  }) => {
    await checkinServices(page);
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      `/app/patient/checkin/result/${sessionId}`,
      `/app/patient/timeline/checkins/${sessionId}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    const answers = page.getByRole("button", { name: /Check-in answers/ });
    await answers.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Check-in answers" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(answers).toBeFocused();
  });

test("SCR-012 entry and answer errors retry the selected session without exposing stale content", async ({
  page,
}) => {
  const state = await checkinServices(page);
  state.failResult = true;
  state.failEvidence = true;
  await page.goto(`/app/patient/timeline/checkins/${sessionId}`);
  await expect(
    page.getByRole("alert").filter({ hasText: /result not found/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Check-in record" }),
  ).toHaveCount(0);
  state.failResult = false;
  await page.getByRole("button", { name: "Retry entry" }).click();
  await expect(
    page.getByRole("heading", { name: "Check-in record" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Check-in answers/ }).click();
  const dialog = page.getByRole("dialog", { name: "Check-in answers" });
  await expect(dialog).toContainText("Synthetic evidence unavailable");
  state.failEvidence = false;
  await dialog.getByRole("button", { name: "Retry answers" }).click();
  await expect(dialog).toContainText("How long?: 1–3 days");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/patient\/timeline$/);
});
