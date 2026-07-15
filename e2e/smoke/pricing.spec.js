// e2e/smoke/pricing.spec.js
// K-05 — Pricing renders 7 plan cards (Free / Select / Pro / Business / Agency
// / Developer / Enterprise), annual is the default toggle, Enterprise has
// the dashed-border card, Developer has a "Coming soon" badge.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("pricing renders all 7 plan cards", async ({ page }) => {
  await page.goto("/pricing");
  const cards = page.locator(".plan-card");
  await expect(cards).toHaveCount(7);
  for (const name of ["Free", "Select", "Pro", "Business", "Agency", "Developer", "Enterprise"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("Annual is the default billing toggle", async ({ page }) => {
  await page.goto("/pricing");
  // The billing toggle has the .active class on whichever is selected.
  const activeBtn = page.locator(".billing-toggle-btn.active");
  await expect(activeBtn).toContainText(/Annual/i);
});

test("Enterprise plan card has a dashed border (.enterprise-card)", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator(".plan-card.enterprise-card")).toBeVisible();
});

test("Developer plan card is marked 'coming soon' (CTA = 'Notify me')", async ({ page }) => {
  await page.goto("/pricing");
  const devCard = page.locator(".plan-card.plan-coming-soon");
  await expect(devCard).toBeVisible();
  // The Developer card CTA is "Notify me" (disabled), per R4.
  await expect(devCard.getByRole("button", { name: /Notify me/i })).toBeVisible();
});
