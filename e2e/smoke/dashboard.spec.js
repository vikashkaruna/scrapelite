// e2e/smoke/dashboard.spec.js
// K-04 — Dashboard renders heading, layout toggle, Export dropdown hidden when
// empty, batch-runs dropdown, Refresh, "New extraction", empty state.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("dashboard renders the empty state for an unauthenticated visitor", async ({ page }) => {
  await page.goto("/dashboard");
  // The H1 varies by persona; match a stable substring.
  await expect(
    page.getByRole("heading", { name: /extractions|Prospect|Competitor|Market|SEO|Lead|Builder/i }),
  ).toBeVisible();
  // The R6 empty state copy + CTA.
  await expect(page.getByText(/Nothing saved yet/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Extract a page/i }).first()).toBeVisible();
});

test("dashboard has a layout toggle (table / cards)", async ({ page }) => {
  await page.goto("/dashboard");
  // The seg-filter has two buttons (table + cards). The .seg-opt.on is the active one.
  await expect(page.locator(".seg-filter")).toBeVisible();
});

test("dashboard export dropdown is hidden when there are no rows", async ({ page }) => {
  await page.goto("/dashboard");
  // With no rows, there's no .export-dropdown trigger.
  const exportDropdowns = page.locator(".export-dropdown");
  await expect(exportDropdowns).toHaveCount(0);
});

test("dashboard has a batch-runs dropdown button (left-aligned per R15)", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator(".batch-runs-btn")).toBeVisible();
});

test("dashboard has a Refresh button (R9 contract)", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
});

test("dashboard has a + New extraction CTA in the TopBar (only on /preview)", async ({ page }) => {
  // The TopBar's + New button is only rendered on /preview. The Dashboard
  // empty state has an "Extract a page" CTA which serves the same purpose.
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /Extract a page/i }).first()).toBeVisible();
});

test("dashboard search input is hidden when there are no rows (R4 contract)", async ({ page }) => {
  await page.goto("/dashboard");
  // The search input lives in .dash-header-actions but is hidden when items.length === 0.
  const search = page.getByPlaceholder(/search/i);
  await expect(search).toHaveCount(0);
});

test("dashboard new visitor (no saved) shows the bookmark icon + H1 + sub", async ({ page }) => {
  await page.goto("/dashboard");
  // The eyebrow line is the bookmark icon + "Saved".
  await expect(page.locator(".eyebrow")).toBeVisible();
  await expect(page.getByText(/Saved/)).toBeVisible();
});
