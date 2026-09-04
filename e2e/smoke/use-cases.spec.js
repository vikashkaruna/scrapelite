// e2e/smoke/use-cases.spec.js
// K-12 — Use Cases hub renders every card; subpage (e.g. /use-cases/lead-generation) renders.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/use-cases hub renders all 9 use-case cards", async ({ page }) => {
  await page.goto("/use-cases");
  const cards = page.locator(".uc-hub-card");
  await expect(cards).toHaveCount(9);
  // Named individually rather than counted alone: dropping one card and adding
  // another elsewhere would keep a bare count green while a persona lost its page.
  for (const name of [
    /Lead generation/i, /Competitor research/i, /SEO audit/i, /Market research/i,
    /Account intelligence/i, /Competitive monitoring/i, /AI visibility/i,
    /Recruiting research/i, /Investor diligence/i,
  ]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("/use-cases/lead-generation subpage renders", async ({ page }) => {
  await page.goto("/use-cases/lead-generation");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
