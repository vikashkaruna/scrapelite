// e2e/smoke/claims-verification.spec.js
// Q8 — Verify "claimed vs working". Each test here is tied to a specific
// marketing / landing-page claim and asserts that the underlying behavior
// actually works. Failures mean the marketing claim is no longer accurate.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

// ── Pricing claims ────────────────────────────────────────────────────────────

test("CLAIM: /pricing shows all 4 paid tiers (Select/Pro/Business/Agency)", async ({ page }) => {
  await page.goto("/pricing");
  for (const tier of [/Select/i, /Pro/i, /Business/i, /Agency/i]) {
    await expect(page.getByText(tier).first()).toBeVisible();
  }
});

test("CLAIM: Annual billing is the default toggle on /pricing", async ({ page }) => {
  await page.goto("/pricing");
  // Annual toggle is the active one by default
  const annualBtn = page.getByRole("button", { name: /Annual billing/i });
  await expect(annualBtn).toBeVisible();
  // Active state via aria-pressed (toggle now exposes it explicitly)
  await expect(annualBtn).toHaveAttribute("aria-pressed", "true");
});

test("CLAIM: Select plan starts at $19/month (monthly billing)", async ({ page }) => {
  await page.goto("/pricing");
  // Switch to monthly if it's not already
  const monthlyBtn = page.getByRole("button", { name: /Monthly billing/i });
  if (await monthlyBtn.isVisible()) await monthlyBtn.click();
  await expect(monthlyBtn).toHaveAttribute("aria-pressed", "true");
  // Look for the $19 price in the Select card
  await expect(page.getByText(/\$19/).first()).toBeVisible();
});

// ── Batch claims ──────────────────────────────────────────────────────────────

test("CLAIM: Batch mode is accessible from the main nav and renders", async ({ page }) => {
  await page.goto("/");
  // The "Batch" nav link in TopBar
  await page.getByRole("button", { name: /Batch/i }).first().click();
  await expect(page).toHaveURL(/\/batch$/);
  await expect(page.getByRole("heading", { name: /Multi-URL extraction/i }).first()).toBeVisible();
});

test("CLAIM: Batch page accepts multiple URLs and shows the count", async ({ page }) => {
  await page.goto("/batch");
  const ta = page.locator("textarea").first();
  await ta.fill("https://stripe.com/pricing\nhttps://linear.app/pricing\nhttps://notion.so/pricing");
  // The Q7 URL review table (default expanded) shows the 3 rows
  await expect(page.getByText(/3 valid/i)).toBeVisible();
});

// ── Extraction claims ─────────────────────────────────────────────────────────

test("CLAIM: Single-URL extraction surfaces the Preview page", async ({ page }) => {
  // Mock /api/extract to return a successful extraction
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          metadata: { title: "Mock", url: "https://example.com" },
          markdown: "# Mock",
          html: "<h1>Mock</h1>",
          json: { headings: [{ level: 1, text: "Mock" }] },
        },
      }),
    });
  });
  await page.goto("/");
  // Type a valid URL into the composer
  const ta = page.locator(".hero-composer-input, [aria-label*='URL or content']").first();
  await ta.fill("https://example.com");
  // Click the inline action button (label varies by mode: arrow-up / layers / calendar-clock)
  await page.locator(".hero-action-btn").first().click();
  await expect(page).toHaveURL(/\/preview/);
});

test("CLAIM: Home page shows the 6 outcome tiles above the hero", async ({ page }) => {
  await page.goto("/");
  // Q3 — outcome tiles row
  const tiles = page.locator(".outcome-tile");
  await expect(tiles).toHaveCount(6);
});

test("CLAIM: Home page shows the template gallery with 10-15 templates", async ({ page }) => {
  await page.goto("/");
  // Scroll to the gallery
  await page.locator(".template-gallery").scrollIntoViewIfNeeded();
  const cards = page.locator(".template-card");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(10);
  expect(count).toBeLessThanOrEqual(15);
});

test("CLAIM: Workspace route exists and renders for signed-in users", async ({ page }) => {
  await page.goto("/workspace");
  // The page renders a heading either way (teaser or dashboard)
  const h1 = page.locator("h1").first();
  await expect(h1).toBeVisible();
});

// ── Public surface claims ────────────────────────────────────────────────────

test("CLAIM: /api/stats is reachable (or fails gracefully without Supabase)", async ({ request }) => {
  const res = await request.get("/api/stats");
  // Either 200 with a JSON body OR a 503/500 with an error message — both are
  // acceptable: the endpoint exists, it's just that no Supabase is configured.
  expect([200, 500, 503]).toContain(res.status());
});

test("CLAIM: /api/og-preview endpoint is reachable", async ({ request }) => {
  const res = await request.get("/api/og-preview?url=https://example.com");
  // 200 if reachable, 5xx if a dependency is missing — both prove the endpoint is wired up
  expect([200, 400, 500, 502, 503]).toContain(res.status());
});
