import { expect, test } from "playwright/test";
import { installOfflineMocks } from "./support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("a mock extraction can be enriched, reloaded, and viewed from the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("URL or content to extract").fill("https://lumio.io");
  await page.locator(".hero-composer").getByRole("button", { name: "Extract", exact: true }).click();

  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByRole("heading", { name: /Lumio — Product analytics/i })).toBeVisible();
  await expect(page.getByText("Product analytics that actually make sense", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Find Contact Info", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Find Contact Info", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Jordan Avery")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Find Contact Info", exact: true })).toBeVisible();
  // The active tab is not restored across reload by design; re-activate it
  // to verify the persisted enrichment payload itself.
  await page.getByRole("tab", { name: "Find Contact Info", exact: true }).click();
  await expect(page.getByText("Jordan Avery")).toBeVisible();

  await page.getByRole("button", { name: "View Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Lumio — Product analytics that actually make sense")).toBeVisible();

  await page.getByLabel("Search extractions").fill("analytics");
  await expect(page.getByText("Lumio — Product analytics that actually make sense")).toBeVisible();
});
