// scripts/smoke-prod.test.mjs
// Unit tests for the post-deploy smoke script. Uses an in-memory fetcher
// to exercise all paths (success, failure, timeout, admin) without
// hitting the network. Runs in < 200ms — safe for CI on every push.

import { describe, expect, it, vi } from "vitest";
import {
  assertContentType,
  assertOk,
  describeFetchError,
  fetchWithRetry,
  fetchWithTimeout,
  runSmoke,
} from "./smoke-prod.mjs";

// ── In-memory fetcher that responds by path ──────────────────────────────
//
// Pattern: a function that returns a Response based on the request URL.
// We can swap individual path handlers per-test, and capture calls for
// assertions. Cleaner than mocking `fetch` globally with vi.stubGlobal.

function makeFetcher(handlers = {}) {
  const calls = [];
  // Content types mirror what Netlify actually serves. They matter: the smoke
  // script asserts them to unmask an SPA catch-all serving index.html at 200
  // in place of a missing static file or function.
  const defaults = {
    // Bodies carry an <h1> because production now serves PRERENDERED documents
    // at / and /pricing, not the SPA shell. The smoke script asserts that, so a
    // shell-shaped fixture here would be testing the wrong world.
    "/": { status: 200, body: "<html><body><h1>Intelligence from the Web.</h1>DatIQ — Extract & enrich</body></html>", contentType: "text/html; charset=UTF-8" },
    "/dashboard": { status: 200, body: "<html>SPA</html>", contentType: "text/html" },
    "/pricing": { status: 200, body: "<html><body><h1>Simple, transparent pricing</h1></body></html>", contentType: "text/html" },
    "/batch": { status: 200, body: "<html>SPA</html>", contentType: "text/html" },
    "/favicon.svg": { status: 200, body: "<svg/>", contentType: "image/svg+xml" },
    "/robots.txt": { status: 200, body: "User-agent: *\nAllow: /", contentType: "text/plain; charset=utf-8" },
    "/sitemap.xml": { status: 200, body: "<urlset/>", contentType: "application/xml" },
    "/llms.txt": { status: 200, body: "# DatIQ", contentType: "text/plain; charset=utf-8" },
    "/help/index.html": { status: 200, body: "<html>Help</html>", contentType: "text/html" },
    "/api/stats": { status: 200, body: JSON.stringify({ teams: 0, extractions: 0 }), contentType: "application/json" },
    "/.netlify/functions/admin-auth": {
      status: 200,
      body: JSON.stringify({ ok: true, token: "tok_abc", exp: 1234 }),
      contentType: "application/json",
    },
    "/admin": { status: 200, body: "<html>Admin</html>", contentType: "text/html" },
  };

  // What the SPA catch-all returns for a path that does not exist on disk:
  // the app shell, at 200, as HTML. This is the failure the guard must catch.
  const SPA_FALLBACK = { status: 200, body: "<html>DatIQ app shell</html>", contentType: "text/html; charset=UTF-8" };
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

  return { fetcher, calls, routes, SPA_FALLBACK };
}

// Standalone copy for tests that build their own handler overrides.
const SPA_FALLBACK = { status: 200, body: "<html>DatIQ app shell</html>", contentType: "text/html; charset=UTF-8" };

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

describe("assertContentType", () => {
  const res = (ct) => ({ headers: new Headers(ct ? { "Content-Type": ct } : {}) });

  it("accepts an exact match", () => {
    expect(() => assertContentType(res("application/json"), "application/json")).not.toThrow();
  });

  it("accepts a match with charset or vendor suffix", () => {
    expect(() => assertContentType(res("text/plain; charset=utf-8"), "text/plain")).not.toThrow();
    expect(() => assertContentType(res("image/svg+xml"), "image/svg")).not.toThrow();
    expect(() => assertContentType(res("application/xml"), "xml")).not.toThrow();
  });

  it("is case-insensitive", () => {
    expect(() => assertContentType(res("APPLICATION/JSON"), "application/json")).not.toThrow();
  });

  it("rejects a mismatch and names both types", () => {
    expect(() => assertContentType(res("text/html"), "application/json", "GET /api/stats"))
      .toThrow(/GET \/api\/stats.*text\/html.*application\/json/);
  });

  it("explains the SPA-catch-all cause in the message", () => {
    expect(() => assertContentType(res("text/html"), "text/plain"))
      .toThrow(/catch-all served index\.html/);
  });

  it("rejects a missing Content-Type header", () => {
    expect(() => assertContentType(res(null), "application/json")).toThrow(/\(none\)/);
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

describe("describeFetchError", () => {
  // Node's fetch reports every transport failure as the same opaque TypeError.
  // The real reason lives on err.cause — without surfacing it, a dead host, a
  // wrong hostname and a TLS failure all print one identical, useless line.
  const withCause = (msg, cause) => Object.assign(new TypeError(msg), { cause });

  it("surfaces err.cause.code — the whole point", () => {
    expect(describeFetchError(withCause("fetch failed", { code: "ENOTFOUND" })))
      .toBe("fetch failed (ENOTFOUND)");
  });

  it.each(["ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"])(
    "names %s so the failure is diagnosable", (code) => {
      expect(describeFetchError(withCause("fetch failed", { code })))
        .toBe(`fetch failed (${code})`);
    });

  it("falls back to errno when there is no code", () => {
    expect(describeFetchError(withCause("fetch failed", { errno: -3008 })))
      .toBe("fetch failed (-3008)");
  });

  it("falls back to the cause message when there is no code or errno", () => {
    expect(describeFetchError(withCause("fetch failed", { message: "socket hang up" })))
      .toBe("fetch failed (socket hang up)");
  });

  it("does not duplicate an identical cause message", () => {
    expect(describeFetchError(withCause("fetch failed", { message: "fetch failed" })))
      .toBe("fetch failed");
  });

  it("degrades safely on a bare error or a non-error", () => {
    expect(describeFetchError(new Error("boom"))).toBe("boom");
    expect(describeFetchError(undefined)).toBe("request failed");
  });
});

describe("fetchWithTimeout — error enrichment", () => {
  it("enriches a transport error with its cause code", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })
    );
    await expect(fetchWithTimeout("https://x.test/", {}, 1000, fetcher))
      .rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("fetchWithRetry", () => {
  const noSleep = () => Promise.resolve();

  it("returns the first successful response without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://x.test/", {}, { fetcher, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a transport failure and succeeds on a later attempt", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://x.test/", {}, { fetcher, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up after `retries` attempts and reports the count plus the cause", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })
    );
    await expect(fetchWithRetry("https://x.test/", {}, { fetcher, retries: 3, sleep: noSleep }))
      .rejects.toThrow(/ENOTFOUND.*after 3 attempts/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry an HTTP error — fetch resolved, so the result is real", async () => {
    // A 500 is an answer, not a transport failure. Retrying it would only slow
    // the gate down before failing anyway.
    const fetcher = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await fetchWithRetry("https://x.test/", {}, { fetcher, sleep: noSleep });
    expect(res.status).toBe(500);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("backs off progressively between attempts", async () => {
    const waits = [];
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchWithRetry("https://x.test/", {}, {
      fetcher, retries: 3, backoffMs: 100, sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
    })).rejects.toThrow();
    expect(waits).toEqual([100, 200]);
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

  it("skipApi omits the /api/stats probe entirely (static-server mode)", async () => {
    const { fetcher, calls } = makeFetcher();
    const result = await runSmoke("http://localhost:4173", {
      fetcher,
      skipApi: true,
      logger: quiet,
    });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(9);
    const probed = calls.map((c) => c.url);
    expect(probed).not.toContain("/api/stats");
  });
});

describe("runSmoke — failure paths", () => {
  it("rejects the home probe when body is missing the brand", async () => {
    const { fetcher } = makeFetcher({ "/": { status: 200, body: "<html>empty</html>" } });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(9);
    expect(result.failures[0]).toMatch(/GET \/ \(home serves rendered content/);
    expect(result.failures[0]).toMatch(/DatIQ|Extract/);
  });

  it("rejects the home probe when the BARE SHELL is served", async () => {
    // The case nothing in CI could previously see. The shell 200s and its
    // <title> and meta both contain "DatIQ", so the brand check above passes
    // while the page has no rendered content at all. Only structure separates
    // a prerendered document from the shell.
    const { fetcher } = makeFetcher({
      "/": { status: 200, body: '<html><head><title>DatIQ</title></head><body><div id="root"></div></body></html>' },
    });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/no <h1>/);
  });

  it("rejects /pricing when the prerendered document is not served", async () => {
    const { fetcher } = makeFetcher({
      "/pricing": { status: 200, body: '<html><body><div id="root"></div></body></html>' },
    });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/prerendered document is not being served/);
  });

  it("lets a plain vite preview opt out of the homepage structure check", async () => {
    // `vite preview` serves dist/ directly and applies no netlify.toml rules,
    // so the forced rewrite cannot fire there. The Staging Gate's local smoke
    // step runs exactly that, and must not fail on a rule it cannot exercise.
    const prev = process.env.SMOKE_SKIP_PRERENDER;
    process.env.SMOKE_SKIP_PRERENDER = "1";
    try {
      const { fetcher } = makeFetcher({
        "/": { status: 200, body: '<html><head><title>DatIQ</title></head><body><div id="root"></div></body></html>' },
      });
      const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
      expect(result.failed).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.SMOKE_SKIP_PRERENDER;
      else process.env.SMOKE_SKIP_PRERENDER = prev;
    }
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

  // ── The failure class the content-type guard exists to catch ────────────
  //
  // netlify.toml ends with `/* -> /index.html 200`. A file that is missing from
  // the deploy therefore returns the app shell at status 200. Every one of
  // these cases passes a status-only check and must fail a content-type check.

  it.each([
    ["/robots.txt", /robots\.txt/],
    ["/sitemap.xml", /sitemap\.xml/],
    ["/llms.txt", /llms\.txt/],
    ["/favicon.svg", /favicon\.svg/],
  ])("catches %s masked by the SPA catch-all (200 + text/html)", async (path, pattern) => {
    const { fetcher } = makeFetcher({ [path]: SPA_FALLBACK });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(pattern);
    expect(result.failures[0]).toMatch(/content-type/i);
  });

  it("catches a missing /api/stats function masked as the app shell", async () => {
    // The /api/* redirect fell through to the SPA: 200 + HTML. Status alone
    // reads as a healthy function.
    const { fetcher } = makeFetcher({ "/api/stats": SPA_FALLBACK });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatch(/api\/stats/);
    expect(result.failures[0]).toMatch(/content-type/i);
  });

  it("does not demand JSON from a 503 — only the forgeable 200 is checked", async () => {
    // A 503 comes from the platform, not the function, so its content-type is
    // not ours to predict. The catch-all cannot produce a 503, so nothing is
    // masked and nothing needs asserting.
    const { fetcher } = makeFetcher({
      "/api/stats": { status: 503, body: "Service Unavailable", contentType: "text/html" },
    });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(0);
  });

  it("accepts real-world content-type headers with charset parameters", async () => {
    const { fetcher } = makeFetcher({
      "/robots.txt": { status: 200, body: "User-agent: *", contentType: "text/plain; charset=UTF-8" },
      "/sitemap.xml": { status: 200, body: "<urlset/>", contentType: "text/xml; charset=UTF-8" },
      "/favicon.svg": { status: 200, body: "<svg/>", contentType: "image/svg+xml" },
    });
    const result = await runSmoke("https://x.test", { fetcher, logger: quiet });
    expect(result.failed).toBe(0);
  });

  it("a transport failure names its cause instead of a bare 'fetch failed'", async () => {
    const boom = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const fetcher = vi.fn().mockRejectedValue(boom);
    const result = await runSmoke("https://x.test", {
      fetcher, logger: quiet, retries: 1, sleep: () => Promise.resolve(),
    });
    expect(result.failed).toBeGreaterThan(0);
    // Every failure line must be diagnosable, not 10 identical opaque lines.
    expect(result.failures.every((f) => /ENOTFOUND/.test(f))).toBe(true);
  });

  it("retries transport failures across the whole run", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await runSmoke("https://x.test", {
      fetcher, logger: quiet, retries: 2, sleep: () => Promise.resolve(),
    });
    // 10 probes x 2 attempts each.
    expect(fetcher).toHaveBeenCalledTimes(20);
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
