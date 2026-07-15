// e2e/cb-projects.spec.js
// FR-CB-01 + FR-CB-02: asserts the Playwright config declares the three
// projects (chromium / firefox / webkit) and that the new npm scripts
// required by the M0 exit criteria are wired.
//
// These are not browser tests — they are contract tests for the
// test-infrastructure itself. They run inside Playwright's test runner so
// they share the same CI gating as the other e2e specs, but they do not
// need a running dev server.

import { expect, test } from "playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const REQUIRED_SCRIPTS = [
  "test:contract",
  "test:integration",
  "test:system",
  "test:e2e:smoke",
  "test:e2e:smoke:all-browsers",
  "test:e2e:journeys",
  "test:e2e:a11y",
  "test:e2e:visual",
  "test:all",
];

test("playwright.config.js declares the three cross-browser projects", async () => {
  const raw = await readFile(resolve(repoRoot, "playwright.config.js"), "utf8");
  expect(raw).toMatch(/projects:\s*\[/);
  expect(raw).toMatch(/name:\s*["']chromium["']/);
  expect(raw).toMatch(/name:\s*["']firefox["']/);
  expect(raw).toMatch(/name:\s*["']webkit["']/);
});

test("package.json exposes the M0 npm scripts", async () => {
  const raw = await readFile(resolve(repoRoot, "package.json"), "utf8");
  const scripts = JSON.parse(raw).scripts ?? {};
  for (const name of REQUIRED_SCRIPTS) {
    expect(scripts[name], `npm script "${name}" must be defined`).toBeTruthy();
  }
});

test("test:e2e:smoke:all-browsers script targets all three projects", async () => {
  const raw = await readFile(resolve(repoRoot, "package.json"), "utf8");
  const scripts = JSON.parse(raw).scripts ?? {};
  expect(scripts["test:e2e:smoke:all-browsers"]).toMatch(/--project=chromium/);
  expect(scripts["test:e2e:smoke:all-browsers"]).toMatch(/--project=firefox/);
  expect(scripts["test:e2e:smoke:all-browsers"]).toMatch(/--project=webkit/);
});
