// e2e/smoke/redirects.spec.js
// K-22 — /help/index.html serves the static help page; /compare redirects to
// /vs/browse-ai (covered again here, redundantly, for a single-file contract).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/help/index.html returns 200 (static help page)", async ({ page }) => {
  const res = await page.goto("/help/index.html");
  expect(res?.ok()).toBeTruthy();
  // The help page has a generated heading like "DatIQ — Help Center".
  await expect(page.getByText(/help center|datIQ/i).first()).toBeVisible();
});

test("/compare redirects to /vs/browse-ai", async ({ page }) => {
  await page.goto("/compare");
  await expect(page).toHaveURL(/\/vs\/browse-ai$/);
});
