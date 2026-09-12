// e2e/smoke/topbar.spec.js
// K-17 — TopBar Explore dropdown opens and shows the 3 main section labels.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("clicking Explore opens the dropdown", async ({ page }) => {
  await page.goto("/");
  const exploreBtn = page.getByRole("button", { name: /explore/i }).first();
  await exploreBtn.click();
  // The dropdown menu has the role=menu container.
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 2000 });
});

test("Explore dropdown shows Pricing, Use Cases, and Contact entries", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /explore/i }).first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").getByText(/plans & pricing/i)).toBeVisible();
  await expect(page.getByRole("menu").getByText(/use cases/i)).toBeVisible();
  await expect(page.getByRole("menu").getByText(/contact us/i)).toBeVisible();
});

test("TopBar shows the brand + a single Sign in CTA for unauthenticated visitors", async ({ page }) => {
  // Post-074abfe: the not-logged-in state shows ONE primary "Sign in" CTA
  // (Sign in + Sign up were collapsed — both opened the same auth modal).
  // Logged-in users see the UserDropdown instead (covered by I-23 in the
  // integration suite).
  await page.goto("/");
  await expect(page.getByText("DatIQ").first()).toBeVisible();
  const actions = page.locator(".topbar-desktop-actions");
  await expect(actions.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  // The redundant Sign up button was intentionally removed.
  await expect(actions.getByRole("button", { name: /^sign up$/i })).toHaveCount(0);
});

test("the first-visit offer aligns with the Sign in button's menu edge", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const signIn = page
    .locator(".topbar-desktop-actions")
    .getByRole("button", { name: /^sign in$/i });
  const trialStatus = page.locator(".guest-trial-bar");

  await expect(signIn).toBeVisible();
  await expect(trialStatus).toBeVisible();

  const [signInBox, trialStatusBox] = await Promise.all([
    signIn.boundingBox(),
    trialStatus.boundingBox(),
  ]);
  if (!signInBox || !trialStatusBox) {
    throw new Error("Expected the Sign in button and trial status to have layout boxes.");
  }

  expect(
    Math.abs(
      signInBox.x + signInBox.width - (trialStatusBox.x + trialStatusBox.width),
    ),
  ).toBeLessThanOrEqual(1);
});

test("the home offer does not push DatIQ Intelligence below the hero headline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const [headingBox, previewBox] = await Promise.all([
    page.getByRole("heading", { level: 1, name: /Intelligence, Connected/i }).boundingBox(),
    page.locator(".home-dashboard-reveal").boundingBox(),
  ]);
  if (!headingBox || !previewBox) throw new Error("Expected hero heading and DatIQ Intelligence preview boxes.");

  // Grid/font layout can round to a fractional pixel; the former offer rule
  // created an 88px displacement, so 2px is still a meaningful alignment gate.
  expect(Math.abs(headingBox.y - previewBox.y)).toBeLessThanOrEqual(2);
});

test("home shows the active offer without a trial meter before the visitor uses the trial", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const trialStatus = page.locator(".guest-trial-bar");
  const offer = trialStatus.locator(".offers-banner-trial");

  await expect(offer).toContainText("LAUNCH20");
  await expect(page.locator("#extract-composer .offers-banner")).toHaveCount(0);
  await expect(trialStatus.locator(".guest-trial-bar-inner")).toHaveCount(0);
  await expect(trialStatus.getByRole("button", { name: /dismiss trial status/i })).toHaveCount(0);

  const [trialBox, offerBox] = await Promise.all([
    trialStatus.boundingBox(), offer.boundingBox(),
  ]);
  if (!trialBox || !offerBox) throw new Error("Expected the trial offer layout boxes.");

  expect(Math.abs(offerBox.width - trialBox.width)).toBeLessThanOrEqual(2);
});

test("a used trial shows a dismissible status without restoring the Sign up CTA", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({ count: 1, batchCount: 0 }));
  });
  await page.goto("/");

  const trialStatus = page.locator(".guest-trial-bar");
  await expect(trialStatus).toContainText(/Trial mode/i);
  await expect(trialStatus.getByRole("button", { name: /dismiss trial and offer/i })).toBeVisible();
  await expect(trialStatus.getByRole("button", { name: /sign up free|create free account/i })).toHaveCount(0);

  await trialStatus.getByRole("button", { name: /dismiss trial and offer/i }).click();
  await expect(trialStatus).toHaveCount(0);
});
