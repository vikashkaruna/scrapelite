// netlify/functions/extract.test.js
// C-01..04 — SSRF guard, provider chain, response shape, map mode.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.SPIDER_API_KEY;
  delete process.env.JINA_API_KEY;
  delete process.env.SCRAPE_PROVIDER_ORDER;
  // FD3: no permitted-hosts configured in tests → compliance is permissive.
  delete process.env.PERMITTED_HOSTS;
  vi.resetModules();
  fetchMock = vi.fn();
  // The extract.js handler fires two kinds of fetch:
  //   1. The compliance pre-check hits the host's /robots.txt.
  //   2. The provider chain calls the configured scrape provider.
  // Pre-queue an empty 200 for #1 so the compliance check is permissive
  // and the test's own `mockResolvedValueOnce` (if any) fires on #2.
  fetchMock.mockResolvedValueOnce(new Response("", { status: 200 })); // robots.txt
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/extract.js");
  return mod.handler;
}

describe("extract — request validation", () => {
  it("missing url → 400", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({}) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/url/);
  });

  it("invalid JSON → 400", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "not json" });
    expect(r.statusCode).toBe(400);
  });

  it("GET → 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(405);
  });
});

describe("extract — scrape response shape (C-03)", () => {
  it("returns {data:{html, metadata:{title}, json}, source, _providerAttempts}", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            html: "<html><head><title>Test</title></head></html>",
            metadata: { title: "Test" },
            json: { foo: "bar" },
          },
        }),
        { status: 200 },
      ),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.data.html).toMatch(/<html>/);
    expect(body.data.metadata.title).toBe("Test");
    expect(body.data.json).toEqual({ foo: "bar" });
    expect(body.source).toBe("firecrawl");
    expect(Array.isArray(body._providerAttempts)).toBe(true);
  });
});

describe("extract — provider chain (C-02)", () => {
  it("first success short-circuits the chain", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { html: "<html>x</html>", metadata: { title: "FC" } },
        }),
        { status: 200 },
      ),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.source).toBe("firecrawl");
    // 2 fetches: 1 for FD3 robots.txt compliance pre-check + 1 for firecrawl.
    // (The chain short-circuits after firecrawl, so no fallbacks.)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("all providers fail → 502 with _providerAttempts", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(r.statusCode).toBe(502);
    const body = JSON.parse(r.body);
    expect(body._providerAttempts).toBeTruthy();
    expect(body._providerAttempts.length).toBeGreaterThan(0);
  });
});

describe("extract — map mode (C-04)", () => {
  it("returns {mapLinks, source, _providerAttempts}", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ links: ["https://a.com", "https://b.com"] }),
        { status: 200 },
      ),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { mapMode: true },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.mapLinks).toEqual(["https://a.com", "https://b.com"]);
    expect(body.source).toBe("firecrawl");
    expect(Array.isArray(body._providerAttempts)).toBe(true);
  });

  it("all providers fail in map mode → 502", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { mapMode: true },
      }),
    });
    expect(r.statusCode).toBe(502);
  });
});

describe("extract — SSRF guard integration (C-01)", () => {
  it("rejects a private IP URL via the publicUrl guard", async () => {
    // The extract handler runs every inbound URL through isPublicHttpUrl
    // BEFORE any provider HTTP call. A 127.0.0.1 URL is rejected with 400
    // and the chain is never reached.
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1:8080" }),
    });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a file:// scheme", async () => {
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an RFC 1918 private IP (10.x)", async () => {
    const h = await loadHandler();
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      body: JSON.stringify({ url: "http://10.0.0.1/" }),
    });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extract — CORS preflight", () => {
  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
