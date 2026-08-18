// e2e/smoke/batch.spec.js
// K-03 — Batch page renders heading, 5 intent chips, URL textarea, count badge,
// CSV import, draft persistence.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("batch page renders heading + URL textarea", async ({ page }) => {
  await page.goto("/batch");
  await expect(page.getByRole("heading", { name: /Batch extraction/i }).first()).toBeVisible();
  await expect(page.locator("textarea").first()).toBeVisible();
});

test("batch page shows the 5 intent chips (summary, contacts, pricing, map, custom)", async ({ page }) => {
  await page.goto("/batch");
  for (const label of [/AI summary/i, /Find contacts/i, /Scrape pricing/i, /Map site/i, /Custom/i]) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("batch page has a CSV import input on the Import CSV tab", async ({ page }) => {
  await page.goto("/batch");
  // The second input-tab button is "Import CSV" (R5).
  await page.getByRole("button", { name: /Import CSV/i }).click();
  // The hidden file input is wired to the CSV importer.
  await expect(page.locator("input[type='file']").first()).toBeAttached();
});

test("batch page persists draft text to localStorage on type", async ({ page }) => {
  await page.goto("/batch");
  const ta = page.locator("textarea").first();
  await ta.fill("https://a.example.com");
  // The localStorage key is "datiq.batchDraft".
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("datiq.batchDraft")), { timeout: 2000 })
    .toContain("a.example.com");
});

test("batch page count badge updates when URLs are typed", async ({ page }) => {
  await page.goto("/batch");
  const ta = page.locator("textarea").first();
  await ta.fill("https://a.example.com\nhttps://b.example.com");
  // The batch page renders a count badge (e.g. "2 URLs detected").
  await expect(page.getByText(/2 URL/i).first()).toBeVisible({ timeout: 3000 });
});

test("batch draft is restored from localStorage on reload", async ({ page }) => {
  await page.goto("/batch");
  await page.evaluate(() => {
    localStorage.setItem("datiq.batchDraft", "https://restored.example.com");
  });
  await page.reload();
  const ta = page.locator("textarea").first();
  await expect(ta).toHaveValue(/restored\.example\.com/);
});
