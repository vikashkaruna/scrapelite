import { expect, test } from "playwright/test";
import { stubExternalOrigins } from "../support.js";

async function prepareRuntime(page) {
  // This spec supplies its own runtime-config (it needs a gaMeasurementId), so
  // it deliberately does NOT call installOfflineMocks. It still has to stub the
  // third-party font CDN: prepareRuntime does a goto AND a reload, which cost
  // ~12.5s each where egress is filtered, blowing the 30s budget before the
  // consent banner is ever clicked. googletagmanager stays real here — the
  // routes below are what this spec is actually asserting on.
  await stubExternalOrigins(page);
  await page.route("**/runtime-config.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: "window.__DATIQ_RUNTIME__ = { gaMeasurementId: 'G-TEST123', gaDebugLocal: true, webhookUrl: '', emailApiUrl: '' };",
    });
  });
  await page.route("https://www.googletagmanager.com/gtag/js?id=G-TEST123", async (route) => {
    await route.fulfill({ contentType: "application/javascript", body: "window.__gtagTestLoaded = true;" });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("datiq.onboardingTour.v1", JSON.stringify({}));
    sessionStorage.clear();
  });
  await page.reload();
}

test.describe("strict analytics consent and Home tour", () => {
  test("keeps GA unloaded on an unanswered or declined choice", async ({ page }) => {
    const googleRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("googletagmanager.com")) googleRequests.push(request.url());
    });
    await prepareRuntime(page);

    await expect(page.getByRole("region", { name: /cookie and analytics consent/i })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /welcome to datiq/i })).toBeVisible();
    await expect.poll(() => googleRequests.length).toBe(0);

    await page.getByRole("button", { name: "Decline analytics" }).click();
    await expect(page.getByRole("region", { name: /cookie and analytics consent/i })).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(googleRequests).toHaveLength(0);
    expect(await page.context().cookies()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.stringMatching(/^_ga(?:_|$)/) }),
    ]));
  });

  test("activates GA only after Allow and keeps the Home tour visible", async ({ page }) => {
    await prepareRuntime(page);
    await expect(page.getByRole("dialog", { name: /welcome to datiq/i })).toBeVisible();
    await page.getByRole("button", { name: "Allow analytics" }).click();
    await expect.poll(() => page.evaluate(() => window.__gtagTestLoaded === true)).toBe(true);
    await expect(page.getByRole("dialog", { name: /welcome to datiq/i })).toBeVisible();

    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.locator(".tour-spotlight")).toBeVisible();
  });

  test("keeps both consent actions usable on a mobile Home viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareRuntime(page);
    await expect(page.getByRole("dialog", { name: /welcome to datiq/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /cookie and analytics consent/i })).toBeVisible();

    await page.getByRole("button", { name: "Decline analytics" }).click();
    await expect(page.getByRole("region", { name: /cookie and analytics consent/i })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /welcome to datiq/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
