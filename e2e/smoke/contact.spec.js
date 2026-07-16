// e2e/smoke/contact.spec.js
// K-07 — Contact renders 5 enquiry type buttons; ?type=bug pre-fills subject.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("contact page renders all 6 enquiry type buttons", async ({ page }) => {
  await page.goto("/contact");
  for (const label of [/Product support/i, /Bug report/i, /Billing question/i, /Feature request/i, /Enterprise/i, /Other/i]) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("?type=bug pre-selects 'Bug report' and pre-fills subject with 'Bug report: '", async ({ page }) => {
  await page.goto("/contact?type=bug");
  // The Bug report type button is the selected one (active class).
  const bugBtn = page.getByRole("button", { name: /Bug report/i });
  await expect(bugBtn).toHaveClass(/active|on/);
  // The subject input is pre-filled.
  const subject = page.getByLabel(/subject/i);
  await expect(subject).toHaveValue(/^Bug report:/);
});
