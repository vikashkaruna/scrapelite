// e2e/smoke/home.spec.js
// K-02 — Home renders the composer + intent chips + feature cards + brand + footer.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("home shows the H1, brand text, tagline, and footer", async ({ page }) => {
  await page.goto("/");
  // Brand mark + name in TopBar.
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  // Tagline (R1: "Intelligence from every URL") — scope to the brand.
  await expect(page.locator(".brand-tagline").first()).toBeVisible();
  // H1 — varies by persona, so match a stable substring.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Footer social/legal row.
  await expect(page.locator(".site-footer-slim")).toBeVisible();
});

test("home composer (URL textarea) is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("textarea").first()).toBeVisible();
});

test("home shows the 5 intent chips (summary, contacts, pricing, map, custom)", async ({ page }) => {
  await page.goto("/");
  for (const label of [/summary/i, /contacts/i, /pricing/i, /map/i, /custom/i]) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("home renders 8 feature cards (clickable)", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator(".feature-cell");
  await expect(cards).toHaveCount(8);
});

test("home does NOT have an inline multi-URL textarea toggle (R15 cleanup)", async ({ page }) => {
  await page.goto("/");
  // The "Use Batch mode →" hint link was removed in R15. The inline toggle
  // is also gone. This contract pins that.
  await expect(page.getByText(/Use Batch mode/i)).toHaveCount(0);
});

test("TopBar nav shows Extract / Batch / Dashboard links (in that order)", async ({ page }) => {
  await page.goto("/");
  // mainLinks are buttons in .topbar-desktop-actions.
  const nav = page.locator(".topbar-desktop-actions .nav-link");
  await expect(nav.nth(0)).toContainText(/Extract/i);
  await expect(nav.nth(1)).toContainText(/Batch/i);
  await expect(nav.nth(2)).toContainText(/Schedules/i);
  await expect(nav.nth(3)).toContainText(/Dashboard/i);
});
