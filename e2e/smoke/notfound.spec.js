// e2e/smoke/notfound.spec.js — FR-Z-03 + FR-Z-07
// Any unmatched route renders the NotFound page (R20 / M0). The test
// also covers the back-to-home and quick-link behaviour so we lock in
// the user-facing contract the page exposes.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/totally-bogus renders the NotFound page", async ({ page }) => {
  const response = await page.goto("/totally-bogus");
  expect(response?.ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: /We could not find that page/i }),
  ).toBeVisible({ timeout: 10_000 });
  // The "Back to DatIQ" button is the primary action.
  await expect(
    page.getByRole("link", { name: /Back to DatIQ/i }).first(),
  ).toBeVisible();
});

test("NotFound quick-link to /dashboard navigates correctly", async ({ page }) => {
  await page.goto("/not-a-real-route");
  await expect(
    page.getByRole("heading", { name: /We could not find that page/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: /Open dashboard/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: /Your extractions/i }),
  ).toBeVisible();
});
