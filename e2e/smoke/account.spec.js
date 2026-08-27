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

// ── Danger zone ─────────────────────────────────────────────────────────────
// The two actions on this page you cannot casually undo. What matters most in a
// browser test is the guard: the destructive control must be unreachable
// without a deliberate, typed act.
test("the danger zone is not reachable for a signed-out visitor", async ({ page }) => {
  // Freezing or deleting an account requires an account. Rendering the panel
  // to a visitor would offer controls that can only ever refuse them.
  await page.goto("/account");
  await expect(page.locator(".danger-zone")).toHaveCount(0);
});
