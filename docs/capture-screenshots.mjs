// capture-screenshots.mjs — drive the running DatIQ dev server with Playwright
// (system Google Chrome) and save fresh PNG screenshots for the help/docs.
//
//   1. npm run dev            (separate terminal, http://localhost:5173)
//   2. node docs/capture-screenshots.mjs
//
// Writes PNGs to docs/assets/screenshots/. Re-run after UI changes.
// Uses the system Chrome via channel:"chrome" so no Chromium download is needed.

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "assets/screenshots");
const BASE = process.env.BASE_URL || "http://localhost:5173";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

// The onboarding tour auto-starts on a fresh profile and its full-screen
// backdrop swallows every click, so without this the first click below
// (theme-toggle) retries until it times out and no screenshot is written.
// Mark the tour completed BEFORE any navigation — see shouldAutoStart() in
// src/lib/onboardingTour.js, which only checks completedAt/skippedAt.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem(
      "datiq.onboardingTour.v1",
      JSON.stringify({ completedAt: new Date("2026-01-01T00:00:00Z").toISOString() })
    );
  } catch { /* first-party storage unavailable — tour will show, shots may fail */ }
});

const page = await ctx.newPage();
const shot = async (name) => { await page.screenshot({ path: join(OUT, name) }); console.log("  ✓", name); };

async function go(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await sleep(500);
}

try {
  // ── Home (light) ─────────────────────────────────────────────────────────
  await go("/");
  await sleep(800);
  await shot("01-home.png");

  // ── Home (dark) ──────────────────────────────────────────────────────────
  await page.locator("button.theme-toggle").first().click();
  await sleep(500);
  await shot("02-home-dark.png");
  await page.locator("button.theme-toggle").first().click(); // back to light
  await sleep(400);

  // ── Batch run (populates dashboard with 2 pages) ──────────────────────────
  await go("/batch");
  await page.locator("textarea.batch-textarea").fill("https://lumio.io\nhttps://stripe.com");
  await page.locator("main button.btn-primary").click();
  await page.waitForSelector("text=Batch complete", { timeout: 30000 });
  await sleep(600);
  await shot("04-batch.png");

  // ── Single extraction → Preview ───────────────────────────────────────────
  await go("/");
  await page.locator("textarea").first().fill("https://lumio.io");
  await page.locator("button.hero-action-btn").click();
  await page.waitForURL("**/preview", { timeout: 30000 });
  await sleep(1200);
  await shot("03-preview.png");

  // ── Schedules (create one, then list) ─────────────────────────────────────
  await go("/schedules");
  await page.locator("main button").first().click(); // New schedule
  await sleep(400);
  await page.locator('main input[placeholder="https://example.com"]').fill("https://lumio.io/pricing");
  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await page.getByRole("button", { name: "Create schedule" }).click();
  await sleep(800);
  await shot("05-schedules.png");

  // ── Dashboard (table view) ─────────────────────────────────────────────────
  await go("/dashboard");
  await sleep(700);
  await shot("06-dashboard-table.png");

  // ── Dashboard (card view) ──────────────────────────────────────────────────
  const cardBtn = page.locator('.seg-opt[title="Card view"], button[title="Card view"]').first();
  if (await cardBtn.count()) { await cardBtn.click(); await sleep(700); await shot("07-dashboard-cards.png"); }

  // ── Pricing ────────────────────────────────────────────────────────────────
  await go("/pricing");
  await sleep(700);
  await shot("08-pricing.png");

  // ── Domain map mode (Map site intent → Preview) ────────────────────────────
  await go("/");
  await page.getByRole("button", { name: "Map site", exact: true }).click();
  await page.locator("textarea").first().fill("https://lumio.io");
  await page.locator("button.hero-action-btn").click();
  await page.waitForURL("**/preview", { timeout: 30000 });
  await sleep(1200);
  await shot("09-domain-map.png");

  // ── Account: the invoices & receipts card ──────────────────────────────────
  // Scroll it into view first — it sits well below the fold, and a top-of-page
  // crop shows plan/usage instead of the billing documents this shot is for.
  await go("/account");
  await sleep(900);
  const invCard = page.getByText(/invoices\s*&\s*receipts/i).first();
  if (await invCard.count()) {
    await invCard.scrollIntoViewIfNeeded();
    await sleep(500);
  }
  await shot("10-account-billing.png");

  console.log("All screenshots saved to docs/assets/screenshots/");
} catch (e) {
  console.error("Capture error:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
