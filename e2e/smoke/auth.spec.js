// e2e/smoke/auth.spec.js
// K-18 — Clicking "Sign in" in the TopBar opens the AuthModal in sign-in mode.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("clicking 'Sign in' opens the AuthModal in sign-in mode", async ({ page }) => {
  await page.goto("/");
  // The TopBar's Sign in button (the desktop one — there are duplicates in
  // mobile/desktop views, so we scope to the desktop actions).
  await page.locator(".topbar-desktop-actions").getByRole("button", { name: /^sign in$/i }).click();
  // The AuthModal renders a dialog with role=dialog.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 3000 });
  // The default tab is "Sign in" (aria-selected=true).
  const signinTab = page.getByRole("tab", { name: /sign in/i });
  await expect(signinTab).toHaveAttribute("aria-selected", "true");
  // The "Create account" tab is present but not selected.
  const signupTab = page.getByRole("tab", { name: /create account/i });
  await expect(signupTab).toHaveAttribute("aria-selected", "false");
});
