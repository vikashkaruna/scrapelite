import { defineConfig, devices } from "playwright/test";

// A release gate may point the same browser suite at a deployed preview,
// staging, or production URL.  Keep the normal local developer experience
// unchanged: only an explicit absolute PW_BASE_URL suppresses the local Vite
// server.  The deploy suite still installs its deterministic API fixtures, so
// it validates the shipped UI and routing without consuming customer quota.
const remoteBaseURL = process.env.PW_BASE_URL?.trim() || "";
if (remoteBaseURL && !/^https?:\/\//i.test(remoteBaseURL)) {
  throw new Error(`PW_BASE_URL must be absolute, got: ${remoteBaseURL}`);
}
const baseURL = remoteBaseURL || "http://127.0.0.1:4173";

// Browser tests intentionally run with every optional integration disabled.
// The specs mock the local API boundary, so they never require .env values or
// reach Firecrawl, Supabase, AI, webhooks, or payment providers.
const testEnv = {
  ...process.env,
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_ANON_KEY: "",
  VITE_FIRECRAWL_API_KEY: "",
  VITE_SPIDER_API_KEY: "",
  VITE_JINA_API_KEY: "",
  VITE_ENABLE_EXTRACT: "",
  VITE_WEBHOOK_URL: "",
  VITE_EMAIL_API_URL: "",
};

export default defineConfig({
  testDir: "./e2e",
  // FR-CB-01: ship the cross-browser support matrix in Playwright config.
  // The CI gate uses chromium for speed; `test:e2e:smoke:all-browsers` covers
  // firefox + webkit.
  //
  // NOTE: listing a project here does NOT make it opt-in. `playwright test`
  // with no --project runs EVERY project below, so a bare `test:e2e:smoke` was
  // running all three (294 tests instead of 98) and taking ~21 min — which is
  // what pushed the gate past its 25-minute cap. The browser choice therefore
  // lives in the npm scripts, which pass --project explicitly. `browserName`
  // under `use` does NOT narrow this list.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: remoteBaseURL ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    // Do not silently reuse an arbitrary process already listening on 4173.
    // A stale `vite preview` server does not load the dev-only Netlify-like
    // routing middleware, so `/compare` stays put and `/vs/*` falls through
    // to the React 404 page. Opt in only when deliberately sharing a known
    // compatible dev server.
    reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === "1",
    timeout: 120_000,
    env: testEnv,
  },
});
