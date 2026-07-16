// e2e/journeys/dashboard-batch-filter.spec.js
// J-07 — Dashboard batch-run filter: open the BatchRunsDropdown, pick a run,
// verify only its group remains, then clear the filter and verify all groups
// return. Also covers the per-run delete action.
//
// Note: when a batch group has 2+ items, the dashboard renders a single
// collapsible "group" row showing the run label + page count. The individual
// URLs only appear when the group is expanded. We assert on the group rows
// (which are always visible) and on the run labels, which is the contract
// the filter actually controls.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("Dashboard batch filter: pick a run → only its group; clear → both groups; delete → group gone", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const t0 = Date.now();
    const make = (id, url, title, ageMs) => ({
      id, url, page_title: title,
      created_at: new Date(t0 - ageMs).toISOString(),
      headings: [], links: [], _saved: true,
    });
    const runA = {
      id: "run_alpha",
      kind: "batch",
      label: "AI summary · 2 URLs · Jan 5",
      intent: "summary",
      createdAt: new Date().toISOString(),
      totalUrls: 2,
      successCount: 2,
      failedCount: 0,
    };
    const runB = {
      id: "run_bravo",
      kind: "batch",
      label: "Find contacts · 2 URLs · Jan 6",
      intent: "contacts",
      createdAt: new Date(t0 - 86_400_000).toISOString(),
      totalUrls: 2,
      successCount: 2,
      failedCount: 0,
    };
    localStorage.setItem("datiq.batchRuns", JSON.stringify([runA, runB]));

    // 2 extractions belong to runA (newest), 2 belong to runB (older).
    const map = {
      ext_a1: "run_alpha",
      ext_a2: "run_alpha",
      ext_b1: "run_bravo",
      ext_b2: "run_bravo",
    };
    localStorage.setItem("datiq.batchMap", JSON.stringify(map));

    const rows = [
      make("ext_a1", "https://alpha-one.example.com", "Alpha One", 0),
      make("ext_a2", "https://alpha-two.example.com", "Alpha Two", 1_000),
      make("ext_b1", "https://bravo-one.example.com", "Bravo One", 86_400_000),
      make("ext_b2", "https://bravo-two.example.com", "Bravo Two", 86_401_000),
    ];
    localStorage.setItem("datiq.saved", JSON.stringify(rows));
  });

  await page.goto("/dashboard");

  // The dashboard renders two collapsible group rows, one per run. The
  // "4 total" count confirms all extractions loaded.
  await expect(page.getByText(/4 total/)).toBeVisible();
  const runARow = page.locator(".dash-group-row").filter({ hasText: /AI summary · 2 URLs/ });
  const runBRow = page.locator(".dash-group-row").filter({ hasText: /Find contacts · 2 URLs/ });
  await expect(runARow).toBeVisible();
  await expect(runBRow).toBeVisible();

  // Expand runA so its individual URLs render — the filter contract is that
  // the underlying items remain associated to the run regardless of UI mode.
  await runARow.click();
  await expect(page.getByText(/alpha-one\.example\.com/i).first()).toBeVisible();

  // The BatchRunsDropdown button shows the run count (2).
  const batchBtn = page.locator(".batch-runs-btn");
  await expect(batchBtn).toBeVisible();
  await expect(batchBtn.locator(".batch-runs-count")).toHaveText("2");

  // Open the dropdown — both runs are listed.
  await batchBtn.click();
  const menu = page.locator(".batch-runs-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/AI summary · 2 URLs/)).toBeVisible();
  await expect(menu.getByText(/Find contacts · 2 URLs/)).toBeVisible();

  // Pick runA — only the runA group should remain.
  await menu.getByText(/AI summary · 2 URLs/).click();
  await expect(page.locator(".batch-filter-banner")).toBeVisible();
  await expect(page.locator(".batch-filter-banner")).toContainText(/AI summary · 2 URLs/);

  // Only runA is visible; runB is gone.
  await expect(page.locator(".dash-group-row").filter({ hasText: /AI summary · 2 URLs/ })).toBeVisible();
  await expect(page.locator(".dash-group-row").filter({ hasText: /Find contacts · 2 URLs/ })).toHaveCount(0);

  // Reopen dropdown → click "Show all extractions" → both groups return.
  await batchBtn.click();
  await menu.getByText(/Show all extractions/i).click();
  await expect(page.locator(".batch-filter-banner")).toHaveCount(0);
  await expect(page.locator(".dash-group-row").filter({ hasText: /AI summary · 2 URLs/ })).toBeVisible();
  await expect(page.locator(".dash-group-row").filter({ hasText: /Find contacts · 2 URLs/ })).toBeVisible();

  // Pick runA again, then delete runA via the dropdown × button.
  await batchBtn.click();
  await menu.getByText(/AI summary · 2 URLs/).click();
  await expect(page.locator(".batch-filter-banner")).toBeVisible();
  await batchBtn.click();
  const runAItem = page.locator(".batch-runs-item").filter({ hasText: /AI summary · 2 URLs/ });
  await runAItem.locator(".batch-runs-item-del").click();

  // After delete: runA is gone, the filter is cleared (since the active run
  // no longer exists), so only the runB group remains.
  await expect(page.locator(".batch-filter-banner")).toHaveCount(0);
  await expect(page.locator(".dash-group-row").filter({ hasText: /AI summary · 2 URLs/ })).toHaveCount(0);
  await expect(page.locator(".dash-group-row").filter({ hasText: /Find contacts · 2 URLs/ })).toBeVisible();
});
