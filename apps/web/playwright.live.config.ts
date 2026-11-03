import { defineConfig, devices } from "@playwright/test";

/**
 * Live smoke run: no mocks. Start the real stack first (`./run.sh`: web :12455, API :12456) and set
 * LIVE_DOCTOR_EMAIL / LIVE_PATIENT_EMAIL / LIVE_STAFF_EMAIL / LIVE_PASSWORD to the synthetic seed accounts.
 *
 *   npx playwright test -c playwright.live.config.ts
 */
export default defineConfig({
  testDir: "./e2e-live",
  workers: 1,
  timeout: 90_000,
  use: { baseURL: process.env.LIVE_WEB_URL ?? "http://localhost:12455", ...devices["Desktop Chrome"] },
});
