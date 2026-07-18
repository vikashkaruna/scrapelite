// scripts/smoke-prod.test.mjs
// Unit tests for the post-deploy smoke script. Uses an in-memory fetcher
// to exercise all paths (success, failure, timeout, admin) without
// hitting the network. Runs in < 200ms — safe for CI on every push.

import { describe, expect, it, vi } from "vitest";
import { assertOk, fetchWithTimeout, runSmoke } from "./smoke-prod.mjs";

// ── In-memory fetcher that responds by path ──────────────────────────────
//
// Pattern: a function that returns a Response based on the request URL.
// We can swap individual path handlers per-test, and capture calls for
// assertions. Cleaner than mocking `fetch` globally with vi.stubGlobal.

function makeFetcher(handlers = {}) {
  const calls = [];
  const defaults = {
    "/": { status: 200, body: "<html>DatIQ — Extract & enrich</html>" },
    "/dashboard": { status: 200, body: "<html>SPA</html>" },
    "/pricing": { status: 200, body: "<html>SPA</html>" },
    "/batch": { status: 200, body: "<html>SPA</html>" },
    "/favicon.svg": { status: 200, body: "<svg/>" },
    "/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
    "/sitemap.xml": { status: 200, body: "<urlset/>" },
    "/llms.txt": { status: 200, body: "# DatIQ" },
    "/help/index.html": { status: 200, body: "<html>Help</html>" },
    "/api/stats": { status: 200, body: JSON.stringify({ teams: 0, extractions: 0 }) },
    "/.netlify/functions/admin-auth": {
      status: 200,
      body: JSON.stringify({ ok: true, token: "tok_abc", exp: 1234 }),
    },
    "/admin": { status: 200, body: "<html>Admin</html>" },
  };
  const routes = { ...defaults, ...handlers };

  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u.pathname + u.search, method: init.method || "GET" });
    const handler = routes[u.pathname] ?? routes[u.pathname + u.search];
    if (!handler) {
      return new Response("not found", { status: 404 });
    }
    return new Response(handler.body, {
      status: handler.status,
      statusText: handler.statusText || "OK",
      headers: { "Content-Type": handler.contentType || "text/html" },
    });
  };

  return { fetcher, calls, routes };
}

// Quiet logger so test output stays clean
const quiet = {
  log: () => {},
  error: () => {},
};

describe("assertOk", () => {
  it("accepts 2xx", () => {
    expect(() => assertOk({ status: 200, statusText: "OK" })).not.toThrow();
    expect(() => assertOk({ status: 204 })).not.toThrow();
    expect(() => assertOk({ status: 301 })).not.toThrow();
  });

  it("rejects 4xx and 5xx with a useful label", () => {
    expect(() => assertOk({ status: 404, statusText: "Not Found" }, "home"))
      .toThrow(/home.*HTTP 404/);
    expect(() => assertOk({ status: 500, statusText: "Server Error" }, "api"))
      .toThrow(/api.*HTTP 500/);
  });
});

describe("fetchWithTimeout", () => {
  it("returns the response on success", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout("https://x.test/", {}, 1000, fetcher);
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("aborts and wraps AbortError as a timeout message", async () => {
    const fetcher = vi.fn().mockImplementation((url, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    await expect(
      fetchWithTimeout("https://x.test/", {}, 50, fetcher)
    ).rejects.toThrow(/timed out after 50ms/);
  });

  it("passes through non-AbortError network errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      fetchWithTimeout("https://x.test/", {}, 1000, fetcher)
    ).rejects.toThrow(/fetch failed/);
  });
});

describe("runSmoke — happy path", () => {
  it("all 10 default probes pass against a healthy site", async () => {
    const { fetcher, calls } = makeFetcher();
    const result = await runSmoke("https://datiq.app", {
      fetcher,
      logger: quiet,
    });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(10);
    expect(result.failures).toEqual([]);
    // 10 default probes (admin skipped — no adminPin)
    const probed = calls.filter((c) => c.method === "GET").map((c) => c.url);
    expect(probed).toEqual([
      "/",
      "/dashboard",
      "/pricing",
      "/batch",
      "/favicon.svg",
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
      "/help/index.html",
      "/api/stats",
    ]);
  });

  it("admin probes run when adminPin is provided and pass", async () => {
    const { fetcher, calls } = makeFetcher();
    const result = await runSmoke("https://datiq.app", {
      fetcher,
      adminPin: "STAGING_PIN",
      logger: quiet,
    });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(12);
    const adminCall = calls.find((c) => c.url === "/.netlify/functions/admin-auth");
    expect(adminCall.method).toBe("POST");
  });
});

describe("runSmoke — failure paths", () => {
  it("rejects the home probe when body is missing the brand", async () => {
    const { fetcher } = makeFetcher({ "/": { status: 200, body: "<html>empty</html>" } });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(9);
    expect(result.failures[0]).toMatch(/GET \/ \(home contains brand\)/);
    expect(result.failures[0]).toMatch(/DatIQ|Extract/);
  });

  it("flags a 404 on a SPA route", async () => {
    const { fetcher } = makeFetcher({ "/dashboard": { status: 404, body: "" } });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/HTTP 404/);
  });

  it("flags a missing favicon", async () => {
    const { fetcher } = makeFetcher({ "/favicon.svg": undefined });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/favicon\.svg/);
  });

  it("accepts 503 from /api/stats (Supabase unconfigured is allowed)", async () => {
    const { fetcher } = makeFetcher({ "/api/stats": { status: 503, body: "down" } });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(10);
  });

  it("rejects unexpected 500 on /api/stats", async () => {
    const { fetcher } = makeFetcher({ "/api/stats": { status: 500, body: "" } });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/api\/stats/);
    expect(result.failures[0]).toMatch(/HTTP 500/);
  });

  it("flags a bad admin PIN (401 with error body)", async () => {
    const { fetcher } = makeFetcher({
      "/.netlify/functions/admin-auth": {
        status: 401,
        body: JSON.stringify({ ok: false, error: "Incorrect PIN.", code: "BAD_PIN" }),
      },
    });
    const result = await runSmoke("https://x.test", {
      fetcher,
      adminPin: "WRONG",
      logger: quiet,
    });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/admin-auth/);
    expect(result.failures[0]).toMatch(/HTTP 401/);
  });

  it("flags a 200 admin response with no token (server bug)", async () => {
    const { fetcher } = makeFetcher({
      "/.netlify/functions/admin-auth": {
        status: 200,
        body: JSON.stringify({ ok: false }),
      },
    });
    const result = await runSmoke("https://x.test", {
      fetcher,
      adminPin: "ANY",
      logger: quiet,
    });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/no token/);
  });

  it("counts multiple failures correctly", async () => {
    const { fetcher } = makeFetcher({
      "/pricing": { status: 500, body: "" },
      "/llms.txt": { status: 404, body: "" },
      "/robots.txt": { status: 502, body: "" },
    });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(3);
    expect(result.passed).toBe(7);
    expect(result.failures).toHaveLength(3);
  });
});
