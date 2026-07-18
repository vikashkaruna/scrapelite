// e2e/smoke/integrations.spec.js
// K-14 — Integrations page renders 12 cards (4 live, 6 coming-soon, 1 agency, 1 roadmap).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("integrations page renders 12 integration cards", async ({ page }) => {
  await page.goto("/integrations");
  const cards = page.locator(".int-card");
  // The catalog ships 13 cards: 5 live + 6 coming-soon + 1 agency-plan + 1 roadmap.
  await expect(cards).toHaveCount(13);
});
