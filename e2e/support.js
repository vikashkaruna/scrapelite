/**
 * Route every browser-test integration through deterministic local fixtures.
 *
 * The production app uses /api/* as its server boundary.  Returning 503 for
 * persistence intentionally exercises its documented localStorage fallback;
 * no browser test can accidentally consume a real credential or remote quota.
 */
export async function installOfflineMocks(page) {
  // Clear storage exactly once per test. addInitScript runs on every
  // navigation, including page.reload(), so doing it there would wipe the
  // extraction state a reload-based assertion is trying to verify.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
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
