// e2e/smoke/deeplink-preview.spec.js — FR-BH-02
// `/preview` is a deep link that depends on `datiq.current`. With no
// current extraction, the SPA should still serve the route and gracefully
// redirect to the home composer (so the user can extract something). The
// previous behaviour was an SPA redirect, which we keep. The contract here
// is "the route is served, not a 404, and the user lands somewhere useful".

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/preview with no saved extraction renders the home composer", async ({ page }) => {
  const response = await page.goto("/preview");
  expect(response?.ok()).toBeTruthy();
  // The composer is the only place a deep-link back to / lands.
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: /Extract & enrich/i }),
  ).toBeVisible({ timeout: 10_000 });
});
