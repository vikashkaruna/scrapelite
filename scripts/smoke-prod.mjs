#!/usr/bin/env node
// scripts/smoke-prod.mjs — post-deploy smoke check (CI + local)
//
// Lightweight HTTP probes against a deployed DatIQ environment. Catches the
// "deploy succeeded but site is broken" failure mode that the Netlify build
// log alone misses. Exits non-zero on any failure so the phase-gate
// workflow can block the production deploy.
//
// Usage:
//   node scripts/smoke-prod.mjs https://staging.datiq.app
//   SMOKE_ADMIN_PIN=... node scripts/smoke-prod.mjs https://datiq.app
//
// Optional env:
//   SMOKE_ADMIN_PIN    — when set, runs the admin-auth probe with this PIN.
//                         In CI this is the per-environment secret
//                         (STAGING_ADMIN_PIN / PRODUCTION_ADMIN_PIN).
//   SMOKE_SKIP_API     — when "1", skips the /api/stats probe. Set this when
//                         `baseUrl` is a bare static server (e.g. `vite
//                         preview`) with no Netlify Functions runtime behind
//                         it — without a real function, the SPA catch-all
//                         would answer /api/stats with an HTML 200 and the
//                         probe would fail on content-type for a reason
//                         that has nothing to do with the deploy being
//                         verified. See "static-only verification" in
//                         .github/workflows/staging-gate.yml.
//   SMOKE_TIMEOUT_MS   — per-request timeout in ms (default 15000)
//   SMOKE_RETRIES      — attempts per probe on TRANSPORT failure (default 3).
//                         HTTP responses are never retried — only requests that
//                         never completed (cold CDN, deploy propagating, DNS blip).
//
// Probes (kept small so a full run is < 30s even on a cold CDN):
//   1. SPA routes     — /, /dashboard, /pricing, /batch return 200 and the
//                       root contains "DatIQ" / "Extract" (rules out a
//                       generic 502/404 page from the SPA fallback)
//   2. Marketing       — /favicon.svg, /robots.txt, /sitemap.xml, /llms.txt
//                       (GEO/SEO assets; missing = discoverability regression).
//                       Status AND content-type are asserted — see
//                       assertContentType for why status alone is not enough.
//   3. Help site       — /help/index.html (static; missing = docs regression)
//   4. API function    — /api/stats returns 200 OR 503 (the function is
//                       allowed to be down when Supabase isn't configured;
//                       we just need it to ANSWER, not hang) and must answer
//                       in JSON, not the SPA's HTML
//   5. Admin (opt-in)  — /admin returns 200; admin-auth function returns
//                       200 with a token when SMOKE_ADMIN_PIN is set
//
// Doesn't probe auth, extractions, or any user-data path — those are
// exercised by the Playwright e2e suite against a local dev server.

import { pathToFileURL } from "node:url";

// ─── Core (exported, testable) ───────────────────────────────────────────

export function assertOk(res, label) {
  if (res.status < 200 || res.status >= 400) {
    throw new Error(`${label || "request"} returned HTTP ${res.status} ${res.statusText || ""}`.trim());
  }
}

/**
 * Assert the response Content-Type contains `expected` (case-insensitive
 * substring, e.g. "application/json", "image/svg", "xml").
 *
 * WHY THIS EXISTS: netlify.toml ends with an SPA catch-all, `/* → /index.html`
 * at status 200. That means a MISSING /robots.txt, /sitemap.xml, /llms.txt, or
 * /api/stats does not 404 — it silently serves the app's HTML with a 200, and
 * a status-only smoke check passes on a deploy where those are genuinely gone.
 * Requiring the content-type is what unmasks that class of failure.
 */
export function assertContentType(res, expected, label) {
  const actual = (res.headers?.get?.("content-type") || "").toLowerCase();
  if (!actual.includes(String(expected).toLowerCase())) {
    throw new Error(
      `${label || "request"} returned content-type "${actual || "(none)"}" — expected "${expected}". ` +
      `A 200 with text/html here usually means the SPA catch-all served index.html because the file is missing.`
    );
  }
}

/**
 * Turn undici's opaque "fetch failed" into something diagnosable.
 *
 * Node's fetch reports every transport failure as the same TypeError — the real
 * reason (ENOTFOUND, ECONNREFUSED, ECONNRESET, a TLS code, UND_ERR_CONNECT_TIMEOUT)
 * is hidden on `err.cause`. Without digging it out, a wrong hostname, a dead
 * origin, a DNS outage, and a TLS failure all print the identical line, and a
 * red gate tells you nothing about which one you're looking at.
 */
export function describeFetchError(err) {
  const cause = err?.cause ?? {};
  const code = cause.code || cause.errno;
  const base = err?.message || "request failed";
  if (code) return `${base} (${code})`;
  if (cause.message && cause.message !== base) return `${base} (${cause.message})`;
  return base;
}

/** Single attempt. Throws a timeout message on abort, an enriched error otherwise. */
export async function fetchWithTimeout(url, init = {}, timeoutMs = 15000, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw new Error(describeFetchError(err), { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchWithTimeout with retries for TRANSPORT failures only.
 *
 * `fetch` resolves for every HTTP status, so it only throws when the request
 * never completed — exactly the class worth retrying (cold CDN, a deploy still
 * propagating, a transient DNS blip). An assertion failure on a response that
 * DID arrive is never retried: a wrong content-type or a 500 is a real result,
 * and re-running it would just slow the gate down before failing anyway.
 */
export async function fetchWithRetry(url, init = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const retries = Math.max(1, opts.retries ?? 3);
  const backoffMs = opts.backoffMs ?? 1000;
  const fetcher = opts.fetcher ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs, fetcher);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffMs * attempt);
    }
  }
  throw new Error(`${lastErr?.message || "request failed"} (after ${retries} attempts)`, {
    cause: lastErr,
  });
}

/**
 * Run the smoke probes against `baseUrl`.
 * @param {string} baseUrl
 * @param {{ adminPin?: string, timeoutMs?: number, fetcher?: typeof fetch, logger?: { log: Function, error: Function } }} [opts]
 * @returns {Promise<{ passed: number, failed: number, failures: string[] }>}
 */
export async function runSmoke(baseUrl, opts = {}) {
  const ADMIN_PIN = opts.adminPin ?? "";
  const SKIP_API = opts.skipApi ?? false;
  const TIMEOUT_MS = opts.timeoutMs ?? 15000;
  const RETRIES = opts.retries ?? 3;
  const BACKOFF_MS = opts.backoffMs ?? 1000;
  const _fetch = opts.fetcher ?? fetch;
  const _sleep = opts.sleep;
  const log = opts.logger?.log ?? console.log.bind(console);
  const err = opts.logger?.error ?? console.error.bind(console);

  let passed = 0;
  let failed = 0;
  const failures = [];

  async function probe(name, fn) {
    process.stdout.write(`  ${name} ... `);
    try {
      await fn();
      process.stdout.write("✓\n");
      passed += 1;
    } catch (e) {
      process.stdout.write("✗\n");
      err(`    ${e.message}`);
      failures.push(`${name}: ${e.message}`);
      failed += 1;
    }
  }

  const retryOpts = {
    timeoutMs: TIMEOUT_MS,
    retries: RETRIES,
    backoffMs: BACKOFF_MS,
    fetcher: _fetch,
    ...(_sleep ? { sleep: _sleep } : {}),
  };
  const get = (path) =>
    fetchWithRetry(new URL(path, baseUrl).toString(), {}, retryOpts);
  const postJson = (path, body) =>
    fetchWithRetry(
      new URL(path, baseUrl).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      retryOpts
    );

  log(`\n[smoke] ${baseUrl}  (timeout ${TIMEOUT_MS}ms / probe)\n`);

  // 1. SPA routes ──────────────────────────────────────────────────────────
  await probe("GET / (home serves rendered content, not the shell)", async () => {
    const res = await get("/");
    assertOk(res, "GET /");
    const body = await res.text();
    if (!/DatIQ|Extract/i.test(body)) {
      throw new Error('home body missing "DatIQ" or "Extract" — likely a 502/404 page from SPA fallback');
    }
    // The homepage is prerendered to public/home/index.html and served at `/`
    // by a FORCED rewrite in netlify.toml. Without the force, dist/index.html —
    // a real file — wins and the bare shell is served instead, with no error
    // anywhere. The brand check above cannot see that: the shell's <title> and
    // meta contain "DatIQ" too. Only rendered structure separates the two.
    //
    // SMOKE_SKIP_PRERENDER=1 for a plain `vite preview`, which serves dist/
    // directly and applies no netlify.toml rules.
    if (process.env.SMOKE_SKIP_PRERENDER !== "1" && !/<h1[\s>]/i.test(body)) {
      throw new Error("/ served no <h1> — the prerendered homepage is not being served (forced rewrite missing?)");
    }
  });

  await probe("GET /dashboard (SPA fallback)", async () => {
    assertOk(await get("/dashboard"), "GET /dashboard");
  });

  await probe("GET /pricing (prerendered document, not the bare shell)", async () => {
    const res = await get("/pricing");
    assertOk(res, "GET /pricing");
    const body = await res.text();
    // ⚠️ This used to assert only a 200, which the SPA fallback satisfies with
    // an empty shell. So NOTHING in the whole CI chain would have noticed if
    // the prerendered pages stopped being served and every marketing route
    // silently degraded to `<div id="root"></div>` for crawlers.
    if (!/<h1[\s>]/i.test(body)) {
      throw new Error("/pricing served no <h1> — the prerendered document is not being served (bare SPA shell?)");
    }
  });

  await probe("GET /batch (SPA fallback)", async () => {
    assertOk(await get("/batch"), "GET /batch");
  });

  // 2. Marketing/SEO assets ───────────────────────────────────────────────
  // Each asserts its content-type as well as its status — see assertContentType:
  // without it the SPA catch-all serves index.html at 200 for a missing file
  // and the probe passes on a broken deploy.
  await probe("GET /favicon.svg (image/svg)", async () => {
    const res = await get("/favicon.svg");
    assertOk(res, "GET /favicon.svg");
    assertContentType(res, "image/svg", "GET /favicon.svg");
  });

  await probe("GET /robots.txt (text/plain)", async () => {
    const res = await get("/robots.txt");
    assertOk(res, "GET /robots.txt");
    assertContentType(res, "text/plain", "GET /robots.txt");
  });

  await probe("GET /sitemap.xml (xml)", async () => {
    const res = await get("/sitemap.xml");
    assertOk(res, "GET /sitemap.xml");
    assertContentType(res, "xml", "GET /sitemap.xml");
  });

  await probe("GET /llms.txt (AI agent discovery, text/plain)", async () => {
    const res = await get("/llms.txt");
    assertOk(res, "GET /llms.txt");
    assertContentType(res, "text/plain", "GET /llms.txt");
  });

  // 3. Help site ──────────────────────────────────────────────────────────
  await probe("GET /help/index.html", async () => {
    assertOk(await get("/help/index.html"), "GET /help/index.html");
  });

  // 4. API function (200 OR 503 acceptable) ──────────────────────────────
  if (!SKIP_API) {
    await probe("GET /api/stats (200 or 503, JSON)", async () => {
      const res = await get("/api/stats");
      if (res.status !== 200 && res.status !== 503) {
        throw new Error(`HTTP ${res.status} — expected 200 (Supabase configured) or 503 (not configured)`);
      }
      // The most valuable content-type assertion of the set: if the function
      // failed to deploy, the /api/* redirect falls through to the SPA and this
      // returns the app's HTML at 200 — indistinguishable from success on status.
      //
      // Only checked on 200. The catch-all can only forge a 200, so that is the
      // sole maskable case; a 503 comes from the platform (the function is gone
      // or crashed) and its content-type is not ours to predict. All we require
      // there is that something answered.
      if (res.status === 200) {
        assertContentType(res, "application/json", "GET /api/stats");
      }
    });
  } else {
    log("  (skipping /api/stats — SMOKE_SKIP_API set, no Functions runtime behind this host)\n");
  }

  // 5. Admin (only when SMOKE_ADMIN_PIN is set) ───────────────────────────
  if (ADMIN_PIN) {
    await probe("GET /admin (SPA fallback)", async () => {
      assertOk(await get("/admin"), "GET /admin");
    });

    await probe("POST /.netlify/functions/admin-auth", async () => {
      const res = await postJson("/.netlify/functions/admin-auth", { pin: ADMIN_PIN });
      if (res.status !== 200) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText || ""} — ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok || !data.token) {
        throw new Error(`no token in response: ${JSON.stringify(data).slice(0, 200)}`);
      }
    });
  } else {
    log("  (skipping admin probes — SMOKE_ADMIN_PIN not set)\n");
  }

  log(`\n[smoke] ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    err("Failures:");
    for (const f of failures) err(`  - ${f}`);
  }

  return { passed, failed, failures };
}

// ─── CLI entry point ──────────────────────────────────────────────────────
// Only run when this file is the main module, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const BASE = process.argv[2];
  // Fail fast with a readable message. Without this, a relative or malformed
  // base surfaces later as an opaque `new URL()` TypeError on the first probe.
  if (BASE && !/^https?:\/\//i.test(BASE)) {
    console.error(`Base URL must be absolute (http:// or https://) — got: ${BASE}`);
    console.error("  e.g. node scripts/smoke-prod.mjs https://datiq.app");
    process.exit(2);
  }
  if (!BASE) {
    // console.error, not `err` — that binding is scoped inside runSmoke, so
    // referencing it here threw a ReferenceError instead of printing usage.
    console.error("Usage: node scripts/smoke-prod.mjs <base-url>");
    console.error("  e.g. node scripts/smoke-prod.mjs https://datiq.app");
    process.exit(2);
  }

  const result = await runSmoke(BASE, {
    adminPin: process.env.SMOKE_ADMIN_PIN || "",
    skipApi: process.env.SMOKE_SKIP_API === "1",
    timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS) || 15000,
    retries: Number(process.env.SMOKE_RETRIES) || 3,
  });

  process.exit(result.failed > 0 ? 1 : 0);
}
