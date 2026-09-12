// Browser chrome and installed-app icons must be real static assets, never
// Netlify/Vite's SPA fallback HTML. This protects tab icons and direct URLs.

import { expect, test } from "playwright/test";

const assets = [
  ["/favicon.svg", /image\/svg\+xml/],
  ["/favicon.ico", /image\/(?:x-)?icon/],
  ["/favicon-192.png", /image\/png/],
  ["/apple-touch-icon.png", /image\/png/],
  ["/site.webmanifest", /application\/(?:manifest\+json|json)/],
];

test("DatIQ supplies real favicon and installed-app assets", async ({ request }) => {
  for (const [path, contentType] of assets) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be served`).toBeTruthy();
    expect(response.headers()["content-type"] || "").toMatch(contentType);
  }
});

test("every app page advertises the DatIQ favicon set", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"][href="/site.webmanifest"]')).toHaveCount(1);
});
