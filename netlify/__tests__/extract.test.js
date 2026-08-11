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

describe("extract — AI extraction fallback (customPrompt without a JSON-aware provider)", () => {
  // The "Find Contact Info" / "Leadership & Board" / "Pricing & Plans"
  // buttons run the scrape chain with a customPrompt and expect a JSON
  // extraction. Only Firecrawl supports that server-side; the other
  // providers (Spider, Jina, Direct) return customExtraction: null even
  // when the scrape itself succeeds. Before this fallback, the user's
  // enrichment tab saved as null and the UI showed "No data returned
  // for this capability" — the user-visible regression.
  //
  // The fallback asks the multi-provider AI chain (Gemini → Anthropic →
  // OpenAI) to extract JSON from the page HTML using the customPrompt as
  // the schema instruction. It fires only when (a) the caller supplied
  // a customPrompt and (b) the scrape chain didn't already produce JSON.
  // Any failure is best-effort — the response still goes back with
  // customExtraction: null and the existing client-side "no data" path.

  // Helper that imports the function with a fresh AI providers mock.
  // The mock is module-scoped so loadHandler() must re-import for each
  // test (vi.resetModules() in beforeEach already does that).
  async function loadHandlerWithAI(runChainImpl, keyPresenceImpl) {
    vi.doMock("../functions/lib/aiProviders.js", () => ({
      runChain: runChainImpl,
      keyPresence: keyPresenceImpl || (() => ({ anthropic: true })),
    }));
    return loadHandler();
  }

  it("falls back to AI when the chain returns no customExtraction and customPrompt is set", async () => {
    // Direct fetch (the only provider without an API key) returns the
    // raw HTML but no JSON. The fallback should call the AI chain and
    // surface the AI's JSON in the response.
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.SPIDER_API_KEY;
    delete process.env.JINA_API_KEY;
    // Direct-fetch's HTML body has a <title> + a few paragraphs. The
    // mock below returns it; the fallback will strip tags and send the
    // resulting plain text to the AI chain.
    const html =
      "<html><head><title>Acme Inc — Leadership</title></head>" +
      "<body><h1>Acme Inc</h1>" +
      "<p>CEO: Jane Doe. CFO: John Smith. CTO: Alice Lee.</p>" +
      "<p>Board chair: Bob Brown. Director: Carol White.</p>" +
      "</body></html>";
    fetchMock.mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const aiJson = {
      contacts: [
        { name: "Jane Doe", role: "CEO" },
        { name: "John Smith", role: "CFO" },
      ],
    };
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, text: JSON.stringify(aiJson) });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com/leadership",
        options: {
          customPrompt:
            "Extract the names, job titles, and email addresses of leadership and the board.",
        },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    // The fallback fired.
    expect(body.data.json).toEqual(aiJson);
    expect(body._aiExtractFallback).toBe(true);
    // The AI chain was called once with a single user message that
    // contains the customPrompt as the instruction.
    expect(runChainMock).toHaveBeenCalledTimes(1);
    const messages = runChainMock.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toMatch(/INSTRUCTION:/);
    expect(messages[0].content).toMatch(/Extract the names/);
    expect(messages[0].content).toMatch(/Acme Inc/); // the page title made it through
  });

  it("tolerates a ```json fenced AI reply (parses the inner JSON anyway)", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response(
        "<html><head><title>X</title></head><body><p>plans: starter, pro, enterprise</p></body></html>",
        { status: 200 },
      ),
    );
    const aiJson = { plans: ["starter", "pro", "enterprise"] };
    const runChainMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: "```json\n" + JSON.stringify(aiJson) + "\n```" });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract every pricing tier." },
      }),
    });
    const body = JSON.parse(r.body);
    expect(body.data.json).toEqual(aiJson);
    expect(body._aiExtractFallback).toBe(true);
  });

  it("does NOT call the AI chain when the scrape chain already produced JSON (Firecrawl path)", async () => {
    // Firecrawl supports customPrompt natively — the AI fallback is
    // for when it doesn't. Make sure we don't double-call.
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            html: "<html></html>",
            metadata: { title: "T" },
            json: { from: "firecrawl" },
          },
        }),
        { status: 200 },
      ),
    );
    const runChainMock = vi.fn();
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "anything" },
      }),
    });
    const body = JSON.parse(r.body);
    expect(body.data.json).toEqual({ from: "firecrawl" });
    expect(body._aiExtractFallback).toBeUndefined();
    expect(runChainMock).not.toHaveBeenCalled();
  });

  it("does NOT call the AI chain when no customPrompt is set", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response("<html></html>", { status: 200 }),
    );
    const runChainMock = vi.fn();
    const h = await loadHandlerWithAI(runChainMock);
    await h({
      httpMethod: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(runChainMock).not.toHaveBeenCalled();
  });

  it("returns null customExtraction when the AI returns garbage (graceful degrade, not 500)", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response("<html></html>", { status: 200 }),
    );
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, text: "this is not JSON" });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract contacts." },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.data.json).toBeUndefined();
    expect(body._aiExtractFallback).toBeUndefined();
  });

  it("returns null customExtraction when no AI provider key is configured (silent skip)", async () => {
    // No key → keyPresence() returns all-false → fallback returns null
    // without ever calling runChain. The response stays 200.
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response("<html></html>", { status: 200 }),
    );
    const runChainMock = vi.fn();
    const h = await loadHandlerWithAI(runChainMock, () => ({
      gemini: false,
      anthropic: false,
      openai: false,
    }));
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract anything." },
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data.json).toBeUndefined();
    expect(runChainMock).not.toHaveBeenCalled();
  });

  it("returns null customExtraction when runChain returns ok:false (don't 500)", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response("<html></html>", { status: 200 }),
    );
    const runChainMock = vi.fn().mockResolvedValue({ ok: false, error: "rate_limited" });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract anything." },
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data.json).toBeUndefined();
  });
});
