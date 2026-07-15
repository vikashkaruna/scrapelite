// e2e/smoke/deeplink-dashboard.spec.js — FR-BH-03
// `/dashboard` is a public deep link. With no saved extractions the page
// should show its empty state (the bookmark icon + "Nothing saved yet"
// CTA from R6) rather than 404 or 200-with-blank-shell. The test does not
// require sign-in.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("/dashboard renders the empty state for an unauthenticated visitor", async ({ page }) => {
  const response = await page.goto("/dashboard");
  expect(response?.ok()).toBeTruthy();
  // The H1's exact text depends on the user's persona (e.g. "Your
  // extractions" for the default, "Prospect Research" for the sales
  // persona). Asserting on a stable substring keeps the test honest
  // about the visible state without coupling to the persona table.
  await expect(
    page.getByRole("heading", { name: /extractions|Prospect|Competitor|Market|SEO|Lead|Builder/i }),
  ).toBeVisible({ timeout: 10_000 });
  // The empty-state CTA from R6 is the only "Extract a page" button on
  // this route. It's rendered as a `<button>` (not a link) — it navigates
  // via `navigate("/")` inside the Dashboard component.
  await expect(
    page.getByRole("button", { name: /Extract a page/i }).first(),
  ).toBeVisible();
});
