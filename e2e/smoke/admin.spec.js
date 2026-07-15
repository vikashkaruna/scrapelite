// e2e/smoke/admin.spec.js
// K-23 — Admin gate renders; ADMIN123 (dev fallback) unlocks the admin shell;
// sub-routes load.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
  // Stub the admin-auth function call to 401 (forces the dev fallback path
  // that accepts ADMIN123).
  await page.route("**/.netlify/functions/admin-auth", async (route) => {
    await route.fulfill({ status: 503, body: "offline" });
  });
});

test("/admin shows the PIN gate", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText(/admin access/i)).toBeVisible();
  await expect(page.getByPlaceholder(/admin pin/i)).toBeVisible();
});

test("ADMIN123 dev fallback unlocks the admin shell", async ({ page }) => {
  await page.goto("/admin");
  await page.getByPlaceholder(/admin pin/i).fill("ADMIN123");
  await page.getByRole("button", { name: /enter admin/i }).click();
  // The sidebar appears.
  await expect(page.locator(".admin-sidebar")).toBeVisible({ timeout: 5000 });
  // The Revenue page is the default route.
  await expect(page).toHaveURL(/\/admin\/revenue$/);
});

test("/admin/pricing sub-route loads inside the admin shell", async ({ page }) => {
  // Pre-seed the auth token so we skip the PIN gate.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("scrapelite.adminAuth", "local." + (Date.now() + 8 * 3600 * 1000));
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 8 * 3600 * 1000));
  });
  await page.goto("/admin/pricing");
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  // The pricing admin section has a "Generate SQL" button.
  await expect(page.getByRole("button", { name: /generate sql/i })).toBeVisible();
});

test("/admin/users sub-route loads inside the admin shell", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("scrapelite.adminAuth", "local." + (Date.now() + 8 * 3600 * 1000));
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 8 * 3600 * 1000));
  });
  await page.goto("/admin/users");
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  // The users page renders a "User Management" h2.
  await expect(page.getByRole("heading", { name: /User Management/i })).toBeVisible();
});
