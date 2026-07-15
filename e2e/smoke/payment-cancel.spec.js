// e2e/smoke/payment-cancel.spec.js
// K-16 — /payment/cancel shows the 'No charge was made' copy.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/payment/cancel renders 'No charge was made'", async ({ page }) => {
  await page.goto("/payment/cancel");
  await expect(page.getByText(/No charge was made/i)).toBeVisible();
});
