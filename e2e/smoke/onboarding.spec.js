// e2e/smoke/onboarding.spec.js
// K-15 — Onboarding renders inside the Shell (TopBar present).

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/onboarding renders the persona step inside the Shell (TopBar present)", async ({ page }) => {
  await page.goto("/onboarding");
  // TopBar with brand mark is rendered.
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  // The persona picker step is the default — H1 "What best describes your work?"
  await expect(page.getByRole("heading", { name: /What best describes your work/i })).toBeVisible();
  // 7 persona cards are visible.
  const personaCards = page.locator(".ob-card");
  await expect(personaCards).toHaveCount(7);
});
