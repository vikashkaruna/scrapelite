// e2e/visual/dashboard.spec.js
// V-03 — Dashboard visual snapshots: empty state, 5-item, batch-filtered.
// These three are the most-trafficked dashboard states.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("dashboard empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("dashboard-empty.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("dashboard with 5 extractions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const t0 = Date.now();
    const make = (id, url, title, ageMs) => ({
      id, url, page_title: title,
      created_at: new Date(t0 - ageMs).toISOString(),
      headings: [], links: [], _saved: true,
    });
    const rows = [
      make("a1", "https://alpha-one.example.com", "Alpha One", 0),
      make("a2", "https://alpha-two.example.com", "Alpha Two", 1000),
      make("a3", "https://bravo-one.example.com", "Bravo One", 86_400_000),
      make("a4", "https://bravo-two.example.com", "Bravo Two", 86_401_000),
      make("a5", "https://charlie.example.com", "Charlie", 172_800_000),
    ];
    localStorage.setItem("datiq.saved", JSON.stringify(rows));
  });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("dashboard-5-items.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("dashboard with batch filter active", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const t0 = Date.now();
    const make = (id, url, title, ageMs) => ({
      id, url, page_title: title,
      created_at: new Date(t0 - ageMs).toISOString(),
      headings: [], links: [], _saved: true,
    });
    const runA = {
      id: "run_visual", kind: "batch",
      label: "AI summary · 2 URLs · Jan 5",
      intent: "summary", createdAt: new Date().toISOString(),
      totalUrls: 2, successCount: 2, failedCount: 0,
    };
    localStorage.setItem("datiq.batchRuns", JSON.stringify([runA]));
    const map = { a1: "run_visual", a2: "run_visual" };
    localStorage.setItem("datiq.batchMap", JSON.stringify(map));
    const rows = [
      make("a1", "https://alpha-one.example.com", "Alpha One", 0),
      make("a2", "https://alpha-two.example.com", "Alpha Two", 1000),
      make("b1", "https://bravo-one.example.com", "Bravo One", 86_400_000),
    ];
    localStorage.setItem("datiq.saved", JSON.stringify(rows));
  });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  // Open the batch dropdown and pick the run.
  await page.locator(".batch-runs-btn").click();
  await page.locator(".batch-runs-menu").getByText(/AI summary · 2 URLs/).click();
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot("dashboard-batch-filtered.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
