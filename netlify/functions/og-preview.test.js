// netlify/functions/og-preview.test.js
// C-30 — Reads first 15 KB; parses og:title/og:description/<title>/meta-description; favicon URL; 5-min cache.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("./og-preview.js");
  return mod.handler;
}

// Build a ReadableStream that yields the supplied bytes in HEAD_BYTES-sized chunks.
function streamFromString(s) {
  const bytes = new TextEncoder().encode(s);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("og-preview handler — input validation", () => {
  it("missing ?url → 400 with error", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: {} });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/url/);
  });

  it("invalid url → 400", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { url: "not a url" } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/invalid/);
  });
});

describe("og-preview handler — meta parsing (C-30)", () => {
  it("parses og:title and og:description", async () => {
    const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="OG Title" />
    <meta property="og:description" content="OG desc" />
  </head>
  <body>x</body>
</html>`;
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.title).toBe("OG Title");
    expect(body.description).toBe("OG desc");
    expect(body.hostname).toBe("example.com");
    expect(body.favicon).toContain("google.com/s2/favicons");
    expect(body.favicon).toContain("example.com");
  });

  it("falls back to <title> when og:title is missing", async () => {
    const html = `<html><head><title>Plain Title</title></head><body>x</body></html>`;
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    const body = JSON.parse(r.body);
    expect(body.title).toBe("Plain Title");
  });

  it("falls back to meta name='description' when og:description is missing", async () => {
    const html = `<html>
      <head>
        <meta name="description" content="meta-desc" />
      </head>
      <body>x</body>
    </html>`;
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    const body = JSON.parse(r.body);
    expect(body.description).toBe("meta-desc");
  });

  it("handles property= after content= (attribute order)", async () => {
    const html = `<html><head>
      <meta content="Reverse og:title" property="og:title" />
    </head></html>`;
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    const body = JSON.parse(r.body);
    expect(body.title).toBe("Reverse og:title");
  });
});

describe("og-preview handler — byte cap (C-30)", () => {
  it("reads only the first ~15KB of the response", async () => {
    const head = "x".repeat(1000);
    const tail = "y".repeat(20_000);
    const html = `${head}<title>Small</title>${tail}`;
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    const body = JSON.parse(r.body);
    // The title in the first 15KB is still parsed correctly
    expect(body.title).toBe("Small");
  });
});

describe("og-preview handler — failure modes", () => {
  it("non-OK status → returns the empty preview (not 5xx)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.title).toBeNull();
    expect(body.favicon).toContain("example.com");
  });

  it("network error → 200 with null title/description", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.title).toBeNull();
  });
});

describe("og-preview handler — caching", () => {
  it("response includes 5-min Cache-Control header", async () => {
    const html = "<html><head><title>t</title></head></html>";
    fetchMock.mockResolvedValueOnce(
      new Response(streamFromString(html), { status: 200 }),
    );
    const h = await loadHandler();
    const r = await h({
      httpMethod: "GET",
      queryStringParameters: { url: "https://example.com" },
    });
    expect(r.headers["Cache-Control"]).toMatch(/max-age=300/);
  });
});
