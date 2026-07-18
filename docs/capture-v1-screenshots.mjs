// capture-v1-screenshots.mjs — V1.0 release-candidate screenshot sweep.
//
// Captures every key surface of DatIQ v1.0 in light + dark modes, desktop
// + mobile breakpoints. Used to verify the v1.0 release build and to
// supply the v1.0 release notes / public help site with current imagery.
//
//   1. npm run dev   (separate terminal, http://localhost:5173)
//   2. node docs/capture-v1-screenshots.mjs
//
// Writes PNGs to docs/V1.0-Screenshots/. Re-run after UI changes.

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "V1.0-Screenshots");
const BASE = process.env.BASE_URL || "http://localhost:5173";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log("  ✓", name);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function go(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await sleep(700);
}

async function setTheme(theme) {
  await page.evaluate((t) => {
    try { localStorage.setItem("datiq.theme", t); } catch {}
  }, theme);
  // Trigger a reload so ThemeProvider picks the change up.
  await page.reload({ waitUntil: "networkidle" });
  await sleep(500);
}

async function setCurrency(c) {
  await page.evaluate((cc) => {
    try { localStorage.setItem("datiq.currency", cc); } catch {}
  }, c);
  await page.reload({ waitUntil: "networkidle" });
  await sleep(500);
}

try {
  // Pin USD + light for the first sweep.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    try {
      localStorage.setItem("datiq.theme", "light");
      localStorage.setItem("datiq.currency", "USD");
      // Skip the Q4 onboarding tour so it doesn't block the screenshot
      localStorage.setItem(
        "datiq.onboardingTour.v1",
        JSON.stringify({ skippedAt: "1970-01-01T00:00:00.000Z" })
      );
    } catch {}
  });

  // ── 01 — Home (desktop, light) ─────────────────────────────────────────
  await go("/");
  await shot(page, "01-home-desktop-light.png");

  // ── 02 — Home (desktop, dark) ──────────────────────────────────────────
  await setTheme("dark");
  await shot(page, "02-home-desktop-dark.png");
  await setTheme("light");

  // ── 03 — Home (mobile, light) ──────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await shot(page, "03-home-mobile-light.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 04 — Pricing (annual USD, light) — top of page ─────────────────────
  await go("/pricing");
  await shot(page, "04-pricing-annual-usd.png");

  // ── 05 — Pricing (monthly USD) ─────────────────────────────────────────
  await page.getByRole("button", { name: /Monthly billing/i }).click();
  await sleep(500);
  await shot(page, "05-pricing-monthly-usd.png");

  // ── 06 — Pricing (annual INR) ──────────────────────────────────────────
  await setCurrency("INR");
  await go("/pricing");
  await sleep(500);
  await shot(page, "06-pricing-annual-inr.png");
  await setCurrency("USD");

  // ── 07 — Dashboard (empty state) ───────────────────────────────────────
  await go("/dashboard");
  await sleep(500);
  await shot(page, "07-dashboard-empty.png");

  // ── 08 — Preview (mock extraction) ─────────────────────────────────────
  // We need a non-empty Dashboard / Preview to capture. Use the mock
  // extraction flow: paste a URL, click the action button, mock the API
  // response, and let the app navigate to /preview.
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          metadata: {
            title: "Lumio — AI for product teams",
            url: "https://lumio.io",
            description: "All-in-one workspace for product teams. Plan, build and ship faster with AI.",
          },
          markdown: "# Lumio — AI for product teams\n\nLumio is the all-in-one workspace for product teams...",
          html: "<h1>Lumio — AI for product teams</h1><p>Plan, build and ship faster.</p>",
          json: {
            headings: [
              { level: 1, text: "Lumio — AI for product teams" },
              { level: 2, text: "Plan, build, ship — together" },
              { level: 2, text: "Pricing" },
            ],
            links: [
              { text: "Sign up",        href: "https://lumio.io/signup" },
              { text: "Pricing",        href: "https://lumio.io/pricing" },
              { text: "About",          href: "https://lumio.io/about" },
              { text: "Documentation",  href: "https://lumio.io/docs" },
              { text: "Twitter",        href: "https://twitter.com/lumio" },
              { text: "LinkedIn",       href: "https://linkedin.com/company/lumio" },
            ],
          },
        },
      }),
    });
  });
  await go("/");
  await page.locator(".hero-composer-input, [aria-label*='URL or content']").first().fill("https://lumio.io");
  await page.locator(".hero-action-btn").first().click();
  await page.waitForURL("**/preview", { timeout: 30000 });
  await sleep(1500);
  await shot(page, "08-preview.png");

  // ── 09 — Dashboard (populated) ─────────────────────────────────────────
  await go("/dashboard");
  await sleep(700);
  await shot(page, "09-dashboard-populated.png");

  // ── 10 — Batch page ────────────────────────────────────────────────────
  await go("/batch");
  await page.locator("textarea").first().fill("https://lumio.io\nhttps://stripe.com\nhttps://linear.app");
  await sleep(500);
  await shot(page, "10-batch.png");

  // ── 11 — Integrations page ─────────────────────────────────────────────
  await go("/integrations");
  await shot(page, "11-integrations.png");

  // ── 12 — Use Cases hub ─────────────────────────────────────────────────
  await go("/use-cases");
  await shot(page, "12-use-cases.png");

  // ── 13 — About page ────────────────────────────────────────────────────
  await go("/about");
  await shot(page, "13-about.png");

  // ── 14 — Blog page ─────────────────────────────────────────────────────
  await go("/blog");
  await shot(page, "14-blog.png");

  // ── 15 — Contact page ──────────────────────────────────────────────────
  await go("/contact");
  await shot(page, "15-contact.png");

  // ── 16 — Privacy page ──────────────────────────────────────────────────
  await go("/privacy");
  await shot(page, "16-privacy.png");

  // ── 17 — Terms page ────────────────────────────────────────────────────
  await go("/terms");
  await shot(page, "17-terms.png");

  // ── 18 — Account page (guest state) ────────────────────────────────────
  await go("/account");
  await shot(page, "18-account.png");

  // ── 19 — Pricing matrix section — scroll to it on /pricing ─────────────
  await go("/pricing");
  // PricingMatrix is rendered below the plan cards
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(700);
  await shot(page, "19-pricing-matrix.png");

  // ── 20 — Workspace (logged-out) ────────────────────────────────────────
  await go("/workspace");
  await shot(page, "20-workspace-guest.png");

  // ── 21 — Public gallery ────────────────────────────────────────────────
  await go("/gallery");
  await shot(page, "21-gallery.png");

  // ── 22 — Mobile pricing ────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/pricing");
  await shot(page, "22-pricing-mobile.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 23 — Home with Q3 outcome tiles (click one) ────────────────────────
  await go("/");
  // Click the first outcome tile to show the multi-select affordance
  const tile = page.locator(".outcome-tile").first();
  if (await tile.count()) {
    await tile.click();
    await sleep(500);
    await shot(page, "23-home-outcome-tile-active.png");
  }

  // ── 24 — Command palette (mod+K) ───────────────────────────────────────
  await page.keyboard.press("Meta+k");
  await sleep(600);
  await shot(page, "24-command-palette.png");
  await page.keyboard.press("Escape");
  await sleep(300);

  // ── 25 — Hotkey help (?) ───────────────────────────────────────────────
  await page.keyboard.press("?");
  await sleep(600);
  await shot(page, "25-hotkey-help.png");
  await page.keyboard.press("Escape");
  await sleep(300);

  console.log("\nAll V1.0 screenshots saved to docs/V1.0-Screenshots/");
} catch (e) {
  console.error("Capture error:", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
