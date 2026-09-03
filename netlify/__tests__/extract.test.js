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
    // A system turn now carries the "report only what the page states, an
    // honest empty field beats an invented one" contract, and the user turn
    // carries the instruction plus the page content.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toMatch(/never/i);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toMatch(/USER INSTRUCTION:/);
    expect(messages[1].content).toMatch(/Extract the names/);
    expect(messages[1].content).toMatch(/Acme Inc/); // the page title made it through
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

  it("falls back to AI when Firecrawl's own JSON extraction comes back as an empty object", async () => {
    // Firecrawl's prompt-only (schema-less) JSON extraction frequently
    // returns `{}` when it can't confidently match the prompt on a real
    // page. `{}` is truthy in JS, so a naive `!result.customExtraction`
    // check treated "found nothing" as "already handled" and skipped the
    // AI fallback entirely — the user-reported regression this pins.
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            html: "<html><head><title>Acme</title></head><body><p>CEO: Jane Doe</p></body></html>",
            metadata: { title: "Acme" },
            json: {}, // Firecrawl succeeded but found nothing for the prompt
          },
        }),
        { status: 200 },
      ),
    );
    const aiJson = { contacts: [{ name: "Jane Doe", role: "CEO" }] };
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, text: JSON.stringify(aiJson) });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com/leadership",
        options: { customPrompt: "Extract leadership contacts." },
      }),
    });
    const body = JSON.parse(r.body);
    expect(body.data.json).toEqual(aiJson);
    expect(body._aiExtractFallback).toBe(true);
    expect(runChainMock).toHaveBeenCalledTimes(1);
  });

  it("reports no data (not a stale empty object) when both Firecrawl and the AI fallback find nothing", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { html: "<html></html>", metadata: { title: "T" }, json: {} },
        }),
        { status: 200 },
      ),
    );
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, text: "{}" });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract pricing." },
      }),
    });
    const body = JSON.parse(r.body);
    // Both the provider and the AI fallback genuinely found nothing —
    // the response should say so explicitly (undefined), not carry a
    // stale `{}` that the client would render as ambiguous "no data".
    expect(body.data.json).toBeUndefined();
  });

  it("parses a bare JSON array reply even with a preamble the model added despite instructions", async () => {
    // "Social Links" is naturally array-shaped ("extract all social
    // profile URLs"). If the model prefixes its reply with a one-line
    // intro and returns `[...]` rather than `{...}`, the loose parser's
    // old "find { ... }" last resort found no braces at all and threw
    // away a perfectly good extraction.
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response("<html><body><p>Follow us on Twitter and LinkedIn</p></body></html>", { status: 200 }),
    );
    const links = ["https://twitter.com/acme", "https://linkedin.com/company/acme"];
    const runChainMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: `Here are the links:\n${JSON.stringify(links)}` });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract all social media profile URLs." },
      }),
    });
    const body = JSON.parse(r.body);
    expect(body.data.json).toEqual(links);
    expect(body._aiExtractFallback).toBe(true);
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

  // An empty enrichment used to be a single indistinguishable outcome: "No
  // data returned for this capability", shown identically whether the server
  // had no AI key, the provider was down, the account was out of credit, the
  // reply was unparseable, or the page simply had no pricing on it. Only some
  // of those are actionable, and collapsing them is why "none of the Quick
  // enrichment buttons work" survived several rounds of fixes.
  describe("empty enrichment carries WHY", () => {
    // Real content, not "<html></html>" — a document with no readable text is
    // now its OWN reason (page_no_content), so an empty fixture would test the
    // content gate instead of the reason under test.
    const PAGE = "<html><head><title>Acme</title></head><body><main>" +
      "<h1>Acme Inc</h1><p>We sell widgets to enterprise buyers across Europe " +
      "and North America. Our platform handles procurement end to end.</p>" +
      "</main></body></html>";
    const emptyPageEvent = {
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: { customPrompt: "Extract every pricing tier." },
      }),
    };

    beforeEach(() => {
      process.env.SCRAPE_PROVIDER_ORDER = "direct";
      delete process.env.FIRECRAWL_API_KEY;
    });

    it("reason=ai_not_configured when no provider key is set", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn();
      const h = await loadHandlerWithAI(runChainMock, () => ({
        gemini: false, anthropic: false, openai: false,
      }));
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.ok).toBe(false);
      // COLLAPSED on the way out. The specific reason (ai_not_configured) is
      // in the function log and on /admin/ai; a customer-facing body carries
      // one opaque code, because `code: "no_credit"` in a network tab says
      // what the prose was rewritten to stop saying.
      expect(body._enrichment.reason).toBe("ai_unavailable");
      expect(runChainMock).not.toHaveBeenCalled();
    });

    it("reason=ai_chain_failed when the provider throws", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockRejectedValue(new Error("upstream 500"));
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.reason).toBe("ai_unavailable");
    });

    // The production outage: three keys PRESENT, all three dead. The chain
    // reports errorCode "no_credit"; the user must be told to top up, not
    // told their page is empty.
    it("reason=ai_no_credit when every provider is out of credit", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockResolvedValue({
        ok: false, errorCode: "no_credit",
        attempts: [{ provider: "anthropic", code: "no_credit", error: "credit balance is too low" }],
      });
      const h = await loadHandlerWithAI(runChainMock);
      const r = await h(emptyPageEvent);
      const body = JSON.parse(r.body);
      expect(body._enrichment.reason).toBe("ai_unavailable");
      // ⚠️ `attempts` used to travel here carrying the vendor's own words —
      // "Your credit balance is too low…" — to every customer and /api/v1 key
      // holder. Nothing in the body may name a vendor or our billing state.
      expect(body._enrichment.attempts).toBeUndefined();
      expect(r.body).not.toMatch(/credit|anthropic|gemini|openai/i);
    });

    it("reason=ai_bad_key when the key is present and rejected", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockResolvedValue({ ok: false, errorCode: "bad_key" });
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.reason).toBe("ai_unavailable");
    });

    it("reason=ai_unparseable when the model answers with prose", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockResolvedValue({
        ok: true, text: "I'm sorry, I could not find that on the page.",
      });
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.reason).toBe("ai_unavailable");
    });

    it("reason=page_no_content when the scrape produced nothing readable", async () => {
      fetchMock.mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));
      const runChainMock = vi.fn();
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.reason).toBe("page_no_content");
      // No point spending a model call on a page with no text.
      expect(runChainMock).not.toHaveBeenCalled();
    });

    it("reason=no_match only when the AI genuinely read the page and found nothing", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockResolvedValue({ ok: true, text: "{}" });
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body._enrichment.reason).toBe("no_match");
    });

    it("reports ok:true with provider, model and fact count on success", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const runChainMock = vi.fn().mockResolvedValue({
        ok: true, provider: "gemini", model: "gemini-2.5-pro", structured: true,
        json: { plans: [{ name: "Free" }] },
        text: JSON.stringify({ plans: [{ name: "Free" }] }),
      });
      const h = await loadHandlerWithAI(runChainMock);
      const body = JSON.parse((await h(emptyPageEvent)).body);
      expect(body.data.json).toEqual({ plans: [{ name: "Free" }] });
      expect(body._enrichment.ok).toBe(true);
      expect(body._enrichment.facts).toBeGreaterThan(0);
      // INVERTED 2026-09-03. This used to assert `provider === "gemini"` and
      // `structured === true` — encoding the leak as a contract. Those three
      // fields describe OUR STACK, not the customer's page, and the UI rendered
      // them as an `openai · gpt-4o-mini` chip on the customer's own report.
      // Redacted at the source by publicProvenance(); see
      // netlify/__tests__/provenance-redaction.test.js.
      expect(body._enrichment).not.toHaveProperty("provider");
      expect(body._enrichment).not.toHaveProperty("model");
      expect(body._enrichment).not.toHaveProperty("structured");
      expect(JSON.stringify(body)).not.toMatch(/gemini|openai|anthropic/i);
    });

    it("is ABSENT when no customPrompt or enrichKey was asked for", async () => {
      fetchMock.mockResolvedValueOnce(new Response(PAGE, { status: 200 }));
      const h = await loadHandlerWithAI(vi.fn());
      const r = await h({
        httpMethod: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(JSON.parse(r.body)._enrichment).toBeUndefined();
    });
  });

  // The page body is what every downstream AI prompt was missing.
  describe("returns the page body text", () => {
    it("carries structure-preserving text alongside the raw html", async () => {
      process.env.SCRAPE_PROVIDER_ORDER = "direct";
      delete process.env.FIRECRAWL_API_KEY;
      fetchMock.mockResolvedValueOnce(new Response(
        "<html><head><title>Acme</title></head><body><nav>Home About</nav><main>" +
        "<h2>Plans</h2><table><tr><th>Plan</th><th>Price</th></tr>" +
        "<tr><td>Pro</td><td>$29</td></tr></table>" +
        "<p>Acme sells procurement software to enterprise buyers worldwide, " +
        "covering sourcing, contracting and supplier management.</p>" +
        "</main></body></html>", { status: 200 }));
      const h = await loadHandlerWithAI(vi.fn());
      const body = JSON.parse((await h({
        httpMethod: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      })).body);
      expect(body.data.text).toContain("## Plans");
      // The table's row/column relationship survives — this is what makes a
      // pricing grid extractable instead of "Pro $29 Business $79" soup.
      expect(body.data.text).toContain("| Pro | $29 |");
      expect(body.data.textMeta.chars).toBeGreaterThan(0);
    });
  });
});

// ── Related-page gathering ────────────────────────────────────────────────────
//
// "Pricing & Plans" run against a homepage that has no pricing on it (plans
// live on /pricing) used to report "no data returned" even though the site
// plainly has the answer one link away. Entity capabilities now gather their
// same-domain subpages BEFORE the model call, so one AI call reasons over the
// whole company surface instead of one page at a time.
describe("extract — related-page gathering (enrichKey)", () => {
  async function loadHandlerWithAI(runChainImpl) {
    vi.doMock("../functions/lib/aiProviders.js", () => ({
      runChain: runChainImpl,
      keyPresence: () => ({ anthropic: true }),
    }));
    return loadHandler();
  }

  const HOME =
    "<html><head><title>Acme Inc</title></head><body><main>" +
    "<h1>Acme Inc</h1><p>We build procurement software for enterprise teams.</p>" +
    '<a href="/pricing">See our plans</a>' +
    "</main></body></html>";
  const PRICING =
    "<html><head><title>Acme Pricing</title></head><body><main>" +
    "<h1>Plans</h1>" +
    "<p>Starter: $10/mo for small teams getting started with procurement.</p>" +
    "<p>Pro: $30/mo per seat, adds approvals, supplier scoring and SSO.</p>" +
    "<p>Enterprise: contact us for volume pricing and a dedicated CSM.</p>" +
    "</main></body></html>";

  it("reads the linked /pricing page in the SAME AI call as the homepage", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock
      .mockResolvedValueOnce(new Response(HOME, { status: 200 }))     // base scrape
      .mockResolvedValueOnce(new Response(PRICING, { status: 200 })); // related fetch

    const aiJson = { plans: [{ name: "Starter", price: "$10" }, { name: "Pro", price: "$30" }] };
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, json: aiJson, text: JSON.stringify(aiJson) });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "Extract every pricing tier.", enrichKey: "pricing" },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.data.json).toEqual(aiJson);
    expect(body._relatedPagesScanned).toEqual(["https://acme.com/pricing"]);
    // ONE call, not two: the subpage is gathered up front, not after a failure.
    expect(runChainMock).toHaveBeenCalledTimes(1);
    const prompt = runChainMock.mock.calls[0][0].at(-1).content;
    expect(prompt).toMatch(/We build procurement software/);
    expect(prompt).toMatch(/Starter: \$10\/mo/);
    // Page markers let the model attribute evidence to the right URL.
    expect(prompt).toMatch(/--- PAGE: https:\/\/acme\.com\/pricing ---/);
    expect(fetchMock.mock.calls[2][0]).toBe("https://acme.com/pricing");
  });

  it("drives the model with the capability's JSON Schema", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock
      .mockResolvedValueOnce(new Response(HOME, { status: 200 }))
      .mockResolvedValueOnce(new Response(PRICING, { status: 200 }));
    const runChainMock = vi.fn().mockResolvedValue({ ok: true, json: { plans: [{ name: "Pro" }] } });
    const h = await loadHandlerWithAI(runChainMock);
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "Extract every pricing tier.", enrichKey: "pricing" },
      }),
    });
    const opts = runChainMock.mock.calls[0][2];
    expect(opts.area).toBe("enrichment");
    expect(opts.schema.properties.plans).toBeTruthy();
    expect(opts.schema.properties.evidence).toBeTruthy();
  });

  it("does not gather related pages when no enrichKey was supplied", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(new Response(HOME, { status: 200 }));
    const runChainMock = vi.fn().mockResolvedValue({ ok: false, errorCode: "error" });
    const h = await loadHandlerWithAI(runChainMock);
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "Extract every pricing tier." }, // no enrichKey
      }),
    });
    const body = JSON.parse(r.body);
    expect(body._enrichment.reason).toBe("ai_unavailable");
    expect(body._relatedPagesScanned).toBeUndefined();
    expect(runChainMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // robots.txt + base scrape only
  });

  // ── THE REGRESSION THAT HID A TOTAL AI OUTAGE ─────────────────────────────
  // `enrichmentReason = relatedRes.reason || aiRes.reason || "no_match"` let a
  // related-page scan that found no candidate links overwrite a real
  // ai_chain_failed with "no_match". In production, with all three AI keys
  // dead, that reported "the AI read this page and found nothing" for every
  // capability whose hints matched no link — which is most of them. The user
  // was told their pages were empty for weeks while the real cause was
  // billing. Infrastructure reasons must outrank absence reasons.
  it("does NOT let a fruitless related-page scan mask an AI failure", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    // No link matches any pricing hint, so the scan finds nothing to read.
    fetchMock.mockResolvedValueOnce(new Response(
      "<html><head><title>Acme</title></head><body><main><h1>Acme</h1>" +
      "<p>We build procurement software for enterprise teams worldwide.</p>" +
      '<a href="/careers">Careers</a></main></body></html>', { status: 200 }));
    const runChainMock = vi.fn().mockResolvedValue({
      ok: false, errorCode: "no_credit",
      attempts: [{ provider: "anthropic", code: "no_credit" }],
    });
    const h = await loadHandlerWithAI(runChainMock);
    const body = JSON.parse((await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "Extract every pricing tier.", enrichKey: "pricing" },
      }),
    })).body);
    // The contract under test is "OURS, not THEIRS" — that a fruitless
    // related-page scan cannot relabel an infrastructure failure as a finding
    // about the customer's page. The specific cause is redacted on the way
    // out; the distinction that matters is not.
    expect(body._enrichment.reason).toBe("ai_unavailable");
    expect(body._enrichment.reason).not.toBe("no_match");
  });

  it("does not burn extra fetches retrying when the failure is infrastructure", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    // `social` has no hints, so nothing is gathered up front; the old code
    // would still have run the consolation scan and relabelled the reason.
    fetchMock.mockResolvedValueOnce(new Response(HOME, { status: 200 }));
    const runChainMock = vi.fn().mockResolvedValue({ ok: false, errorCode: "bad_key" });
    const h = await loadHandlerWithAI(runChainMock);
    const body = JSON.parse((await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "Extract social links.", enrichKey: "social" },
      }),
    })).body);
    expect(body._enrichment.reason).toBe("ai_unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2); // robots + base scrape, nothing more
  });

  it("rejects an enrichKey that isn't a known capability", async () => {
    process.env.SCRAPE_PROVIDER_ORDER = "direct";
    delete process.env.FIRECRAWL_API_KEY;
    fetchMock.mockResolvedValueOnce(new Response(HOME, { status: 200 }));
    const runChainMock = vi.fn().mockResolvedValue({ ok: false, errorCode: "error" });
    const h = await loadHandlerWithAI(runChainMock);
    const body = JSON.parse((await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://acme.com",
        options: { customPrompt: "x", enrichKey: "'; DROP TABLE extractions;--" },
      }),
    })).body);
    // Unwhitelisted key is dropped silently and behaves as if none was given.
    expect(body._relatedPagesScanned).toBeUndefined();
    expect(body._enrichment.capability).toBe("custom");
  });
});

// ── FD3 compliance: a refusal is free, and overridable only from the server ──
//
// The bug this suite exists for: consumeGuestCredit ran BEFORE the robots.txt
// check, so a guest who pasted three LinkedIn URLs spent three of their ten
// free extractions on requests that were declined before any provider was
// contacted. You do not bill for work you refused to do.
describe("extract — robots.txt refusal", () => {
  const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
  const linkedInEvent = {
    httpMethod: "POST",
    body: JSON.stringify({ url: "https://www.linkedin.com/in/vikashkaruna" }),
  };

  /** Reload the handler with guestUsage + consent mocked so we can observe them. */
  async function loadWithMocks({ consumeSpy, consentGranted = false, consentDegraded = false, user = null } = {}) {
    vi.resetModules();
    vi.doMock("../functions/lib/guestUsage.js", () => ({
      consumeGuestCredit: consumeSpy,
    }));
    vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
      authenticateBearer: vi.fn(async () =>
        user ? { ok: true, user, client: {} } : { ok: false, status: 401, body: {} },
      ),
      getUserScopedClient: vi.fn(() => ({ client: null })),
    }));
    vi.doMock("../functions/lib/scrapeConsent.js", () => ({
      hasScrapeConsent: vi.fn(async () => ({
        granted: consentGranted, expiresAt: null, degraded: consentDegraded,
      })),
    }));
    // The entitlement gate runs BEFORE compliance (a denied account must cost
    // nothing on the wire). Stub it to "allowed" so this suite tests the
    // compliance gate alone — entitlement has its own suite in
    // entitlement-enforcement.test.js.
    vi.doMock("../functions/lib/requireEntitlement.js", () => ({
      resolveRequestEntitlement: vi.fn(async () => ({ userId: user?.id ?? null, guest: !user })),
      checkCapability: vi.fn(() => ({ allowed: true })),
      DENY_STATUS: 402,
      denyBody: vi.fn(() => ({})),
    }));
    // Keep the suite hermetic. The real publicUrl helpers resolve DNS, and
    // linkedin.com is unreachable from CI — which does not merely slow the
    // test, it INVERTS it: loadRobots fails open on a network error, so the
    // refusal under test silently becomes an allow.
    vi.doMock("../functions/lib/publicUrl.js", () => ({
      isPublicHttpUrlAsync: vi.fn(async () => true),
      isPublicHttpUrl: vi.fn(() => true),
      fetchPublicUrl: vi.fn((...args) => globalThis.fetch(...args)),
    }));
    const mod = await import("../functions/extract.js");
    return mod.handler;
  }

  beforeEach(() => {
    // Replace the permissive robots.txt queued by the outer beforeEach.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(DISALLOW_ALL, { status: 200 }));
  });

  it("refuses with 403 and a machine-readable code", async () => {
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy });
    const r = await h(linkedInEvent);
    expect(r.statusCode).toBe(403);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("robots_disallowed");
    expect(body._complianceBlocked).toBe(true);
    expect(body.host).toBe("www.linkedin.com");
    // The path a support report needs, echoed intact.
    expect(body.error).toContain("path=/in/vikashkaruna");
  });

  it("does NOT consume a guest credit for a refused request", async () => {
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy });
    const r = await h(linkedInEvent);
    expect(r.statusCode).toBe(403);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("tells a signed-in user the refusal is overridable", async () => {
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy, user: { id: "u1" } });
    const body = JSON.parse((await h({ ...linkedInEvent, headers: { authorization: "Bearer t" } })).body);
    expect(body.consentAvailable).toBe(true);
  });

  it("does NOT offer the override to a guest", async () => {
    // An anonymous cookie is nobody to attribute a permission claim to.
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy });
    const body = JSON.parse((await h(linkedInEvent)).body);
    expect(body.consentAvailable).toBe(false);
  });

  it("proceeds when the signed-in user has a recorded attestation", async () => {
    const consumeSpy = vi.fn(async () => ({ allowed: true, cookie: null }));
    const h = await loadWithMocks({ consumeSpy, user: { id: "u1" }, consentGranted: true });
    const r = await h({ ...linkedInEvent, headers: { authorization: "Bearer t" } });
    expect(r.statusCode).not.toBe(403);
    // Past the gate, the request is billed like any other.
    expect(consumeSpy).toHaveBeenCalled();
  });

  it("IGNORES a client-supplied consent flag", async () => {
    // The whole point: consent is read server-side from the JWT. A flag a
    // client can set is not an attestation, it is compliance-off as a query
    // parameter.
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy });
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        url: "https://www.linkedin.com/in/vikashkaruna",
        consented: true,
        options: { consented: true, skipCompliance: true },
      }),
    });
    expect(r.statusCode).toBe(403);
  });

  it("does NOT offer the override when the consent store cannot answer", async () => {
    // `degraded` means the store is unconfigured, unmigrated or unreachable —
    // so recording an attestation would fail too. Offering the override there
    // sends the user into a dialog that can only error: they tick the box, the
    // POST 502s, and nothing is granted. This is the state the product is in
    // until 0028_scrape_consent.sql has been applied.
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy, user: { id: "u1" }, consentDegraded: true });
    const body = JSON.parse((await h({ ...linkedInEvent, headers: { authorization: "Bearer t" } })).body);
    expect(body.code).toBe("robots_disallowed");
    expect(body.consentAvailable).toBe(false);
  });

  it("keeps the refusal standing when the consent lookup THROWS", async () => {
    // The outer catch around the compliance block fails open, which is right
    // for "could not read robots.txt" and catastrophic for "could not read the
    // attestation": it would allow a scrape the site refused. An error
    // resolving consent must mean NO consent.
    vi.resetModules();
    vi.doMock("../functions/lib/guestUsage.js", () => ({ consumeGuestCredit: vi.fn() }));
    vi.doMock("../functions/lib/requireEntitlement.js", () => ({
      resolveRequestEntitlement: vi.fn(async () => ({ userId: user?.id ?? null, guest: !user })),
      checkCapability: vi.fn(() => ({ allowed: true })),
      DENY_STATUS: 402,
      denyBody: vi.fn(() => ({})),
    }));
    vi.doMock("../functions/lib/publicUrl.js", () => ({
      isPublicHttpUrlAsync: vi.fn(async () => true),
      isPublicHttpUrl: vi.fn(() => true),
      fetchPublicUrl: vi.fn((...a) => globalThis.fetch(...a)),
    }));
    vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
      authenticateBearer: vi.fn(async () => { throw new Error("auth exploded"); }),
      getUserScopedClient: vi.fn(() => ({ client: null })),
    }));
    vi.doMock("../functions/lib/scrapeConsent.js", () => ({ hasScrapeConsent: vi.fn() }));
    const { handler } = await import("../functions/extract.js");
    const r = await handler({ ...linkedInEvent, headers: { authorization: "Bearer t" } });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).consentAvailable).toBe(false);
  });

  it("does not offer the override for an operator allowlist rejection", async () => {
    // host_not_permitted is the OPERATOR's decision; a user must not be able to
    // attest their way past their own operator.
    process.env.PERMITTED_HOSTS = "example.com";
    const consumeSpy = vi.fn();
    const h = await loadWithMocks({ consumeSpy, user: { id: "u1" } });
    const body = JSON.parse((await h({ ...linkedInEvent, headers: { authorization: "Bearer t" } })).body);
    expect(body.code).toBe("host_not_permitted");
    expect(body.consentAvailable).toBe(false);
    delete process.env.PERMITTED_HOSTS;
  });
});
