import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
const TEST_SECRET = "test-secret";

function makeAdminToken() {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.JINA_API_KEY;
  process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin-provider-test — pagespeed and scrape providers", () => {
  it("testProvider('pagespeed') includes category=performance in Google API request", async () => {
    fetchMock.mockImplementationOnce(async (url) => {
      expect(url).toContain("category=performance");
      expect(url).toContain("strategy=mobile");
      return new Response(JSON.stringify({
        lighthouseResult: { categories: { performance: { score: 0.95 } } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const { testProvider } = await import("../functions/admin-provider-test.js");
    const res = await testProvider("pagespeed");
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("pagespeed");
    expect(res.detail.performanceScore).toBe(95);
  });

  it("testProvider('jina') tests Jina reader scraping", async () => {
    fetchMock.mockImplementationOnce(async (url) => {
      expect(url).toContain("r.jina.ai");
      return new Response(JSON.stringify({
        data: { title: "Example Domain", content: "# Example\nText here" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const { testProvider } = await import("../functions/admin-provider-test.js");
    const res = await testProvider("jina");
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("jina");
    expect(res.detail.title).toBe("Example Domain");
  });

  it("handler auth rejection and options", async () => {
    const { handler } = await import("../functions/admin-provider-test.js");
    const optRes = await handler({ httpMethod: "OPTIONS" });
    expect(optRes.statusCode).toBe(204);

    const unauthRes = await handler({ httpMethod: "POST", headers: {}, body: "{}" });
    expect(unauthRes.statusCode).toBe(401);

    fetchMock.mockImplementationOnce(async () => {
      return new Response(JSON.stringify({
        lighthouseResult: { categories: { performance: { score: 0.88 } } }
      }), { status: 200 });
    });

    const authRes = await handler({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ provider: "pagespeed" }),
    });
    expect(authRes.statusCode).toBe(200);
    const body = JSON.parse(authRes.body);
    expect(body.ok).toBe(true);
  });
});
