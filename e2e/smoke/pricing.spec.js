// e2e/smoke/pricing.spec.js
// K-05 — Pricing renders 8 plan cards (Free / Go / Select / Pro / Business /
// Agency / Developer / Enterprise), monthly is the default toggle, Enterprise
// has the dashed-border card, Developer has a "Coming soon" badge.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("pricing renders all 8 plan cards", async ({ page }) => {
  await page.goto("/pricing");
  const cards = page.locator(".plan-card");
  await expect(cards).toHaveCount(8);
  for (const name of ["Free", "Go", "Select", "Pro", "Business", "Agency", "Developer", "Enterprise"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("Monthly is the default billing toggle", async ({ page }) => {
  await page.goto("/pricing");
  // The billing toggle has the .active class on whichever is selected.
  const activeBtn = page.locator(".billing-toggle-btn.active");
  await expect(activeBtn).toContainText(/Monthly/i);
});

test("Annual toggle: each paid card shows /yr, /mo, strikethrough and Save amount + %", async ({ page }) => {
  await page.goto("/pricing");
  await page.locator(".billing-toggle-btn", { hasText: "Annual" }).first().click();
  // Every non-free plan card should now show the annual price layout.
  for (const name of ["Go", "Select", "Pro", "Business", "Agency"]) {
    const card = page.locator(".plan-card").filter({ hasText: name }).first();
    await expect(card).toBeVisible();
    await expect(card.locator(".plan-price-annual")).toBeVisible();
    // Per-year amount + "/yr"
    await expect(card.locator(".plan-price-annual-row--top .price-amount")).toBeVisible();
    await expect(card.locator(".plan-price-annual-row--top .price-period")).toHaveText(/\/ yr/);
    // Per-month amount + "/mo" (use the .price-period-sub selector to avoid
    // matching the "/month" text in the extractions feature line).
    await expect(card.locator(".price-amount-sub")).toBeVisible();
    await expect(card.locator(".price-period-sub")).toHaveText(/\/ mo/);
    // Strikethrough on both rows
    await expect(card.locator(".price-original").first()).toBeVisible();
    // Save line with both currency amount and percent
    await expect(card.locator(".price-save")).toContainText(/Save /);
    await expect(card.locator(".price-save")).toContainText(/%/);
  }
});

test("'Best Value' plan (Agency) has the amber plan-best-value border", async ({ page }) => {
  await page.goto("/pricing");
  const bestValueCard = page.locator(".plan-card.plan-best-value");
  await expect(bestValueCard).toHaveCount(1);
  await expect(bestValueCard).toContainText(/Agency/);
  // The 'Best Value' badge itself should also be present and amber-styled.
  await expect(bestValueCard.locator(".plan-badge")).toContainText(/Best Value/);
});

test("Enterprise plan card has a dashed border (.enterprise-card)", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator(".plan-card.enterprise-card")).toBeVisible();
});

test("Developer plan card is marked 'coming soon' (CTA = 'Notify me', badge 'Coming H3 2026')", async ({ page }) => {
  await page.goto("/pricing");
  const devCard = page.locator(".plan-card.plan-coming-soon");
  await expect(devCard).toBeVisible();
  // The Developer card CTA is "Notify me" (disabled), per R4.
  await expect(devCard.getByRole("button", { name: /Notify me/i })).toBeVisible();
  // The badge text is "Coming H3 2026" (was H2 — pushed back one half).
  await expect(devCard.locator(".plan-badge")).toContainText(/Coming H3 2026/);
});
