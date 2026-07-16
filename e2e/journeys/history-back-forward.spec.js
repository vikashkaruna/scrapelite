// e2e/journeys/history-back-forward.spec.js
// BH-01 — Back/forward button preserves the Dashboard search filter.
//
// Contract: when the user types in the Dashboard search box, then navigates
// away and comes back, the filter is still applied. This is the contract
// that protects against the "search clears on navigation" regression.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("Dashboard search filter persists across back/forward navigation", async ({ page }) => {
  // Seed the dashboard with two extractions so the search is meaningful.
  await page.goto("/");
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const rows = [
      { id: "ext_1", url: "https://alpha.example.com", page_title: "Alpha",  created_at: now, headings: [], links: [], _saved: true },
      { id: "ext_2", url: "https://bravo.example.com", page_title: "Bravo",  created_at: now, headings: [], links: [], _saved: true },
    ];
    localStorage.setItem("datiq.saved", JSON.stringify(rows));
  });

  await page.goto("/dashboard");
  // Both rows are visible.
  await expect(page.getByText(/alpha\.example\.com/i).first()).toBeVisible();
  await expect(page.getByText(/bravo\.example\.com/i).first()).toBeVisible();

  // Type into the search box. The input is conditionally rendered — when
  // items.length > 0 the search input appears. Both rows are there.
  const search = page.getByPlaceholder(/search/i);
  await expect(search).toBeVisible({ timeout: 5000 });
  await search.fill("alpha");
  // Only the alpha row remains.
  await expect(page.getByText(/alpha\.example\.com/i).first()).toBeVisible();
  await expect(page.getByText(/bravo\.example\.com/i)).toHaveCount(0);

  // Navigate to a different route, then back.
  await page.goto("/about");
  await expect(page.getByText(/Vikash Karuna/)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\?q=alpha$/);

  // The search filter is still applied.
  await expect(page.getByPlaceholder(/search/i)).toHaveValue(/alpha/);
  // Forward navigation restores the about page.
  await page.goForward();
  await expect(page).toHaveURL(/\/about$/);
});
