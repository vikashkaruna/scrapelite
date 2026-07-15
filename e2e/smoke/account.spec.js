// e2e/smoke/account.spec.js
// K-06 — Account renders heading + 2 stat rows (batch + content generations).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("account page renders the account heading", async ({ page }) => {
  await page.goto("/account");
  // The H1 is the user's display name. For a logged-out visitor it falls
  // back to "Account" or a default string. Assert on a stable heading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account page shows 'Batch executions' stat row (R13)", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByText(/Batch executions/i)).toBeVisible();
});

test("account page shows 'Content generations' stat row (R13)", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByText(/Content generations/i)).toBeVisible();
});
