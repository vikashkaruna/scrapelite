// e2e/smoke/home.spec.js
// K-02 — Home renders the composer + intent chips + feature cards + brand + footer.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("home shows the connected-intelligence H1, brand text, tagline, and footer", async ({ page }) => {
  await page.goto("/");
  // Brand mark + name in TopBar.
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  await expect(page.locator(".brand-tagline").first()).toHaveText("Intelligence, Connected.");
  await expect(page.getByRole("heading", { level: 1, name: /Intelligence, Connected/i })).toBeVisible();
  // Footer social/legal row.
  await expect(page.locator(".site-footer-slim")).toBeVisible();
});

test("home uses the approved Train A hero without the retired answer paragraph", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/DatIQ is a zero-code web intelligence platform/i)).toHaveCount(0);
});

test("DatIQ Intelligence preview tiles link to their product surfaces", async ({ page }) => {
  await page.goto("/");
  const preview = page.locator(".home-dashboard-reveal");
  await expect(preview.getByRole("link", { name: "Open Discoverability" })).toHaveAttribute("href", "/discoverability");
  await expect(preview.getByRole("link", { name: "Open Integrations" })).toHaveAttribute("href", "/integrations");
  await expect(preview.getByRole("link", { name: "Open Account Lists" })).toHaveAttribute("href", "/lists");
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

test("home hides the repeated capability grid; its unique items are a chip and a tile", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".feature-cell")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Page structure/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Write a content brief/ })).toBeVisible();
});

test("home shows a truthful six-module catalog", async ({ page }) => {
  await page.goto("/");
  const modules = page.locator(".home-module-card");
  await expect(modules).toHaveCount(6);
  await expect(modules.filter({ hasText: "DatIQ Discover" })).toContainText("Beta");
  await expect(modules.filter({ hasText: "DatIQ Discover" }).getByRole("button", { name: /Run a visibility audit/i })).toBeVisible();

  const upcoming = modules.filter({ hasText: "DatIQ Engage" });
  await expect(upcoming).toContainText("Upcoming");
  await expect(upcoming.getByRole("button")).toHaveCount(0);
});

test("the secondary hero CTA focuses the extraction composer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Paste a URL and see it work/i }).click();
  await expect(page.locator("#extract-composer textarea")).toBeFocused();
});

test("home does NOT have an inline multi-URL textarea toggle (R15 cleanup)", async ({ page }) => {
  await page.goto("/");
  // The "Use Batch mode →" hint link was removed in R15. The inline toggle
  // is also gone. This contract pins that.
  await expect(page.getByText(/Use Batch mode/i)).toHaveCount(0);
});

test("TopBar nav shows Extract / Discover / Dashboard (in that order) and Templates is in Explore", async ({ page }) => {
  await page.goto("/");
  // mainLinks are buttons in .topbar-desktop-actions.
  const nav = page.locator(".topbar-desktop-actions .nav-link");
  await expect(nav.nth(0)).toContainText(/Extract/i);
  // "Discover", not "Discoverability": the nav label is deliberately the
  // short form (TopBar.jsx explains why). The route and the page heading
  // keep the full word, so this must NOT be loosened to match both.
  await expect(nav.nth(1)).toContainText(/^Discover$/i);
  await expect(nav.nth(2)).toContainText(/Dashboard/i);

  // Templates was moved to the Explore menu just after Integrations (stays public).
  await page.getByRole("button", { name: /explore/i }).first().click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /templates/i })).toBeVisible();
});

test("TopBar has no Schedules nav item — it lives in the user menu", async ({ page }) => {
  await page.goto("/");
  // Removed for the same reason Batch was: every place a person forms the
  // intent to schedule something already offers the door (the Home composer's
  // cadence dropdown, Workspace, Dashboard's run history). A fifth primary
  // entry competed for space while duplicating routes reached from context.
  // The /schedules route is unchanged — only the nav item is gone.
  const nav = page.locator(".topbar-desktop-actions .nav-link");
  await expect(nav.filter({ hasText: /^\s*Schedules\s*$/i })).toHaveCount(0);
});

test("/schedules is still reachable directly", async ({ page }) => {
  // Removing the nav item must not strand the route.
  const res = await page.goto("/schedules");
  expect(res.status()).toBeLessThan(400);
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
