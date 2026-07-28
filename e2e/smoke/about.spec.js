// e2e/smoke/about.spec.js
// K-08 — About renders the company block (Axiom Minds Private Limited) and the
// hero text does NOT contain the "powered by DatIQ" copy bug from R4.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("about page renders the company block (Axiom Minds Private Limited)", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByText("Axiom Minds Private Limited")).toBeVisible();
  // Scope to the company block to avoid matching other "Founder" text on the
  // page (e.g. the Startup Founder / VC persona chip).
  await expect(page.locator(".about-founder-role")).toContainText(/DatIQ/);
});

test("about page does NOT contain the 'powered by DatIQ' copy bug (R4)", async ({ page }) => {
  await page.goto("/about");
  // The body text should never say "DatIQ (powered by DatIQ)".
  const text = await page.locator("body").textContent();
  expect(text?.toLowerCase()).not.toContain("powered by datiq");
});
