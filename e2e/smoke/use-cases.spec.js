// e2e/smoke/use-cases.spec.js
// K-12 — Use Cases hub renders 4 cards; subpage (e.g. /use-cases/lead-generation) renders.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/use-cases hub renders 4 use-case cards", async ({ page }) => {
  await page.goto("/use-cases");
  const cards = page.locator(".uc-hub-card");
  await expect(cards).toHaveCount(4);
  for (const name of [/Lead generation/i, /Competitor research/i, /SEO audit/i, /Market research/i]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("/use-cases/lead-generation subpage renders", async ({ page }) => {
  await page.goto("/use-cases/lead-generation");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
