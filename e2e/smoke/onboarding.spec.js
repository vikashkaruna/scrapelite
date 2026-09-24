// e2e/smoke/onboarding.spec.js
// K-15 — Onboarding renders inside the Shell (TopBar present).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/onboarding renders the persona step inside the Shell (TopBar present)", async ({ page }) => {
  await page.goto("/onboarding");
  // TopBar with brand mark is rendered.
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  // The role picker step is the default.
  await expect(page.getByRole("heading", { name: /What do you want DatIQ to do for you/i })).toBeVisible();
  // 8 role cards; picking one opens its detail panel.
  const roles = page.locator(".ob-role");
  await expect(roles).toHaveCount(8);
  await roles.first().click();
  await expect(page.locator("#ob-role-detail")).toContainText("What you can do");
});
