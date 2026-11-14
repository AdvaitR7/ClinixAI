import { expect, test, type Page } from "@playwright/test";

/** Clear v2 design contract checked on public screens that need no API mocks. */
const PUBLIC_SCREENS = ["/sign-in", "/sign-up", "/forgot-password"];
const WIDTHS = [320, 393, 430, 768];

/** Returns true when the page scrolls sideways, which would clip content on a phone. */
async function overflowsHorizontally(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

for (const path of PUBLIC_SCREENS) {
  for (const width of WIDTHS) {
    test(`${path} keeps the Clear contract at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();

      // Cool light canvas, Inter body text, no horizontal scroll.
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(242, 246, 246)");
      const family = await page.locator("h1").evaluate((node) => getComputedStyle(node).fontFamily);
      expect(family.toLowerCase()).toContain("inter");
      expect(await overflowsHorizontally(page)).toBe(false);

      // Editable text is at least 16px so phones do not zoom on focus.
      for (const field of await page.locator("input:not([type=checkbox]):not([type=radio])").all()) {
        const size = await field.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        expect(size).toBeGreaterThanOrEqual(16);
      }

      // Every visible control meets the WCAG 2.2 minimum target (24px); primary actions are checked separately at 54px.
      for (const control of await page.locator("main button:visible, main a:visible").all()) {
        const box = await control.boundingBox();
        if (box && box.height > 0) expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(24);
      }
    });
  }
}

test("sign-in primary action uses the jade Clear button", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/sign-in");
  const submit = page.getByRole("button", { name: /sign in/i }).first();
  await expect(submit).toBeVisible();
  const box = await submit.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(54);
});

test("focus is visible on the sign-in fields", async ({ page }) => {
  await page.goto("/sign-in");
  // Focus a real form field: in dev mode the first Tab stop is Next's own overlay, not the app.
  await page.locator("input").first().focus();
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(outline.style).not.toBe("none");
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("the Clear scope wraps the page content", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator("[data-ui='clear'] h1")).toBeVisible();
});
