// admin-provider-test.js — LIVE test one provider, or all of them.
//
//   GET  /api/admin-provider-test                 → every provider's status
//   POST /api/admin-provider-test {provider, model?} → test one
//
// Admin-token gated (lib/adminToken.js), because every call spends a real
// request against a real vendor account.
//
// ── WHY THIS ENDPOINT EXISTS ─────────────────────────────────────────────────
// DatIQ's admin console could show that a key was SET. It could not show that
// the key WORKED. In production all three AI keys were set and all three were
// dead — one invalid, two out of credit — and nothing in the product said so;
// the enrichment tabs just reported that customers' pages had no data on them.
//
// A "test" button that only re-reads an env var would have changed nothing.
// So every test here actually calls the vendor:
//   • AI providers   → a real completion, retried once with a larger budget if
//                      the model reasons past a small one (see pingProvider)
//   • Scrape         → a real scrape of a tiny, stable, public page
//   • PageSpeed      → a real API call for one URL
//
// Costs are trivial per click and the answer is the only one worth having.
// Nothing here ever returns a key, only a masked fingerprint.

import { verifyAdminToken, bearerFromEvent } from "./lib/adminToken.js";
import { pageSpeedKeyAdvice, isCredentialRejection, googleKeyKind } from "./lib/googleApiKey.js";
import { pingProvider, PROVIDER_ERROR_COPY, classifyProviderError } from "./lib/aiProviders.js";
import { SCRAPE_PROVIDERS } from "./lib/scrapeProviders.js";
import {
  PROVIDERS, PROVIDER_KEYS, PROVIDER_KIND, AI_PROVIDERS,
  SCRAPE_PROVIDERS_LIST, INTEL_PROVIDERS, FUNCTION_AREAS, FUNCTION_AREA_KEYS,
  areasForProvider, readKey, keyEnvNames, defaultModel,
} from "../../src/lib/providerRegistry.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};
const respond = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// A tiny, stable, permissively-crawlable page. example.com is the canonical
// choice: IANA-operated, no robots restrictions, ~1KB, and it will outlive us.
const SCRAPE_TEST_URL = "https://example.com";
const PAGESPEED_TEST_URL = "https://example.com";
// Matches the per-provider ceiling in scrapeProviders.js (TIMEOUT_MS). It was
// 15s, i.e. STRICTER than production — so a provider the extraction chain
// would happily have waited for could fail its own test, and the console said
// "the provider rejected the request" about a stopwatch we set ourselves.
// A verdict here has to mean what a verdict in the chain means.
const SCRAPE_TIMEOUT_MS = 20_000;

/** Never reveal a key — only enough to tell two keys apart in a screenshot. */
function fingerprint(key) {
  if (!key) return null;
  return key.length <= 8 ? `${key.slice(0, 2)}…` : `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
}

function keyInfo(providerKey) {
  const names = keyEnvNames(providerKey);
  const value = readKey(providerKey, process.env);
  return {
    envVars: names,
    // WHICH of the fallback vars actually supplied it — a value sitting in the
    // legacy VITE_ fallback while the operator edits the primary is a real
    // configuration trap.
    resolvedFrom: names.find((n) => process.env[n]) || null,
    present: Boolean(value),
    fingerprint: fingerprint(value),
    required: PROVIDERS[providerKey].requiresKey !== false && Boolean(names.length),
  };
}

async function testScrapeProvider(providerKey) {
  const p = SCRAPE_PROVIDERS[providerKey];
  if (!p) return { provider: providerKey, ok: false, code: "unknown_provider", error: "Unknown provider" };
  const apiKey = readKey(providerKey, process.env);
  if (p.requiresKey && !apiKey) {
    return { provider: providerKey, ok: false, code: "no_key", configured: false,
      error: `No key set (${PROVIDERS[providerKey].keyEnv}).` };
  }
  const startedAt = Date.now();
  try {
    const r = await p.scrape(SCRAPE_TEST_URL, { timeoutMs: SCRAPE_TIMEOUT_MS }, apiKey);
    const latencyMs = Date.now() - startedAt;
    if (r.ok && r.html) {
      return {
        provider: providerKey, ok: true, code: "ok", latencyMs, configured: true,
        detail: {
          testUrl: SCRAPE_TEST_URL,
          htmlBytes: r.html.length,
          returnedText: Boolean(r.text),
          title: (r.title || "").slice(0, 80),
        },
      };
    }
    const code = classifyProviderError(r);
    return {
      provider: providerKey, ok: false, latencyMs, configured: true,
      code, status: r.status,
      error: String(r.error || "empty result").slice(0, 200),
      // A timeout here is OUR deadline expiring, and the operator action is
      // nothing like the one for a rejected key — so say which it was.
      advice: code === "timeout"
        ? `${PROVIDERS[providerKey].label} did not answer within ${SCRAPE_TIMEOUT_MS / 1000}s. The key is not implicated: `
          + "check the provider's own status and rate limits, then retry — an uncached render can legitimately exceed this."
        : undefined,
    };
  } catch (err) {
    return {
      provider: providerKey, ok: false, configured: true,
      latencyMs: Date.now() - startedAt,
      code: err?.name === "AbortError" ? "timeout" : "network",
      error: String(err?.message || "fetch failed").slice(0, 200),
    };
  }
}

async function testPageSpeed() {
  const key = readKey("pagespeed", process.env);
  const psiUrl = (withKey) => {
    const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    url.searchParams.set("url", PAGESPEED_TEST_URL);
    url.searchParams.set("strategy", "mobile");
    if (withKey) url.searchParams.set("key", withKey);
    return url.toString();
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  const startedAt = Date.now();
  try {
    const res = await fetch(psiUrl(key), { signal: ctrl.signal });
    const latencyMs = Date.now() - startedAt;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      // Google answers a key of the wrong KIND with "API keys are not
      // supported by this API" — true, and read as a generic bad key it sends
      // the operator to reissue a credential that was never the right shape.
      // The remedy is a Cloud `AIza…` key, not a fresh AI Studio one.
      const advice = key ? pageSpeedKeyAdvice(key) : null;
      let note = "";
      if (key && isCredentialRejection(res.status, data)) {
        // Prove whether the SERVICE is fine, so the operator knows whether
        // audits are degraded or dead. Vitals fall back to keyless.
        const keyless = await fetch(psiUrl(null), { signal: ctrl.signal }).catch(() => null);
        if (keyless?.ok) {
          note = "PageSpeed itself is reachable — audits fall back to the keyless quota, so Core Web Vitals still measure, at a rate limit that fails under load.";
        } else if (keyless) {
          note = `PageSpeed answered ${keyless.status} without a key either, so Core Web Vitals will read "not measured".`;
        }
        // A thrown probe (our own 25s abort, a network blip) establishes
        // NOTHING about the keyless path, so it says nothing. Reporting an
        // unproven "it fails without a key too" is how a diagnosis becomes a
        // second wrong lead.
      }
      return {
        provider: "pagespeed", ok: false, latencyMs, configured: Boolean(key),
        code: classifyProviderError({ status: res.status, error: msg }),
        status: res.status, error: String(msg).slice(0, 200),
        keyKind: key ? googleKeyKind(key) : "none",
        advice: advice ? `${advice}${note ? ` ${note}` : ""}` : (note || undefined),
      };
    }
    const perf = data?.lighthouseResult?.categories?.performance?.score;
    return {
      provider: "pagespeed", ok: true, code: "ok", latencyMs, configured: Boolean(key),
      // Keyless works but is aggressively rate-limited — an operator seeing a
      // green tick should still know they are one busy hour from "not measured".
      note: key ? "" : "Working WITHOUT an API key — rate-limited. Set PAGESPEED_API_KEY before relying on Core Web Vitals.",
      detail: { testUrl: PAGESPEED_TEST_URL, performanceScore: typeof perf === "number" ? Math.round(perf * 100) : null },
    };
  } catch (err) {
    return {
      provider: "pagespeed", ok: false, configured: Boolean(key),
      latencyMs: Date.now() - startedAt,
      code: err?.name === "AbortError" ? "timeout" : "network",
      error: String(err?.message || "fetch failed").slice(0, 200),
    };
  } finally {
    clearTimeout(t);
  }
}

/** Route one provider to the right live test for its kind. */
export async function testProvider(providerKey, opts = {}) {
  const meta = PROVIDERS[providerKey];
  if (!meta) return { provider: providerKey, ok: false, code: "unknown_provider", error: "Unknown provider" };
  let result;
  if (meta.kind === PROVIDER_KIND.AI)          result = await pingProvider(providerKey, { model: opts.model });
  else if (meta.kind === PROVIDER_KIND.SCRAPE) result = await testScrapeProvider(providerKey);
  else                                          result = await testPageSpeed();
  return {
    ...result,
    kind: meta.kind,
    label: meta.label,
    // `advice` is the remedy a test established for CERTAIN; the code copy is
    // the generic fallback. Preferring the generic line is how "reissue the
    // key and update the env var" got shown for a key whose only problem was
    // being the wrong KIND of key.
    hint: result.ok
      ? (result.note || PROVIDER_ERROR_COPY.ok)
      : (result.advice || PROVIDER_ERROR_COPY[result.code] || result.error),
    // What breaks if this provider is down — the question a status page should
    // answer and almost never does.
    areas: areasForProvider(providerKey).map((a) => ({ key: a, label: FUNCTION_AREAS[a].label })),
    apiKey: keyInfo(providerKey),
    testedAt: new Date().toISOString(),
  };
}

/** The full catalogue with key presence, defaults and area mapping — no tests run. */
export function buildCatalogue() {
  const providers = PROVIDER_KEYS.map((k) => {
    const meta = PROVIDERS[k];
    return {
      key: k,
      kind: meta.kind,
      label: meta.label,
      docsUrl: meta.docsUrl || null,
      capabilities: meta.capabilities || null,
      structured: meta.structured === true,
      requiresKey: meta.requiresKey !== false && Boolean(meta.keyEnv),
      models: meta.models
        ? {
            catalogue: meta.models.catalogue,
            defaultFast: defaultModel(k, "fast", process.env),
            defaultDeep: defaultModel(k, "deep", process.env),
          }
        : null,
      apiKey: keyInfo(k),
      areas: areasForProvider(k),
    };
  });
  return {
    providers,
    groups: {
      ai: AI_PROVIDERS,
      scrape: SCRAPE_PROVIDERS_LIST,
      intel: INTEL_PROVIDERS,
    },
    areas: FUNCTION_AREA_KEYS.map((k) => ({ key: k, ...FUNCTION_AREAS[k] })),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const auth = verifyAdminToken(bearerFromEvent(event));
  if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });

  if (event.httpMethod === "GET") {
    return respond(200, { ok: true, demo: auth.demo, ...buildCatalogue() });
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

    // Test everything. Run in parallel — an operator clicking "Test all" is
    // diagnosing an outage and should not wait out a serial walk of nine
    // providers, several of which may be timing out.
    if (body.all === true) {
      const keys = Array.isArray(body.providers) && body.providers.length
        ? body.providers.filter((k) => PROVIDERS[k])
        : PROVIDER_KEYS;
      const results = await Promise.all(keys.map((k) => testProvider(k)));
      return respond(200, { ok: true, demo: auth.demo, results });
    }

    const provider = String(body.provider || "");
    if (!PROVIDERS[provider]) return respond(400, { ok: false, error: "Unknown provider" });
    // A typed model id is tested as given — that is the point of the field:
    // finding out whether a model works BEFORE saving it as the default.
    const model = typeof body.model === "string" && body.model.trim()
      ? body.model.trim().slice(0, 120) : undefined;
    const result = await testProvider(provider, { model });
    return respond(200, { ok: true, demo: auth.demo, result });
  }

  return respond(405, { ok: false, error: "Method not allowed" });
};
