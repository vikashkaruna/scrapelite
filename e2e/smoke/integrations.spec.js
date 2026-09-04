// e2e/smoke/integrations.spec.js
// K-14 — Integrations page renders every card in the catalogue.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("integrations page renders 14 integration cards", async ({ page }) => {
  await page.goto("/integrations");
  const cards = page.locator(".int-card");
  // The catalogue ships 14 cards: 6 live (Signal Routing joined them) + 6
  // coming-soon + 1 business-plan-and-up + 1 roadmap.
  await expect(cards).toHaveCount(14);
});
