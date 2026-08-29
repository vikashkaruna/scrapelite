// e2e/smoke/discoverability.spec.js
// The Discoverability module renders, explains itself before anything is run,
// and makes no promise it cannot keep.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("the route renders with the composer and the four pillars", async ({ page }) => {
  await page.goto("/discoverability");
  await expect(page.getByRole("heading", { name: /Discoverability/i, level: 1 })).toBeVisible();
  await expect(page.getByLabel(/URL to audit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Run audit/i })).toBeVisible();

  for (const pillar of ["Answer Clarity", "Entity Authority", "Structural Hierarchy", "Technical Accessibility"]) {
    await expect(page.getByText(pillar, { exact: true })).toBeVisible();
  }
});

test("makes no promise about rankings, citations or traffic", async ({ page }) => {
  // The single most important claim boundary in the module. Every surface
  // repeats it, and this is the one that runs against the real page.
  await page.goto("/discoverability");
  await expect(page.getByText(/not a prediction of rankings, citations or traffic/i)).toBeVisible();
});

test("advanced options expose the profile lens and say it does not rescore", async ({ page }) => {
  await page.goto("/discoverability");
  // Standard smoke coverage runs with first-visit tours marked as seen; the
  // dedicated discoverability-tour spec verifies the overlay itself.
  await expect(page.getByRole("dialog", { name: /score how discoverable/i })).toHaveCount(0);
  await page.getByRole("button", { name: /Advanced options/i }).click();
  for (const p of ["Balanced", "SEO-heavy", "AEO-heavy", "GEO-heavy"]) {
    await expect(page.getByRole("button", { name: p, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/All four are always computed with the\s+same weightings/i)).toBeVisible();
});

test("refuses an empty URL without navigating away", async ({ page }) => {
  await page.goto("/discoverability");
  await page.getByRole("button", { name: /Run audit/i }).click();
  await expect(page.getByRole("alert")).toContainText(/Paste the URL/i);
  await expect(page).toHaveURL(/\/discoverability/);
});

test("is reachable from the top navigation", async ({ page }) => {
  await page.goto("/");
  // The main nav renders BUTTONS that call navigate(), not anchors — see
  // TopBar.jsx. Selecting on a[href] finds nothing.
  // The nav label is the short form "Discover"; the page <h1> it leads to is
  // still "Discoverability".
  const nav = page.getByRole("button", { name: /^Discover$/i }).first();
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page).toHaveURL(/\/discoverability/);
});

test("is excluded from indexing, like every other signed-in tool", async ({ page }) => {
  await page.goto("/discoverability");
  const robots = page.locator('meta[name="robots"]');
  // The inline guard in index.html adds noindex for private prefixes; the
  // X-Robots-Tag header in netlify.toml is the version that works without JS.
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("the help guide for it is published", async ({ page }) => {
  const res = await page.goto("/help/11-discoverability-seo-aeo-and-geo-audits.html");
  expect(res.status()).toBe(200);
  await expect(page.getByText(/Answer Clarity/i).first()).toBeVisible();
  await expect(page.getByText(/not measured/i).first()).toBeVisible();
});

// ── The Discover door on the Home composer ─────────────────────────────────
// A DOOR, not a second implementation. It hands the pasted URL to
// /discoverability rather than auditing anything itself — duplicating even a
// thin version of the flow would mean two entry points that must keep telling
// the same story about quota, compliance refusals and the signed-in rule, which
// is exactly how the guest-credit leak happened.
test("the Home composer offers Discover for a single URL, and it navigates", async ({ page }) => {
  await page.goto("/");
  const composer = page.locator(".hero-composer");
  await composer.locator("textarea, input[type=text]").first().fill("https://example.com/pricing");

  // Scoped to the composer: the top nav also has a "Discover" item, and an
  // unscoped match would silently pass by clicking the nav — testing the
  // navigation we did not write instead of the button we did.
  const discover = composer.getByRole("button", { name: /^Discover$/i });
  await expect(discover).toBeVisible();
  await discover.click();

  await expect(page).toHaveURL(/\/discoverability/);
  await expect(page.getByRole("heading", { name: /Discoverability/i, level: 1 })).toBeVisible();
  // Prefilled, NOT auto-run: the user has not chosen a profile, device or page
  // type, and auto-running would spend an audit credit on defaults they never
  // saw. The button is theirs to press.
  await expect(page.getByLabel(/URL to audit/i)).toHaveValue(/example\.com\/pricing/);
});

test("Discover is not offered for pasted text — there is no URL to audit", async ({ page }) => {
  await page.goto("/");
  await page.locator(".hero-composer").locator("textarea, input[type=text]").first()
    .fill("just some prose with no link in it at all");
  await expect(page.locator(".hero-composer").getByRole("button", { name: /^Discover$/i })).toHaveCount(0);
});
