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
//   SMOKE_TIMEOUT_MS   — per-request timeout in ms (default 15000)
//
// Probes (kept small so a full run is < 30s even on a cold CDN):
//   1. SPA routes     — /, /dashboard, /pricing, /batch return 200 and the
//                       root contains "DatIQ" / "Extract" (rules out a
//                       generic 502/404 page from the SPA fallback)
//   2. Marketing       — /favicon.svg, /robots.txt, /sitemap.xml, /llms.txt
//                       (GEO/SEO assets; missing = discoverability regression)
//   3. Help site       — /help/index.html (static; missing = docs regression)
//   4. API function    — /api/stats returns 200 OR 503 (the function is
//                       allowed to be down when Supabase isn't configured;
//                       we just need it to ANSWER, not hang)
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

export async function fetchWithTimeout(url, init = {}, timeoutMs = 15000, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the smoke probes against `baseUrl`.
 * @param {string} baseUrl
 * @param {{ adminPin?: string, timeoutMs?: number, fetcher?: typeof fetch, logger?: { log: Function, error: Function } }} [opts]
 * @returns {Promise<{ passed: number, failed: number, failures: string[] }>}
 */
export async function runSmoke(baseUrl, opts = {}) {
  const ADMIN_PIN = opts.adminPin ?? "";
  const TIMEOUT_MS = opts.timeoutMs ?? 15000;
  const _fetch = opts.fetcher ?? fetch;
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

  const get = (path) =>
    fetchWithTimeout(new URL(path, baseUrl).toString(), {}, TIMEOUT_MS, _fetch);
  const postJson = (path, body) =>
    fetchWithTimeout(
      new URL(path, baseUrl).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      TIMEOUT_MS,
      _fetch
    );

  log(`\n[smoke] ${baseUrl}  (timeout ${TIMEOUT_MS}ms / probe)\n`);

  // 1. SPA routes ──────────────────────────────────────────────────────────
  await probe("GET / (home contains brand)", async () => {
    const res = await get("/");
    assertOk(res, "GET /");
    const body = await res.text();
    if (!/DatIQ|Extract/i.test(body)) {
      throw new Error('home body missing "DatIQ" or "Extract" — likely a 502/404 page from SPA fallback');
    }
  });

  await probe("GET /dashboard (SPA fallback)", async () => {
    assertOk(await get("/dashboard"), "GET /dashboard");
  });

  await probe("GET /pricing (SPA fallback)", async () => {
    assertOk(await get("/pricing"), "GET /pricing");
  });

  await probe("GET /batch (SPA fallback)", async () => {
    assertOk(await get("/batch"), "GET /batch");
  });

  // 2. Marketing/SEO assets ───────────────────────────────────────────────
  await probe("GET /favicon.svg", async () => {
    assertOk(await get("/favicon.svg"), "GET /favicon.svg");
  });

  await probe("GET /robots.txt", async () => {
    assertOk(await get("/robots.txt"), "GET /robots.txt");
  });

  await probe("GET /sitemap.xml", async () => {
    assertOk(await get("/sitemap.xml"), "GET /sitemap.xml");
  });

  await probe("GET /llms.txt (AI agent discovery)", async () => {
    assertOk(await get("/llms.txt"), "GET /llms.txt");
  });

  // 3. Help site ──────────────────────────────────────────────────────────
  await probe("GET /help/index.html", async () => {
    assertOk(await get("/help/index.html"), "GET /help/index.html");
  });

  // 4. API function (200 OR 503 acceptable) ──────────────────────────────
  await probe("GET /api/stats (200 or 503)", async () => {
    const res = await get("/api/stats");
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`HTTP ${res.status} — expected 200 (Supabase configured) or 503 (not configured)`);
    }
  });

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
  if (!BASE) {
    err("Usage: node scripts/smoke-prod.mjs <base-url>");
    err("  e.g. node scripts/smoke-prod.mjs https://datiq.app");
    process.exit(2);
  }

  const result = await runSmoke(BASE, {
    adminPin: process.env.SMOKE_ADMIN_PIN || "",
    timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS) || 15000,
  });

  process.exit(result.failed > 0 ? 1 : 0);
}
