// e2e/smoke/vs.spec.js
// K-13 — /vs/browse-ai and /vs/clay comparison pages render with their H1.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/vs/browse-ai renders an H1 mentioning both DatIQ and Browse.ai", async ({ page }) => {
  await page.goto("/vs/browse-ai");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Page text mentions both products.
  const text = await page.locator("body").textContent();
  expect(text).toMatch(/DatIQ/i);
  expect(text).toMatch(/Browse\.ai/i);
});

test("/vs/clay renders an H1 mentioning both DatIQ and Clay", async ({ page }) => {
  await page.goto("/vs/clay");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const text = await page.locator("body").textContent();
  expect(text).toMatch(/DatIQ/i);
  expect(text).toMatch(/Clay/i);
});
