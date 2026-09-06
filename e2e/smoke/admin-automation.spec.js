// e2e/smoke/admin-automation.spec.js
// E1 — /admin/automation renders inside the admin shell and behaves correctly
// against a stubbed /api/admin-automation.
//
// This page had unit coverage but no browser spec, so nothing checked that the
// route is actually reachable through the admin shell. It is the operator's
// only window onto the v2 workflow queue — the pipeline that, until 2026-09-06,
// had never once run on a cron because workflow-orchestrator was scheduled
// nowhere. A dashboard nobody can open is how that stays invisible.
//
// The properties worth a real browser (rather than a unit test):
//   • the route resolves through the admin sidebar, not just in isolation;
//   • a failing endpoint renders an error banner, not a white screen;
//   • clicking an event row opens its detail panel.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

const ISO = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const SNAPSHOT = {
  ok: true,
  stats: {
    byState: { pending: 3, processing: 1, done: 41, failed: 2 },
    last24h: { done: 41, failed: 2 },
    last24hTotal: 47,
    avgTimeToDoneMs: 42_000,
    byKind: { "schedule.changed": 30, "user.signup": 17 },
  },
  config: { mode: "event_driven", polling_interval_minutes: 60 },
  events: [
    {
      id: "evt_pending_001", state: "pending", kind: "schedule.changed",
      ref_id: "sch_abcdef123456789", attempts: 0, max_attempts: 5,
      created_at: ISO(-5 * 60_000), last_error: null,
    },
    {
      id: "evt_failed_002", state: "failed", kind: "user.signup",
      ref_id: "usr_zzz", attempts: 5, max_attempts: 5,
      created_at: ISO(-90 * 60_000),
      last_error: "n8n responded 502 Bad Gateway",
    },
  ],
};

/** Seed the admin session so the PIN gate is skipped. */
async function enterAdmin(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const exp = Date.now() + 8 * 3600 * 1000;
    localStorage.setItem("scrapelite.adminAuth", "local." + exp);
    localStorage.setItem("scrapelite.adminAuthExp", String(exp));
  });
}

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
  await page.route("**/.netlify/functions/admin-auth", (route) =>
    route.fulfill({ status: 503, body: "offline" }));
  await page.route("**/api/admin-automation*", (route) => {
    // The page uses ONE endpoint for two shapes: the list snapshot, and
    // ?event_id=<id> for a single event's detail ({ ok, event, runs }).
    // Returning the list shape for both leaves the detail panel blank.
    const id = new URL(route.request().url()).searchParams.get("event_id");
    const body = id
      ? { ok: true, event: SNAPSHOT.events.find((e) => e.id === id) || null, runs: [] }
      : SNAPSHOT;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("clicking Workflows in the sidebar reaches /admin/automation", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/revenue");
  await page.locator(".admin-nav").getByText("Workflows").click();
  await expect(page).toHaveURL(/\/admin\/automation$/);
  await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
});

test("the KPI row reports queue depth and 24h outcomes", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/automation");

  const kpis = page.locator(".admin-kpi-card");
  await expect(kpis.first()).toBeVisible();

  for (const label of ["Pending", "Processing", "Failed (24h)", "Done (24h)", "Total (24h)"]) {
    await expect(page.locator(".admin-kpi-card", { hasText: label })).toBeVisible();
  }
  // Values come from the fixture, so these are exact.
  await expect(page.locator(".admin-kpi-card", { hasText: "Pending" }).locator(".kpi-value"))
    .toHaveText("3");
  await expect(page.locator(".admin-kpi-card", { hasText: "Failed (24h)" }).locator(".kpi-value"))
    .toHaveText("2");
});

test("the events table lists queued work with state, kind and attempts", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/automation");

  const rows = page.locator(".automation-event-row");
  await expect(rows).toHaveCount(2);

  // Scoped to the table on purpose: the by-kind summary chips above it render
  // the same kind strings, so a bare getByText is a strict-mode violation.
  const table = page.locator(".automation-table");
  await expect(table.getByText("schedule.changed")).toBeVisible();
  await expect(table.getByText("user.signup")).toBeVisible();
  // A retry-exhausted event must SHOW it is exhausted, not just read "failed".
  await expect(rows.nth(1)).toContainText("5/5");
  await expect(rows.nth(1)).toContainText("n8n responded 502");
});

test("clicking an event row opens its detail panel", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/automation");

  await expect(page.locator(".automation-detail-empty")).toBeVisible();
  await page.locator(".automation-event-row").first().click();

  const detail = page.locator(".automation-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".automation-detail-id")).toHaveText("evt_pending_001");
  await expect(page.locator(".automation-event-row.selected")).toHaveCount(1);
});

test("the pipeline execution mode panel renders its current mode", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/automation");
  await expect(page.getByRole("heading", { name: /Pipeline Execution/i })).toBeVisible();
  await expect(page.locator(".automation-mode-badge")).toBeVisible();
});

test("a failing endpoint shows an error banner, not a white screen", async ({ page }) => {
  await page.route("**/api/admin-automation*", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Missing admin token." }),
    }));
  await enterAdmin(page);
  await page.goto("/admin/automation");

  await expect(page.getByText("Missing admin token.")).toBeVisible();
  // The shell survived: this is an error state, not a crash.
  await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toBeVisible();
});
