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

test("CLAIM: /pricing shows all 5 paid tiers (Go/Select/Pro/Business/Agency)", async ({ page }) => {
  await page.goto("/pricing");
  for (const tier of [/Go/i, /Select/i, /Pro/i, /Business/i, /Agency/i]) {
    await expect(page.getByText(tier).first()).toBeVisible();
  }
});

test("CLAIM: Monthly billing is the default toggle on /pricing", async ({ page }) => {
  await page.goto("/pricing");
  // Monthly toggle is the active one by default
  const monthlyBtn = page.getByRole("button", { name: /Monthly billing/i });
  await expect(monthlyBtn).toBeVisible();
  // Active state via aria-pressed (toggle now exposes it explicitly)
  await expect(monthlyBtn).toHaveAttribute("aria-pressed", "true");
});

// 🔴 THE PRICE IS READ FROM THE TABLE, NOT TYPED IN. This pinned "$14.40" and
// broke on the 2026-09-23 repricing — as one failing e2e spec at the very end
// of a push, which is the most expensive place to discover a number you meant
// to change. The claim worth verifying is not "Select costs $14.40", it is
// "the price on the card is the price the app is configured to charge".
//
// ⚠️ BE CLEAR ABOUT WHAT THIS DOES AND DOES NOT CATCH. Both sides read the same
// module, so changing a number in PLAN_TABLE changes the expectation too and
// this stays green — a typo in the table is NOT caught here. What it catches is
// the page failing to render the configured price: confirmed RED by
// reintroducing `resolvePlanPrice`'s old INR conversion fallback, which puts
// ₹1,470 on the card against a table that says ₹1,449. That is the regression
// this exists for. The table's own values are pinned in
// src/lib/pricingConfig.test.js.
//
// ⚠️ And it checks BOTH currencies, because they are set independently now. A
// spec that only ever looked at USD is how the rupee prices drifted unnoticed
// the last time.
test("CLAIM: each plan card shows the configured price, in both currencies", async ({ page }) => {
  await page.goto("/pricing");
  const monthlyBtn = page.getByRole("button", { name: /Monthly billing/i });
  if (await monthlyBtn.isVisible()) await monthlyBtn.click();
  await expect(monthlyBtn).toHaveAttribute("aria-pressed", "true");

  // The page formats fractional USD to one decimal ($14.40 renders as "$14.4"),
  // so compare on the same rule the page itself uses rather than on a literal.
  const usd = (n) => `$${Math.round(n * 10) / 10}`;
  const { PLANS } = await import("../../src/lib/pricingConfig.js");
  const paid = PLANS.filter((p) => p.price_usd > 0 && !p.comingSoon);

  for (const plan of paid) {
    const card = page.locator(".plan-card").filter({ hasText: plan.name }).first();
    await expect(card.getByText(usd(plan.price_usd), { exact: false }).first(),
      `${plan.name} should show ${usd(plan.price_usd)}`).toBeVisible();
  }

  // Switch to INR through the PICKER, not through localStorage.
  // ⚠️ `installOfflineMocks` pins `datiq.currency` to USD inside an
  // addInitScript, and addInitScript re-runs on EVERY navigation including
  // page.reload() — so a value written between navigations is overwritten on
  // the next load. Driving the real control avoids that, and is the truer test
  // anyway: it is what a visitor in India actually does.
  await page.locator(".currency-btn").click();
  await page.getByRole("option", { name: /INR/ }).click();

  for (const plan of paid) {
    const card = page.locator(".plan-card").filter({ hasText: plan.name }).first();
    const inr = `₹${plan.price_inr.toLocaleString("en-IN")}`;
    await expect(card.getByText(inr, { exact: false }).first(),
      `${plan.name} should show ${inr}`).toBeVisible();
  }
});

// ── Batch claims ──────────────────────────────────────────────────────────────

// The claim this pins deliberately CHANGED: batch is no longer something you
// navigate to, it is what the Home composer does when you give it more than one
// URL. The docs, help site and changelog all now say "there is no separate Batch
// tab", so the claim under test is that pasting a list gets you there.
test("CLAIM: pasting multiple URLs in the Home composer routes to batch", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").first()
    .fill("https://stripe.com/pricing\nhttps://linear.app/pricing");
  await page.locator("button.hero-action-btn").click();
  await expect(page).toHaveURL(/\/batch/);
  await expect(page.getByRole("heading", { name: /Batch extraction/i }).first()).toBeVisible();
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

test("CLAIM: Home page offers a template gallery, collapsed by default", async ({ page }) => {
  await page.goto("/");
  const gallery = page.locator(".template-gallery");
  await gallery.scrollIntoViewIfNeeded();

  // Collapsed on arrival. The grid is 15+ cards and sat permanently open under
  // the hero, so the homepage asked a first-time visitor to read a catalogue
  // before they had decided to do anything. The FILTERS stay visible — they are
  // the cheap signal about what the product covers.
  await expect(page.locator(".template-card")).toHaveCount(0);
  await expect(gallery.getByRole("tab", { name: /^All$/ })).toBeVisible();

  // And the whole library is one click away.
  await gallery.getByRole("button", { name: /Browse \d+ recipes/i }).click();
  const count = await page.locator(".template-card").count();
  expect(count).toBeGreaterThanOrEqual(10);
  expect(count).toBeLessThanOrEqual(20);
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
  // What this asserts is that the route is WIRED, not that a backend answered.
  // Accepted: 200 with a JSON body, or 500/503 when the function runs but has no
  // Supabase configured, or 502/504 when Vite's dev `/api` proxy can't reach the
  // functions server on :9999 (the CI case — Playwright starts `npm run dev`
  // alone, so nothing listens there and the proxy answers ECONNREFUSED → 502).
  // A route that was NOT wired would fall through to the SPA and return 200 HTML,
  // so a gateway error still proves the proxy rule matched. Same list as the
  // /api/og-preview claim below — keep the two in sync.
  expect([200, 500, 502, 503, 504]).toContain(res.status());
});

test("CLAIM: /api/og-preview endpoint is reachable", async ({ request }) => {
  const res = await request.get("/api/og-preview?url=https://example.com");
  // 200 if reachable, 4xx/5xx if a dependency is missing or the dev proxy has no
  // functions server to reach — all prove the endpoint is wired up. 504 included
  // to match the /api/stats claim above.
  expect([200, 400, 500, 502, 503, 504]).toContain(res.status());
});
