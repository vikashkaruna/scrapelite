/**
 * Route every browser-test integration through deterministic local fixtures.
 *
 * The production app uses /api/* as its server boundary.  Returning 503 for
 * persistence intentionally exercises its documented localStorage fallback;
 * no browser test can accidentally consume a real credential or remote quota.
 */
export async function installOfflineMocks(page, options = {}) {
  // ── Third-party font CDN ───────────────────────────────────────────────────
  // index.html loads its typefaces from fonts.googleapis.com with a plain
  // render-blocking <link rel="stylesheet">, so the document's `load` event
  // waits for that request. Playwright's default navigation wait IS `load`,
  // which makes EVERY page.goto and page.reload in this suite depend on
  // Google's CDN being reachable and fast.
  //
  // Where egress is filtered, that request is not refused — it hangs and then
  // resets after ~12.5s. Two navigations in one test then cost ~26s against a
  // 30s timeout, so tests fail with `page.goto: Test timeout exceeded` and no
  // assertion ever runs. Measured here: 13.4s to load /batch, of which 12.5s
  // was this one request; with it stubbed, ~0.9s.
  //
  // Stubbing it is squarely this file's stated job — deterministic local
  // fixtures, no reliance on a remote service. Text and role assertions are
  // unaffected; the page simply renders in the fallback stack declared beside
  // the webfont in design-system.css.
  //
  // Visual specs pass { externalFonts: "allow" } because their baselines were
  // captured with the webfonts applied. Changing that here would fold an
  // unreviewed rendering change into every stored screenshot.
  if (options.externalFonts !== "allow") {
    await page.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await page.route(/^https:\/\/fonts\.gstatic\.com\//, (route) => route.abort());
  }

  // Pre-mark the Q4 onboarding tour as "skipped" before the app boots so the
  // first-time-visitor auto-tour overlay does not intercept pointer events.
  // addInitScript runs on every navigation, before the app's scripts, so the
  // tour's mount-time `useEffect` reads `skippedAt === true` and stays closed.
  // The smoke suite has its own dedicated tour specs that exercise the tour
  // end-to-end and clear this key explicitly when they need a clean state.
  // Also pin currency to USD so pricing-claim assertions are deterministic
  // regardless of the host machine's timezone (the dev box is in IST).
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "datiq.onboardingTour.v1",
        JSON.stringify({ skippedAt: "1970-01-01T00:00:00.000Z" })
      );
      localStorage.setItem("datiq.currency", "USD");
    } catch { /* storage unavailable; tour will auto-open, tests will retry */ }
  });

  // Clear storage exactly once per test. addInitScript runs on every
  // navigation, including page.reload(), so doing it there would wipe the
  // extraction state a reload-based assertion is trying to verify.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Re-apply the tour-skip and USD pin after clearing — the init script
    // only runs on navigations, not on `page.evaluate`, so the clear above
    // wiped both keys.
    localStorage.setItem(
      "datiq.onboardingTour.v1",
      JSON.stringify({ skippedAt: "1970-01-01T00:00:00.000Z" })
    );
    localStorage.setItem("datiq.currency", "USD");
  });

  // Do not allow the development runtime config to add an external webhook.
  await page.route("**/runtime-config.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: "window.__DATIQ_RUNTIME__ = { webhookUrl: '', emailApiUrl: '' };",
    });
  });

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname.endsWith("/og-preview")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          title: "Lumio",
          description: "Deterministic browser-test preview",
          image: "",
        }),
      });
      return;
    }

    if (pathname.endsWith("/ai")) {
      const payload = route.request().postDataJSON();
      const prompt = (payload?.messages || [])
        .map((message) => String(message.content || ""))
        .join("\n");
      const text = prompt.includes("Classify each link")
        ? "[]"
        : "Deterministic AI result used only by the browser test suite.";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ content: [{ type: "text", text }] }),
      });
      return;
    }

    // Saved-extraction and configuration requests use the app's supported
    // localStorage fallback.  This also makes an unexpected API call visible
    // without allowing it to leave the test process.
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Offline browser-test fixture", useLocalStorage: true }),
    });
  });
}
