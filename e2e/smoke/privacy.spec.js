// e2e/smoke/privacy.spec.js
// K-10 — Privacy page renders the DPDP Act 2023 section and uses datiq.app URLs.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("privacy page renders the DPDP Act section", async ({ page }) => {
  await page.goto("/privacy");
  // The full title appears in both the TOC link and the section h2.
  // Scope to the section heading to avoid the strict-mode duplicate.
  await expect(
    page.getByRole("heading", { name: /Digital Personal Data Protection/i }),
  ).toBeVisible();
});

test("privacy page uses datiq.app URLs (not scrapelite.netlify.app — R4 fix)", async ({ page }) => {
  await page.goto("/privacy");
  const html = await page.content();
  // The legacy scrapelite.netlify.app URL is fixed; new copy uses datiq.app.
  expect(html).not.toContain("scrapelite.netlify.app");
  expect(html).toContain("datiq.app");
});
