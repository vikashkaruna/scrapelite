// e2e/smoke/admin-monitoring.spec.js
// K-31 — /admin/monitoring and /admin/health render inside the admin shell and
// behave correctly against stubbed endpoints.
//
// The two properties worth an end-to-end test (as opposed to a unit test):
//   • The destructive job's "Run now" is genuinely non-clickable in a real
//     browser, not merely refused by the server.
//   • An unconfigured service renders as "Not checked" and does not turn the
//     page red — the failure mode that would make the dashboard untrustworthy.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

const ISO = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const MONITORING_SNAPSHOT = {
  ok: true,
  generatedAt: ISO(0),
  historyAvailable: true,
  jobs: [
    {
      id: "scheduled-runner", label: "Schedule runner",
      description: "Executes every user monitoring schedule that is due this hour.",
      schedule: "@hourly", cron: "0 * * * *", category: "extraction",
      destructive: false, critical: false, caveat: "", manualRunAllowed: true,
      enabled: true, control: { enabled: true, source: "default" },
      state: "healthy", reason: "Running on schedule.",
      lastRunAt: ISO(-30 * 60_000), lastSuccessAt: ISO(-30 * 60_000),
      nextRunAt: ISO(30 * 60_000), runs: [],
    },
    {
      id: "billing-purge", label: "Data purge (day 90)",
      description: "The only destructive job in the system.",
      schedule: "@daily", cron: "0 4 * * *", category: "billing",
      destructive: true, critical: true, caveat: "", manualRunAllowed: false,
      enabled: true, control: { enabled: true, source: "default" },
      state: "healthy", reason: "Running on schedule.",
      lastRunAt: ISO(-3 * 3600_000), lastSuccessAt: ISO(-3 * 3600_000),
      nextRunAt: ISO(20 * 3600_000), runs: [],
    },
  ],
  jobSummary: {
    total: 2, healthy: 2, running: 0, stale: 0, failing: 0,
    stuck: 0, disabled: 0, neverRun: 0, worst: "healthy",
  },
  schedules: [{
    id: "sch_1", userId: "user-abc", label: "Competitor pricing",
    target: "https://example.com/pricing", type: "track", intent: "pricing",
    cron: "0 9 * * *", state: "active", userPaused: false, systemPaused: false,
    systemPauseReason: null, expired: false, endsAt: null,
    lastRunAt: ISO(-2 * 3600_000), lastStatus: "ok", nextRunAt: ISO(6 * 3600_000),
  }],
  scheduleSummary: { total: 1, active: 1, paused: 0, systemPaused: 0, expired: 0, failing: 0 },
  audit: [],
};

const HEALTH_SNAPSHOT = {
  ok: true,
  generatedAt: ISO(0),
  overall: "ok",
  summary: { total: 3, ok: 2, degraded: 0, down: 0, unknown: 1, overall: "ok" },
  components: [
    {
      id: "netlify-site", label: "Netlify site", group: "platform", critical: true,
      description: "The deployed site: published deploy state, branch and build recency.",
      status: "ok", latencyMs: 180, latencyGrade: "fast",
      detail: { branch: "main", state: "ready" }, note: "", checkedAt: ISO(0),
    },
    {
      id: "supabase-db", label: "Supabase database", group: "database", critical: true,
      description: "PostgREST round-trip against a real table.",
      status: "ok", latencyMs: 95, latencyGrade: "fast", detail: {}, note: "", checkedAt: ISO(0),
    },
    {
      id: "payments-razorpay", label: "Payments (Razorpay)", group: "services", critical: false,
      description: "Razorpay's public status page.",
      status: "unknown", latencyMs: null, latencyGrade: null, detail: {},
      note: "Not configured — needs RAZORPAY_KEY_ID.", checkedAt: ISO(0),
    },
  ],
  uptime: { "supabase-db": { samples: 24, uptimePct: 99.9, avgLatencyMs: 110, maxLatencyMs: 420 } },
  uptimeWindowHours: 24,
  historyAvailable: true,
  samplesInWindow: 48,
  recorded: false,
  groups: [
    { id: "platform", label: "Hosting & edge", icon: "server" },
    { id: "database", label: "Data & identity", icon: "database" },
    { id: "services", label: "External services", icon: "network" },
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
  await page.route("**/api/admin-monitoring", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MONITORING_SNAPSHOT) }));
  await page.route("**/api/admin-health*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HEALTH_SNAPSHOT) }));
});

// ── Navigation ───────────────────────────────────────────────────────────────

test("the admin sidebar links to Automation and Health", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/revenue");
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  await expect(page.locator(".admin-nav").getByText("Automation")).toBeVisible();
  await expect(page.locator(".admin-nav").getByText("Health")).toBeVisible();
});

test("clicking Automation navigates to the monitoring dashboard", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/revenue");
  await page.locator(".admin-nav").getByText("Automation").click();
  await expect(page).toHaveURL(/\/admin\/monitoring$/);
  await expect(page.getByRole("heading", { name: /Automation Monitoring/i })).toBeVisible();
});

// ── Automation dashboard ─────────────────────────────────────────────────────

test("/admin/monitoring lists jobs with status, last success and next run", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  await expect(page.getByText("Schedule runner")).toBeVisible();
  await expect(page.getByText("Data purge (day 90)")).toBeVisible();
  await expect(page.locator(".ops-pill-ok").first()).toBeVisible();
  // Matched loosely on purpose: the fixture timestamps are relative to module
  // load, so pinning "30m ago" exactly makes the test fail whenever the browser
  // takes a minute to get here.
  await expect(page.getByText(/\d+m ago/).first()).toBeVisible();
  await expect(page.getByText(/in \d+m/).first()).toBeVisible();
});

test("the destructive job is labelled and its Run now button is disabled", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await expect(page.getByText("Destructive")).toBeVisible();
  const runBtn = page.getByTitle(/its schedule is the only way to trigger it/);
  await expect(runBtn).toBeVisible();
  await expect(runBtn).toBeDisabled();
});

test("stopping a job requires a reason before the confirm button enables", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await page.getByTitle("Stop this job").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Stop job" });
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/Reason/).fill("stopping during the migration");
  await expect(confirm).toBeEnabled();

  // Cancel rather than mutate — this spec asserts the gate, not the write.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("user schedules render with their cadence and controls", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await expect(page.getByText("Competitor pricing")).toBeVisible();
  await expect(page.getByText("https://example.com/pricing")).toBeVisible();
  await expect(page.getByTitle("System-pause this schedule")).toBeVisible();
});

test("expanding a job reveals its description and cron", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await page.getByLabel(/Expand Schedule runner/).click();
  await expect(page.getByText(/Executes every user monitoring schedule/)).toBeVisible();
  await expect(page.getByText("No runs recorded yet.")).toBeVisible();
});

// ── Health dashboard ─────────────────────────────────────────────────────────

test("/admin/health shows the overall verdict and grouped components", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: /Service Health/i })).toBeVisible();
  await expect(page.getByText(/All monitored systems are operational/)).toBeVisible();
  // By role: "External services" also appears inside the page's intro
  // paragraph, so a bare text match is ambiguous.
  await expect(page.getByRole("heading", { name: "Hosting & edge" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data & identity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "External services" })).toBeVisible();
});

// The failure mode that would make the whole dashboard untrustworthy.
test("an unconfigured service reads as 'Not checked', not as an outage", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/health");
  const card = page.locator(".ops-health-card", { hasText: "Payments (Razorpay)" });
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/ops-health-unchecked/);
  await expect(card.getByText("Not checked")).toBeVisible();
  await expect(page.getByText("1 not checked")).toBeVisible();
  // …and the headline is still green.
  await expect(page.locator(".ops-overall")).toHaveClass(/ops-overall-ok/);
});

test("benchmarks show latency and uptime per component", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "Benchmarks" })).toBeVisible();
  await expect(page.getByText("99.9%").first()).toBeVisible();
  await expect(page.getByText("420ms")).toBeVisible();
  await expect(page.getByText("95ms").first()).toBeVisible();
});

test("the uptime window can be changed", async ({ page }) => {
  await enterAdmin(page);
  await page.goto("/admin/health");
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(page.getByRole("button", { name: "7d", exact: true })).toHaveClass(/active/);
});

test("both pages survive an endpoint failure without going blank", async ({ page }) => {
  await page.route("**/api/admin-monitoring", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Missing admin token." }) }));
  await enterAdmin(page);
  await page.goto("/admin/monitoring");
  await expect(page.getByText("Missing admin token.")).toBeVisible();
  // The shell and headings are still there — an error banner, not a white screen.
  await expect(page.getByRole("heading", { name: /Automation Monitoring/i })).toBeVisible();
});
