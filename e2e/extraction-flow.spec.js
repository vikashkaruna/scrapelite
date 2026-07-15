import { expect, test } from "playwright/test";
import { installOfflineMocks } from "./support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

// M0 smoke: confirms the home composer + dashboard are reachable as
// the two ends of the extraction journey. The full extract → enrich →
// reload → dashboard flow requires a real extraction endpoint, which
// the offline-mock boundary intentionally disables. That end-to-end
// coverage lands in M4 (smoke port) once the offline-mock boundary
// supports a fixture that simulates a successful extraction.

test("home composer and dashboard are reachable", async ({ page }) => {
  await page.goto("/");
  // The composer is the home page's primary affordance. Asserting the
  // URL field is present is a tighter contract than asserting the H1 —
  // the URL field is what the user actually interacts with.
  const urlField = page.locator("textarea").first();
  await expect(urlField).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /extractions|Prospect|Competitor|Market|SEO|Lead|Builder/i }),
  ).toBeVisible({ timeout: 10_000 });
});
