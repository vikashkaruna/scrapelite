import { expect, test } from "playwright/test";
import { installOfflineMocks } from "./support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("the core SPA routes are served without configured integrations", async ({ page }) => {
  const home = await page.goto("/");
  expect(home?.ok()).toBeTruthy();
  // H1 is the new brand tagline post-rebrand (rebrand-datiq-and-fix-checkout-bugs).
  // Pin the copy so a regression in Home.jsx hero is caught here, not just on
  // the about page.
  await expect(page.getByRole("heading", { name: /Intelligence from the Web/i })).toBeVisible();

  const dashboard = await page.goto("/dashboard");
  expect(dashboard?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: /Your extractions/i })).toBeVisible();

  // Preview intentionally redirects to Home until an extraction exists, but a
  // direct request must still be served by the SPA instead of returning a 404.
  const preview = await page.goto("/preview");
  expect(preview?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Intelligence from the Web/i })).toBeVisible();
});
