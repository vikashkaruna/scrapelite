// e2e/journeys/empty-state-cta.spec.js
// J-10 — Empty-state CTA: a new visitor (no saved extractions) sees the
// "Nothing saved yet" empty state on /dashboard, and the "Extract a page"
// CTA navigates them back to / (the composer).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("Empty dashboard shows the 'Nothing saved yet' CTA and 'Extract a page' navigates home", async ({ page }) => {
  // Start with a fully cleared localStorage (installOfflineMocks already did
  // this in beforeEach, but be explicit for clarity).
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });

  // Visit the dashboard — empty state should render.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Nothing saved yet/i })).toBeVisible();
  await expect(page.getByText(/Extract a page and save it to build your library/i)).toBeVisible();
  // The CTA is rendered as a Button, which renders as <button>.
  const cta = page.getByRole("button", { name: /Extract a page/i });
  await expect(cta).toBeVisible();

  // The search input is NOT rendered when there are no rows (R4 contract).
  await expect(page.getByPlaceholder(/Search titles/i)).toHaveCount(0);

  // Click the CTA → navigate to "/".
  await cta.click();
  await expect(page).toHaveURL(/\/$/);
  // The Home composer is present.
  await expect(page.getByPlaceholder(/Paste a URL/i)).toBeVisible();
});
