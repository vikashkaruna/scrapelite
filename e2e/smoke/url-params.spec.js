// e2e/smoke/url-params.spec.js — FR-BH-04
// `/contact?type=bug` should pre-select the "Bug report" enquiry type
// (added in R10) and pre-fill the subject line. This contract is part of
// the user-facing deeplink story — a shared link with a query param must
// land the user on the correct form state, not the default state.
//
// The active state on the type chips is signalled by the `.active` CSS
// class (the production component uses class-based styling rather than
// `aria-pressed`); the contract test asserts on the same signal the
// product exposes to the user.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/contact?type=bug pre-selects the bug-report enquiry type", async ({ page }) => {
  const response = await page.goto("/contact?type=bug");
  expect(response?.ok()).toBeTruthy();
  const bugButton = page.getByRole("button", { name: /Bug report/i });
  await expect(bugButton).toBeVisible({ timeout: 10_000 });
  // The active type button gets the `.active` class. Asserting on the
  // class keeps the test honest about the real production signal — if
  // the component switches to a data attribute or aria state, this test
  // breaks and we re-align it with the new contract.
  await expect(bugButton).toHaveClass(/active/);
  // And the subject input is pre-filled with the bug prefix.
  await expect(page.getByLabel(/Subject/i)).toHaveValue(/^Bug report:/);
});

test("/contact without ?type= defaults to the product-support enquiry", async ({ page }) => {
  const response = await page.goto("/contact");
  expect(response?.ok()).toBeTruthy();
  const supportButton = page.getByRole("button", { name: /Product support/i });
  await expect(supportButton).toBeVisible({ timeout: 10_000 });
  await expect(supportButton).toHaveClass(/active/);
});
