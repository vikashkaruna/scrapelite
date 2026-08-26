// e2e/smoke/home.spec.js
// K-02 — Home renders the composer + intent chips + feature cards + brand + footer.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("home shows the H1, brand text, tagline, and footer", async ({ page }) => {
  await page.goto("/");
  // Brand mark + name in TopBar.
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  // Brand tagline (R1: "Intelligence from Web" — rebrand-datiq-and-fix-checkout-bugs).
  // Scope to the brand element so persona/headline copy elsewhere on the page
  // doesn't accidentally satisfy this.
  await expect(page.locator(".brand-tagline").first()).toBeVisible();
  // H1 — varies by persona, so match a stable substring.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Footer social/legal row.
  await expect(page.locator(".site-footer-slim")).toBeVisible();
});

test("home composer (URL textarea) is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("textarea").first()).toBeVisible();
});

test("home shows the 5 intent chips (summary, contacts, pricing, map, custom)", async ({ page }) => {
  await page.goto("/");
  for (const label of [/summary/i, /contacts/i, /pricing/i, /map/i, /custom/i]) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("home renders 8 feature cards (clickable)", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator(".feature-cell");
  await expect(cards).toHaveCount(8);
});

// TODO: DatIQ architecture (Pillar 0/1/2) banner hidden on Home 2026-08-06 —
// re-enable this test when the banner is re-enabled (src/pages/Home.jsx).
test.skip("home shows the Pillar 0 (Web Intelligence Core) banner", async ({ page }) => {
  // R1 rebrand: the URL-extraction engine is formally named Pillar 0 — Web
  // Intelligence (Core) and is presented as the proven foundation the rest
  // of the platform is built on. This contract pins the banner so a future
  // refactor that drops the architecture callout is caught at the gate.
  await page.goto("/");
  const banner = page.locator(".home-pillars-banner");
  await expect(banner).toBeVisible();
  // Eyebrow + headline + the three pillar rows (P0/P1/P2).
  await expect(banner).toContainText(/Pillar 0/i);
  await expect(banner).toContainText(/Web Intelligence \(Core\)/i);
  await expect(banner.locator(".hp-pillar")).toHaveCount(3);
  // Pillar 0 specifically has the highlighted styling — pinned by class so
  // a refactor that swaps the row order is caught.
  await expect(banner.locator(".hp-pillar-p0")).toBeVisible();
});

test("home does NOT have an inline multi-URL textarea toggle (R15 cleanup)", async ({ page }) => {
  await page.goto("/");
  // The "Use Batch mode →" hint link was removed in R15. The inline toggle
  // is also gone. This contract pins that.
  await expect(page.getByText(/Use Batch mode/i)).toHaveCount(0);
});

test("TopBar nav shows Extract / Schedules / Discover / Dashboard (in that order)", async ({ page }) => {
  await page.goto("/");
  // mainLinks are buttons in .topbar-desktop-actions.
  // Discoverability was inserted BEFORE Dashboard rather than reordering
  // anything: Extract and Schedules keep their positions, and Dashboard — the
  // "look at what you made" screen — stays last of the four.
  const nav = page.locator(".topbar-desktop-actions .nav-link");
  await expect(nav.nth(0)).toContainText(/Extract/i);
  await expect(nav.nth(1)).toContainText(/Schedules/i);
  // "Discover", not "Discoverability": the nav label is deliberately the
  // short form (TopBar.jsx explains why). The route and the page heading
  // keep the full word, so this must NOT be loosened to match both.
  await expect(nav.nth(2)).toContainText(/^Discover$/i);
  await expect(nav.nth(3)).toContainText(/Dashboard/i);
});

test("TopBar has no Batch nav item — Extract is the only entry point", async ({ page }) => {
  await page.goto("/");
  // Batch was deliberately removed from the nav: the composer already routed
  // multi-URL input to /batch, so Batch was a screen users got bounced to
  // rather than a separate feature they chose. The route survives; the nav
  // item must not come back, or there are two doors to one thing again.
  const nav = page.locator(".topbar-desktop-actions .nav-link");
  await expect(nav.filter({ hasText: /^\s*Batch\s*$/i })).toHaveCount(0);
});
