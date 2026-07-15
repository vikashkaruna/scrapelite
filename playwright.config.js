import { defineConfig } from "playwright/test";

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
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: testEnv,
  },
});
