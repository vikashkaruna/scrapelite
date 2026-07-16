// e2e/smoke/theme.spec.js
// K-20 — Theme toggle is present; clicking flips data-theme; the choice
// persists to localStorage.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("theme toggle is present in the TopBar", async ({ page }) => {
  await page.goto("/");
  // The desktop theme toggle.
  await expect(page.locator(".topbar-desktop-actions .theme-toggle")).toBeVisible();
});

test("clicking the theme toggle flips data-theme and persists to localStorage", async ({ page }) => {
  await page.goto("/");
  const initial = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  // Click the toggle.
  await page.locator(".topbar-desktop-actions .theme-toggle").click();
  const next = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  expect(next).not.toBe(initial);
  // The choice is persisted in localStorage under "datiq.theme".
  const stored = await page.evaluate(() => localStorage.getItem("datiq.theme"));
  expect(stored).toBe(next);
});
