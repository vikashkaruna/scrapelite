// e2e/a11y/pages.spec.js
// A-07 — axe-core page-level a11y audit for the 6 most-visited pages.
//
// We inject axe-core into the page and run it against the live DOM, then
// assert there are no serious or critical violations. The axe-core script
// is loaded from node_modules and injected via `page.addScriptTag({ path })`.
//
// The Playwright a11y suite runs against the same offline mocks as the
// smoke and journey suites (see e2e/support.js) so that pages render in
// their "real" shape without external dependencies.

import { expect, test } from "playwright/test";
import { resolve } from "node:path";
import { installOfflineMocks } from "../support.js";

const AXE_PATH = resolve("node_modules/axe-core/axe.min.js");

const PAGES = [
  { name: "Home",      url: "/" },
  { name: "Preview",   url: "/preview" },
  { name: "Dashboard", url: "/dashboard" },
  { name: "Pricing",   url: "/pricing" },
  { name: "Account",   url: "/account" },
  { name: "About",     url: "/about" },
];

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

for (const { name, url } of PAGES) {
  test(`${name} (${url}) has no serious/critical a11y violations`, async ({ page }) => {
    await page.goto(url);
    // Inject axe-core into the page.
    await page.addScriptTag({ path: AXE_PATH });
    // Run axe with the standard WCAG 2.0 + 2.1 A/AA tag set. We don't run
    // AAA rules because the app doesn't claim AAA conformance. The result
    // is reported back as JSON, filtered to serious + critical only.
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const results = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
      });
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
    });
    // If there are serious/critical violations, fail with a readable summary.
    if (violations.length) {
      const summary = violations
        .map((v) => `${v.id} (${v.impact}) — ${v.nodes} node(s) — ${v.help}`)
        .join("\n  ");
      throw new Error(`Serious/critical a11y violations on ${url}:\n  ${summary}`);
    }
    expect(violations).toEqual([]);
  });
}
