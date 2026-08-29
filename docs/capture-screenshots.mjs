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
    localStorage.setItem(
      "datiq.discoverabilityTour.v1",
      JSON.stringify({ completedAt: new Date("2026-01-01T00:00:00Z").toISOString() })
    );
    // The consent banner is a fixed-bottom overlay, so without a stored choice
    // it sits across the lower ~15% of EVERY shot and buries the thing each
    // screenshot exists to show. Recording a choice up front suppresses it.
    // "denied" rather than "granted": it is the privacy-preserving option, and
    // it also keeps the capture run from firing GA4 page_view hits for a
    // headless browser walking the whole app.
    localStorage.setItem(
      "datiq.consent",
      JSON.stringify({
        analytics: "denied",
        source: "screenshot-capture",
        at: new Date("2026-01-01T00:00:00Z").toISOString(),
      })
    );
  } catch { /* first-party storage unavailable — tour will show, shots may fail */ }
});

const page = await ctx.newPage();
const shot = async (name) => { await page.screenshot({ path: join(OUT, name) }); console.log("  ✓", name); };
const skip = (name, why) => console.log(`  ⤬ ${name} — ${why}`);

async function go(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await sleep(500);
}

// Wrap every "real extraction" step so a Firecrawl / AI / Supabase blip
// doesn't kill the rest of the gallery. One stale screenshot is better
// than losing 8.
async function safe(label, fn, timeoutMs = 30000) {
  try {
    await fn();
  } catch (e) {
    skip(label, e.message?.split("\n")[0]?.slice(0, 80) || "threw");
  }
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
  await safe("04-batch.png", async () => {
    await go("/batch");
    await page.locator("textarea.batch-textarea").fill("https://lumio.io\nhttps://stripe.com");
    await page.locator("main button.btn-primary").click();
    await page.waitForSelector("text=Batch complete", { timeout: 30000 });
    await sleep(600);
    await shot("04-batch.png");
  });

  // ── Single extraction → Preview ───────────────────────────────────────────
  await safe("03-preview.png", async () => {
    // Drive via the composer when Firecrawl is fast enough; otherwise inject
    // a mock current extraction into localStorage and navigate directly. The
    // mock path is the only reliable way to capture the new Preview UI
    // when the live extraction is slow or times out.
    try {
      await go("/");
      await page.locator("textarea").first().fill("https://lumio.io");
      await page.locator("button.hero-action-btn").click();
      await page.waitForURL("**/preview", { timeout: 20000 });
    } catch {
      // Inject mock state and navigate directly.
      const { LUMIO_EXTRACTION } = await import("../src/data/mockData.js");
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate((data) => {
        try { localStorage.setItem("datiq.current", JSON.stringify(data)); } catch {}
      }, { ...LUMIO_EXTRACTION, _saved: true });
      await go("/preview");
    }
    await sleep(1200);
    await shot("03-preview.png");
  });

  // ── Schedules (create one, then list) ─────────────────────────────────────
  await safe("05-schedules.png", async () => {
    await go("/schedules");
    await page.locator("main button").first().click(); // New schedule
    await sleep(400);
    await page.locator('main input[placeholder="https://example.com"]').fill("https://lumio.io/pricing");
    await page.getByRole("button", { name: "Daily", exact: true }).click();
    await page.getByRole("button", { name: "Create schedule" }).click();
    await sleep(800);
    await shot("05-schedules.png");
  });

  // ── Dashboard (table view) ─────────────────────────────────────────────────
  await safe("06-dashboard-table.png", async () => {
    await go("/dashboard");
    await sleep(700);
    await shot("06-dashboard-table.png");
  });

  // ── Dashboard (card view) ──────────────────────────────────────────────────
  await safe("07-dashboard-cards.png", async () => {
    const cardBtn = page.locator('.seg-opt[title="Card view"], button[title="Card view"]').first();
    if (await cardBtn.count()) { await cardBtn.click(); await sleep(700); await shot("07-dashboard-cards.png"); }
    else skip("07-dashboard-cards.png", "Card-view button not found");
  });

  // ── Discoverability (SEO / AEO / GEO audits) ───────────────────────────────
  // The empty state, deliberately: running a real audit here would fire live
  // network calls against a third-party page and produce a screenshot whose
  // numbers change every time it is regenerated.
  await safe("11-discoverability.png", async () => {
    await go("/discoverability");
    await sleep(700);
    const adv = page.getByRole("button", { name: /Advanced options/i });
    if (await adv.count()) { await adv.click(); await sleep(400); }
    await shot("11-discoverability.png");
  });

  // ── Pricing ────────────────────────────────────────────────────────────────
  await safe("08-pricing.png", async () => {
    await go("/pricing");
    await sleep(700);
    await shot("08-pricing.png");
  });

  // ── Domain map mode (Map site intent → Preview) ────────────────────────────
  await safe("09-domain-map.png", async () => {
    try {
      await go("/");
      await page.getByRole("button", { name: "Map site", exact: true }).click();
      await page.locator("textarea").first().fill("https://lumio.io");
      await page.locator("button.hero-action-btn").click();
      await page.waitForURL("**/preview", { timeout: 20000 });
    } catch {
      // Mock fallback: build a synthetic domain_map payload and inject.
      const fake = {
        url: "https://lumio.io",
        page_title: "Lumio — domain map",
        ai_summary: "Synthetic domain map used only for the help-site screenshot.",
        headings: [],
        links: [],
        custom_extraction: null,
        domain_map: [
          "https://lumio.io/", "https://lumio.io/pricing", "https://lumio.io/about",
          "https://lumio.io/contact", "https://lumio.io/blog",
          "https://lumio.io/blog/introducing-lumio", "https://lumio.io/blog/data-quality",
          "https://lumio.io/case-studies", "https://lumio.io/case-studies/acme",
          "https://lumio.io/case-studies/globex", "https://lumio.io/docs",
          "https://lumio.io/docs/getting-started", "https://lumio.io/docs/api",
        ],
        enrichments: {},
        _saved: true,
      };
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate((data) => {
        try { localStorage.setItem("datiq.current", JSON.stringify(data)); } catch {}
      }, fake);
      await go("/preview");
    }
    await sleep(1200);
    await shot("09-domain-map.png");
  });

  // ── Account: the invoices & receipts card ──────────────────────────────────
  await safe("10-account-billing.png", async () => {
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
  });

  console.log("All screenshots saved to docs/assets/screenshots/");
} catch (e) {
  console.error("Capture error:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
