import { expect, test } from "@playwright/test";

test("existing sign-in shell renders email/password auth", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
});

test("sign-up and recovery routes use static app paths", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("sign-up rejects mismatched passwords without calling auth", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill("synthetic@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
});

test("callback reports an expired or missing email verifier safely", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page.getByRole("status")).toContainText("invalid or has expired");
  await expect(page.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/sign-in");
});
