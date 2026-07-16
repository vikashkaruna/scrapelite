// netlify/functions/lib/scrapeProviders.test.js
// C-34 — runScrapeChain / runMapChain fallback chain tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCRAPE_ORDER,
  SCRAPE_PROVIDERS,
  runMapChain,
  runScrapeChain,
  scrapeProviderStatus,
} from "../functions/lib/scrapeProviders.js";

let fetchMock;

beforeEach(() => {
  // Reset all provider env vars
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.SPIDER_API_KEY;
  delete process.env.JINA_API_KEY;
  delete process.env.VITE_FIRECRAWL_API_KEY;
  delete process.env.SCRAPE_PROVIDER_ORDER;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  return import("../functions/lib/scrapeProviders.js");
}

function firecrawlScrapeOk(html = "<html><head><title>T</title></head><body>hi</body></html>") {
  return new Response(
    JSON.stringify({ data: { html, metadata: { title: "T" } } }),
    { status: 200 },
  );
}
function firecrawlScrapeError(status = 500, msg = "internal") {
  return new Response(JSON.stringify({ error: msg }), { status });
}
function spiderScrapeOk(html = "<html><body>spider</body></html>") {
  return new Response(JSON.stringify([{ content: html, metadata: { title: "S" } }]), {
    status: 200,
  });
}
function jinaScrapeOk(md = "# Title\n\n[link](https://example.com)") {
  return new Response(
    JSON.stringify({ data: { content: md, title: "J", description: "D" } }),
    { status: 200 },
  );
}
function directScrapeOk(html = "<html><head><title>Direct</title></head><body>x</body></html>") {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
function firecrawlMapOk(links = ["https://a.com", "https://b.com"]) {
  return new Response(JSON.stringify({ links }), { status: 200 });
}
function directMapOk(html = '<a href="/a">A</a><a href="/b">B</a><a href="https://c.com">C</a>') {
  return new Response(html, { status: 200 });
}

describe("runScrapeChain — fallback order (C-34)", () => {
  it("default order is firecrawl → spider → jina → direct", () => {
    expect(DEFAULT_SCRAPE_ORDER).toEqual(["firecrawl", "spider", "jina", "direct"]);
  });

  it("first success short-circuits the chain", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(firecrawlScrapeOk());
    const { runScrapeChain } = await load();
    const r = await runScrapeChain("https://example.com");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("firecrawl");
    expect(r.html).toMatch(/<html>/);
    // Spider, jina, direct never tried
    expect(r.attempts.find((a) => a.provider === "spider")).toBeUndefined();
    expect(r.attempts.find((a) => a.provider === "jina")).toBeUndefined();
    expect(r.attempts.find((a) => a.provider === "direct")).toBeUndefined();
  });

  it("provider-error continues the chain (does not throw)", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    process.env.SPIDER_API_KEY = "spider-key";
    fetchMock
      .mockResolvedValueOnce(firecrawlScrapeError(500))
      .mockResolvedValueOnce(spiderScrapeOk());
    const { runScrapeChain } = await load();
    const r = await runScrapeChain("https://example.com");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("spider");
    expect(r.attempts.find((a) => a.provider === "firecrawl")?.error).toMatch(/Firecrawl 500/);
  });

  it("skips providers that require a key when none is configured", async () => {
    // No provider keys set; only jina + direct can run (those don't require keys)
    fetchMock
      .mockResolvedValueOnce(jinaScrapeOk())
      .mockResolvedValueOnce(directScrapeOk());
    const { runScrapeChain } = await load();
    const r = await runScrapeChain("https://example.com");
    expect(r.ok).toBe(true);
    // jina is before direct in DEFAULT_SCRAPE_ORDER; jina should be tried first
    expect(r.source).toBe("jina");
    // firecrawl + spider were logged as skipped
    expect(r.attempts.find((a) => a.provider === "firecrawl")?.skipped).toBe("no-key");
    expect(r.attempts.find((a) => a.provider === "spider")?.skipped).toBe("no-key");
  });

  it("respects SCRAPE_PROVIDER_ORDER env override", async () => {
    process.env.SPIDER_API_KEY = "spider-key";
    process.env.FIRECRAWL_API_KEY = "fc-key";
    process.env.SCRAPE_PROVIDER_ORDER = "spider,firecrawl";
    fetchMock
      .mockResolvedValueOnce(spiderScrapeOk())
      .mockResolvedValueOnce(firecrawlScrapeOk());
    const { runScrapeChain } = await load();
    const r = await runScrapeChain("https://example.com");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("spider");
  });

  it("returns ok:false when every provider fails", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    process.env.SPIDER_API_KEY = "spider-key";
    fetchMock.mockResolvedValue(firecrawlScrapeError(500));
    const { runScrapeChain } = await load();
    const r = await runScrapeChain("https://example.com");
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBeGreaterThan(0);
    expect(r.error).toMatch(/All scrape providers failed/);
  });
});

describe("runMapChain (C-34)", () => {
  it("returns {ok, source, mapLinks[]}; first success wins", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(firecrawlMapOk());
    const { runMapChain } = await load();
    const r = await runMapChain("https://example.com");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("firecrawl");
    expect(Array.isArray(r.mapLinks)).toBe(true);
    expect(r.mapLinks).toContain("https://a.com");
  });

  it("skips jina for map (no map endpoint)", async () => {
    // No keys set; only jina + direct are eligible by key
    fetchMock.mockResolvedValueOnce(directMapOk());
    const { runMapChain } = await load();
    const r = await runMapChain("https://example.com");
    // jina was skipped (no-map-support), direct succeeded
    expect(r.attempts.find((a) => a.provider === "jina")?.skipped).toBe("no-map-support");
    expect(r.source).toBe("direct");
  });

  it("direct map extracts and resolves relative hrefs", async () => {
    fetchMock.mockResolvedValueOnce(directMapOk());
    const { runMapChain } = await load();
    const r = await runMapChain("https://example.com");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("direct");
    // /a and /b resolve to https://example.com/a and .../b; the absolute URL
    // is normalised by the URL constructor (trailing slash on bare hosts).
    expect(r.mapLinks).toContain("https://example.com/a");
    expect(r.mapLinks).toContain("https://example.com/b");
    expect(r.mapLinks).toContain("https://c.com/");
  });
});

describe("scrapeProviderStatus (C-34)", () => {
  it("reports hasKey + requiresKey for each provider without exposing secrets", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    process.env.JINA_API_KEY = "jina-key";
    const { scrapeProviderStatus } = await load();
    const s = scrapeProviderStatus();
    expect(s.firecrawl.hasKey).toBe(true);
    expect(s.firecrawl.requiresKey).toBe(true);
    expect(s.jina.hasKey).toBe(true);
    expect(s.jina.requiresKey).toBe(false);
    expect(s.direct.hasKey).toBe(false);
    expect(s.direct.requiresKey).toBe(false);
    // No secrets leaked
    const json = JSON.stringify(s);
    expect(json).not.toContain("fc-key");
    expect(json).not.toContain("jina-key");
  });
});

describe("SCRAPE_PROVIDERS registry", () => {
  it("every entry has a label, keyEnv (or null), requiresKey, scrape fn", () => {
    for (const p of Object.values(SCRAPE_PROVIDERS)) {
      expect(p.label).toBeTruthy();
      expect(typeof p.requiresKey).toBe("boolean");
      expect(typeof p.scrape).toBe("function");
    }
  });
});
