// e2e/smoke/routes.spec.js
// K-01 — all 18+ SPA routes return 200 under the offline-mock boundary.
//
// Every route must be served by the dev server. The SPA may redirect to /
// for routes that require auth or state, but the HTTP response itself must
// be 2xx. The /docs, /compare, /compare/* routes have an explicit
// redirect (DocsRedirect / Navigate), so the test asserts the destination
// URL too.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

const PUBLIC_ROUTES = [
  "/",
  "/onboarding",
  "/preview",
  "/dashboard",
  "/batch",
  "/schedules",
  "/pricing",
  "/account",
  "/privacy",
  "/terms",
  "/about",
  "/blog",
  "/contact",
  "/integrations",
  "/use-cases",
  "/payment/success",
  "/payment/cancel",
];

for (const route of PUBLIC_ROUTES) {
  test(`route ${route} returns 200`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res?.ok()).toBeTruthy();
  });
}

test("/docs redirects to /help/index.html (window.location, not SPA)", async ({ page }) => {
  // The DocsRedirect component does a hard navigation to the static help
  // page; the new URL must be /help/index.html.
  await page.goto("/docs");
  await expect(page).toHaveURL(/\/help\/index\.html$/);
});

test("/compare redirects to /vs/browse-ai", async ({ page }) => {
  await page.goto("/compare");
  await expect(page).toHaveURL(/\/vs\/browse-ai$/);
});

test("/compare/anything also redirects to /vs/browse-ai", async ({ page }) => {
  await page.goto("/compare/something");
  await expect(page).toHaveURL(/\/vs\/browse-ai$/);
});
