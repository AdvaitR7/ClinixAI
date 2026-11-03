import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Unmocked smoke test: signs in as each synthetic role against the running stack, opens every static
 * page for that role and fails on any failed /api/v1 response or uncaught browser error.
 * Routes with a dynamic [id] segment need seeded record ids and are not covered here.
 */

const API_URL = process.env.LIVE_API_URL ?? "http://localhost:12456/api/v1";
const PASSWORD = process.env.LIVE_PASSWORD;

const ROLES = [
  { role: "doctor", email: process.env.LIVE_DOCTOR_EMAIL },
  { role: "patient", email: process.env.LIVE_PATIENT_EMAIL },
  { role: "staff", email: process.env.LIVE_STAFF_EMAIL },
] as const;

/** Lists page routes under src/app/app/<role> that contain no dynamic [param] segment. */
function staticRoutes(role: string): string[] {
  const root = path.join(__dirname, "..", "src", "app", "app", role);
  const routes: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith("[")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${route}/${entry}`);
      else if (entry === "page.tsx") routes.push(route);
    }
  };
  walk(root, `/app/${role}`);
  return routes.sort();
}

/** Signs in through the real form and waits for the workspace to load. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
}

for (const { role, email } of ROLES) {
  test.describe(`live ${role}`, () => {
    test.skip(!email || !PASSWORD, `set LIVE_${role.toUpperCase()}_EMAIL and LIVE_PASSWORD`);

    test("every static page loads without API or console errors", async ({ page }) => {
      const problems: string[] = [];
      page.on("response", (res) => {
        if (res.url().startsWith(API_URL) && res.status() >= 400) {
          problems.push(`${res.status()} ${res.request().method()} ${res.url().replace(API_URL, "")}`);
        }
      });
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) {
          problems.push(`console: ${msg.text()}`);
        }
      });

      await signIn(page, email!, PASSWORD!);
      for (const route of staticRoutes(role)) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test("the browser may send PUT, PATCH and DELETE to the API (CORS preflight)", async ({ page }) => {
      await signIn(page, email!, PASSWORD!);
      // A 404 from a missing route is fine; a blocked preflight makes fetch throw instead.
      const outcomes = await page.evaluate(async (api) => {
        const results: Record<string, string> = {};
        for (const method of ["PUT", "PATCH", "DELETE"]) {
          try {
            const res = await fetch(`${api}/__cors_probe__`, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
            results[method] = `status ${res.status}`;
          } catch (err) {
            results[method] = `blocked: ${(err as Error).message}`;
          }
        }
        return results;
      }, API_URL);
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        expect(outcomes[method], `${method} preflight`).toMatch(/^status /);
      }
    });
  });
}
