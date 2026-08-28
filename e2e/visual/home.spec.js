// e2e/visual/home.spec.js
// V-01 — Home page visual snapshots. Captures the composer + 5 intent chips
// + 8 capability cards in three viewports: 1280x800 light, 1280x800 dark,
// and 375x812 light (mobile).
//
// First run establishes the baseline; subsequent runs diff against it.
// Update baselines with `npx playwright test --update-snapshots`.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  // Baselines were captured with the Google webfonts applied, so this suite
  // opts out of the font stub in support.js. Stubbing them here would change
  // text metrics on every stored screenshot.
  await installOfflineMocks(page, { externalFonts: "allow" });
  // Cross-run flakiness on this page traced to the .rise/.fade stagger
  // animation: Playwright's own animation-disabling normally jumps
  // straight to the end state, but this page still produced ~250px
  // height differences between otherwise-identical runs. The app
  // already has a real, tested off switch for these animations
  // (prefers-reduced-motion, design-system.css) — using that instead
  // of relying on Playwright's runtime CSS injection removes the
  // animation entirely rather than merely zeroing its duration, which
  // is what makes the settled layout height deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("home @ 1280x800 light", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
  // TryExampleDemo.jsx auto-plays through 5 steps on mount (typing a URL,
  // picking an intent, "extracting", revealing the summary, revealing
  // headings) — even under prefers-reduced-motion (REVEAL_DELAY_MS: 0) the
  // step chain still takes several event-loop ticks to settle, which
  // "networkidle" does not track at all (it only watches network requests,
  // not JS timers). A screenshot taken mid-sequence caught a partially-
  // revealed demo, and since each step reveals more content the page's
  // full height genuinely differs step to step — this is what produced
  // the ~250px, run-to-run height swings. `.try-demo-cta-final` is the
  // component's own "all steps complete" marker, so waiting for it is a
  // real completion signal instead of a guessed delay.
  await page.waitForSelector(".try-demo-cta-final", { state: "visible" });
  await expect(page).toHaveScreenshot("home-1280x800-light.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("home @ 1280x800 dark", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "dark"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
  // TryExampleDemo.jsx auto-plays through 5 steps on mount (typing a URL,
  // picking an intent, "extracting", revealing the summary, revealing
  // headings) — even under prefers-reduced-motion (REVEAL_DELAY_MS: 0) the
  // step chain still takes several event-loop ticks to settle, which
  // "networkidle" does not track at all (it only watches network requests,
  // not JS timers). A screenshot taken mid-sequence caught a partially-
  // revealed demo, and since each step reveals more content the page's
  // full height genuinely differs step to step — this is what produced
  // the ~250px, run-to-run height swings. `.try-demo-cta-final` is the
  // component's own "all steps complete" marker, so waiting for it is a
  // real completion signal instead of a guessed delay.
  await page.waitForSelector(".try-demo-cta-final", { state: "visible" });
  await expect(page).toHaveScreenshot("home-1280x800-dark.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("home @ 375x812 light (mobile)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
  // TryExampleDemo.jsx auto-plays through 5 steps on mount (typing a URL,
  // picking an intent, "extracting", revealing the summary, revealing
  // headings) — even under prefers-reduced-motion (REVEAL_DELAY_MS: 0) the
  // step chain still takes several event-loop ticks to settle, which
  // "networkidle" does not track at all (it only watches network requests,
  // not JS timers). A screenshot taken mid-sequence caught a partially-
  // revealed demo, and since each step reveals more content the page's
  // full height genuinely differs step to step — this is what produced
  // the ~250px, run-to-run height swings. `.try-demo-cta-final` is the
  // component's own "all steps complete" marker, so waiting for it is a
  // real completion signal instead of a guessed delay.
  await page.waitForSelector(".try-demo-cta-final", { state: "visible" });
  await expect(page).toHaveScreenshot("home-375x812-light.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
