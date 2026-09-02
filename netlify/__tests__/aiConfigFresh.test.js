// Regression: the admin screen must never answer "did my change land?" from a
// stale cache.
//
// invalidateAiConfigCache() alone cannot guarantee this. It clears only the
// container that served the POST, and Netlify may route the operator's next
// GET to a DIFFERENT warm container holding a copy up to TTL_MS old. The
// operator then sees their old settings and concludes the save failed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

describe("loadAiConfig cache freshness", () => {
  let stored;
  let reads;

  beforeEach(async () => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    reads = 0;
    stored = { models: { gemini: "gemini-OLD" } };
    globalThis.fetch = vi.fn(async () => {
      reads += 1;
      return { ok: true, json: async () => [{ value: stored }] };
    });
  });

  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it("serves the cached value on an ordinary read (unchanged behaviour)", async () => {
    const { loadAiConfig } = await import("../functions/lib/aiProviders.js");
    expect((await loadAiConfig()).models.gemini).toBe("gemini-OLD");
    stored = { models: { gemini: "gemini-NEW" } };
    expect((await loadAiConfig()).models.gemini).toBe("gemini-OLD"); // cached
    expect(reads).toBe(1);
  });

  it("re-reads the store when asked for a fresh copy", async () => {
    const { loadAiConfig } = await import("../functions/lib/aiProviders.js");
    await loadAiConfig();
    stored = { models: { gemini: "gemini-NEW" } };
    // This is the assertion that fails without the `fresh` option: an operator
    // hitting Reload right after saving would still be shown "gemini-OLD".
    expect((await loadAiConfig({ fresh: true })).models.gemini).toBe("gemini-NEW");
    expect(reads).toBe(2);
  });

  it("a fresh read repopulates the cache rather than bypassing it forever", async () => {
    const { loadAiConfig } = await import("../functions/lib/aiProviders.js");
    stored = { models: { gemini: "gemini-NEW" } };
    await loadAiConfig({ fresh: true });
    await loadAiConfig();
    // One read total: the fresh call REFRESHED the cache rather than disabling
    // it, so the ordinary call after it costs nothing. A `fresh` flag that
    // left the cache empty would turn every admin page load into a permanent
    // extra round trip for every other caller in the container.
    expect(reads).toBe(1);
  });
});

describe("admin-ai-config GET", () => {
  it("asks for a fresh copy so Reload cannot show a pre-save value", async () => {
    const [{ readFileSync }, { resolve }] = await Promise.all([import("node:fs"), import("node:path")]);
    const src = readFileSync(resolve(process.cwd(), "netlify/functions/admin-ai-config.js"), "utf8");
    expect(src).toMatch(/loadAiConfig\(\{\s*fresh:\s*true\s*\}\)/);
  });
});
