// e2e/smoke/footer.spec.js
// K-21 — Footer is the slim single-row layout (R1) with Privacy + Terms legal
// links (they're buttons that navigate, not <a> tags).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("footer renders the slim single-row layout (.site-footer-slim)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".site-footer-slim")).toBeVisible();
});

test("footer has Privacy and Terms buttons that navigate", async ({ page }) => {
  await page.goto("/");
  // Click "Privacy" in the footer.
  const privacyBtn = page.locator(".site-footer-slim").getByText(/Privacy/i).first();
  await privacyBtn.click();
  await expect(page).toHaveURL(/\/privacy$/);
  // Go back and test Terms.
  await page.goto("/");
  await page.locator(".site-footer-slim").getByText(/Terms/i).first().click();
  await expect(page).toHaveURL(/\/terms$/);
});
