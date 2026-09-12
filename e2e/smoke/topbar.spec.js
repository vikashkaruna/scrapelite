// e2e/smoke/topbar.spec.js
// K-17 — TopBar Explore dropdown opens and shows the 3 main section labels.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("clicking Explore opens the dropdown", async ({ page }) => {
  await page.goto("/");
  const exploreBtn = page.getByRole("button", { name: /explore/i }).first();
  await exploreBtn.click();
  // The dropdown menu has the role=menu container.
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 2000 });
});

test("Explore dropdown shows Pricing, Use Cases, and Contact entries", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /explore/i }).first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").getByText(/plans & pricing/i)).toBeVisible();
  await expect(page.getByRole("menu").getByText(/use cases/i)).toBeVisible();
  await expect(page.getByRole("menu").getByText(/contact us/i)).toBeVisible();
});

test("TopBar shows the brand + a single Sign in CTA for unauthenticated visitors", async ({ page }) => {
  // Post-074abfe: the not-logged-in state shows ONE primary "Sign in" CTA
  // (Sign in + Sign up were collapsed — both opened the same auth modal).
  // Logged-in users see the UserDropdown instead (covered by I-23 in the
  // integration suite).
  await page.goto("/");
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  const actions = page.locator(".topbar-desktop-actions");
  await expect(actions.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  // The redundant Sign up button was intentionally removed.
  await expect(actions.getByRole("button", { name: /^sign up$/i })).toHaveCount(0);
});

test("guest trial status aligns with the Sign in button's menu edge", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const signIn = page
    .locator(".topbar-desktop-actions")
    .getByRole("button", { name: /^sign in$/i });
  const trialStatus = page.locator(".guest-trial-bar");

  await expect(signIn).toBeVisible();
  await expect(trialStatus).toBeVisible();

  const [signInBox, trialStatusBox] = await Promise.all([
    signIn.boundingBox(),
    trialStatus.boundingBox(),
  ]);
  if (!signInBox || !trialStatusBox) {
    throw new Error("Expected the Sign in button and trial status to have layout boxes.");
  }

  expect(
    Math.abs(
      signInBox.x + signInBox.width - (trialStatusBox.x + trialStatusBox.width),
    ),
  ).toBeLessThanOrEqual(1);
});
