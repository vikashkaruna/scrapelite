// The Discoverability tour is deliberately independent of the Home tour.
// Ordinary smoke specs suppress both overlays through installOfflineMocks so
// they can test their target control; this spec opts in to prove a first-time
// visitor still sees the Discoverability walkthrough.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test("first-time Discoverability visitor receives its independent tour", async ({ page }) => {
  await installOfflineMocks(page, { tours: "show" });
  await page.goto("/discoverability");

  await expect(page.getByRole("dialog", { name: /score how discoverable a page really is/i })).toBeVisible();
  await expect(page.getByText("Step 1 of 5")).toBeVisible();

  await page.getByRole("button", { name: /^Next/i }).click();
  await expect(page.locator(".tour-spotlight")).toBeVisible();
});
