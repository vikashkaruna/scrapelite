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
