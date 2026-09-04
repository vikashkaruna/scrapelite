// e2e/journeys/workflows-authenticated.spec.js
//
// The signed-in staging pass for Intelligence Workflows (TS-9 in
// docs/TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md).
//
// ── HOW TO RUN IT ───────────────────────────────────────────────────────────
//
//   STAGING_URL=https://staging--datiqapp.netlify.app \
//   STAGING_TEST_EMAIL=<the account you created> \
//   STAGING_TEST_PASSWORD=<its password> \
//     npx playwright test --project=chromium e2e/journeys/workflows-authenticated.spec.js
//
// 🔒 CREDENTIALS COME FROM THE ENVIRONMENT AND NOWHERE ELSE.
// There is no default, no fallback, and no fixture file. Without both variables
// every test SKIPS rather than fails, so this can sit in the repository and in
// CI without turning red for the absence of a secret — and so a credential
// never has to be committed to make the suite green.
//
// The password is never logged: Playwright's trace and video are disabled for
// this file, and `fill()` values do not appear in the HTML report body.
//
// ── WHY THIS IS SEPARATE FROM THE SMOKE SUITE ───────────────────────────────
//
// `npm run test:e2e:smoke` runs against a local build with offline mocks and
// must stay hermetic and fast. This runs against a REAL deployment with a REAL
// account and REAL crawls, so it is slower, needs credentials, and can be
// affected by third-party sites. Mixing the two would make the fast gate flaky.

import { test, expect } from "playwright/test";

const BASE = process.env.STAGING_URL || "https://staging--datiqapp.netlify.app";
const EMAIL = process.env.STAGING_TEST_EMAIL;
const PASSWORD = process.env.STAGING_TEST_PASSWORD;

const HAVE_CREDS = Boolean(EMAIL && PASSWORD);

// No trace, no video, no screenshots for this file: all three would capture the
// sign-in form with the password field populated. Must be top-level — Playwright
// refuses `test.use` inside a describe block.
test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("Intelligence Workflows — signed in on staging", () => {
  // Skip, do not fail. A missing credential is an absent prerequisite, not a
  // defect, and a suite that goes red for it teaches people to ignore red.
  test.skip(!HAVE_CREDS,
    "Set STAGING_TEST_EMAIL and STAGING_TEST_PASSWORD to run the authenticated pass.");

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    // Sign in through the app's own modal rather than seeding a session
    // cookie, because "can this account actually sign in" is one of the things
    // under test.
    await page.getByRole("button", { name: /sign in|sign up free/i }).first().click();
    await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
    await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // The user menu only renders for a real session.
    await expect(page.locator(".user-dropdown, [data-testid='user-menu']").first())
      .toBeVisible({ timeout: 20_000 });
  });

  test("S-01 the account carries the plan it was granted", async ({ page }) => {
    await page.goto(`${BASE}/account`);
    await expect(page.getByText(/agency|business/i).first()).toBeVisible();
  });

  test("S-02 the template catalogue renders for a signed-in user", async ({ page }) => {
    await page.goto(`${BASE}/templates`);
    await expect(page.locator(".template-card, [data-testid='template-card']").first())
      .toBeVisible({ timeout: 15_000 });
  });

  test("S-07 /lists shows the workspace, not the signed-out gate", async ({ page }) => {
    await page.goto(`${BASE}/lists`);
    // The signed-out state is the thing that must NOT appear.
    await expect(page.getByText(/create a free account/i)).toHaveCount(0);
  });

  test("S-13 /watchlists shows the workspace", async ({ page }) => {
    await page.goto(`${BASE}/watchlists`);
    await expect(page.getByText(/create a free account/i)).toHaveCount(0);
  });

  test("S-20 /rules shows the rule builder", async ({ page }) => {
    await page.goto(`${BASE}/rules`);
    await expect(page.getByText(/create a free account/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /new routing rule/i })).toBeVisible();
  });

  test("S-24 the two new crons are visible to an operator", async ({ page }) => {
    // Admin is PIN-gated separately; skip unless the PIN is supplied too.
    test.skip(!process.env.STAGING_ADMIN_PIN, "Set STAGING_ADMIN_PIN to check /admin/monitoring.");
    await page.goto(`${BASE}/admin`);
    await page.getByRole("textbox").first().fill(process.env.STAGING_ADMIN_PIN);
    await page.getByRole("button", { name: /unlock|sign in|enter/i }).first().click();
    await page.goto(`${BASE}/admin/monitoring`);
    await expect(page.getByText(/watchlist monitor/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/bulk enrichment runner/i)).toBeVisible();
  });

  test("X-01 the private workspaces are noindex", async ({ page }) => {
    for (const path of ["/lists", "/watchlists", "/rules"]) {
      await page.goto(`${BASE}${path}`);
      const robots = await page.locator('meta[name="robots"]').first().getAttribute("content");
      expect(robots, `${path} must be noindex`).toMatch(/noindex/i);
    }
  });
});
