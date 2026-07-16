// e2e/smoke/terms.spec.js
// K-11 — Terms page references the Arbitration & Conciliation Act and Bengaluru
// (Indian arbitration; R4 fix).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("terms page references the Arbitration and Conciliation Act, 1996", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByText(/Arbitration and Conciliation Act, 1996/i)).toBeVisible();
});

test("terms page specifies the arbitration seat is Bengaluru", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByText(/Bengaluru/i)).toBeVisible();
});
