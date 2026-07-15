import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return import("./config.js");
}

describe("runtime configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete window.__DATIQ_RUNTIME__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__DATIQ_RUNTIME__;
  });

  it("uses no outbound integrations when optional environment values are absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_FIRECRAWL_API_KEY", "");
    vi.stubEnv("VITE_WEBHOOK_URL", "");
    vi.stubEnv("VITE_EMAIL_API_URL", "");
    const config = await loadConfig();

    expect(config.hasSupabase).toBe(false);
    expect(config.hasFirecrawl).toBe(false);
    expect(config.hasWebhook).toBe(false);
    expect(config.hasEmail).toBe(false);
    expect(config.hasAI).toBe(true);
  });

  it("prefers and normalizes safe runtime endpoints over build-time values", async () => {
    vi.stubEnv("VITE_WEBHOOK_URL", "build.example/hooks");
    vi.stubEnv("VITE_EMAIL_API_URL", "https://build.example/email");
    window.__DATIQ_RUNTIME__ = {
      webhookUrl: "runtime.example/hooks",
      emailApiUrl: "https://runtime.example/email",
    };
    const config = await loadConfig();

    expect(config.WEBHOOK_URL).toBe("https://runtime.example/hooks");
    expect(config.EMAIL_API_URL).toBe("https://runtime.example/email");
    expect(config.hasWebhook).toBe(true);
    expect(config.hasEmail).toBe(true);
  });

  it("enables real extraction only when a provider flag is present", async () => {
    vi.stubEnv("VITE_SPIDER_API_KEY", "present");
    const config = await loadConfig();
    expect(config.hasFirecrawl).toBe(true);
  });
});
