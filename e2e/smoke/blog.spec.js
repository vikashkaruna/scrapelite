// e2e/smoke/blog.spec.js
// K-09 — Blog cards are visible; clicking a card opens the PostModal overlay.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("blog page renders at least 1 article card", async ({ page }) => {
  await page.goto("/blog");
  const cards = page.locator(".blog-card");
  await expect(cards.first()).toBeVisible();
});

test("clicking a blog card opens the PostModal overlay with the post title", async ({ page }) => {
  await page.goto("/blog");
  const firstCard = page.locator(".blog-card").first();
  const titleText = await firstCard.locator(".blog-card-title").textContent();
  await firstCard.click();
  // The PostModal is a dialog with role=dialog.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 3000 });
  if (titleText) {
    await expect(dialog).toContainText(titleText);
  }
});
