// netlify/functions/lib/proxyConfig.js — F36 (light anti-bot: proxy rotation).
//
// Council intent: "~40% of target pages are JS-heavy or bot-protected;
// existential dependency for batch-at-scale, monitoring GA and API
// credibility."
//
// Scope (LIGHT, per user): rotate through a list of proxy URLs (env var)
// without shipping a Playwright binary. Real JS-rendering continues to
// come from the upstream providers (Firecrawl / Spider) which already
// have headless support.
//
// Env:
//   PROXY_URLS — comma-separated list of http:// or https:// proxies
//                (e.g. "http://user:pass@proxy1:8080,http://proxy2:8080")
//   PROXY_STRATEGY — "round-robin" (default) | "random"
//
// Light implementation. Returns a single URL per request via the chosen
// strategy. If no proxy is configured, returns null (callers fall through
// to a direct connection).

let counter = 0;

export function resetProxyCounterForTests() {
  counter = 0;
}

function parseProxies(envValue) {
  if (!envValue) return [];
  return String(envValue)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    // Basic URL sanity: must start with http:// or https://
    .filter((s) => /^https?:\/\//i.test(s));
}

export function loadProxyPool(env = process.env) {
  return {
    proxies: parseProxies(env.PROXY_URLS || ""),
    strategy: (env.PROXY_STRATEGY || "round-robin").toLowerCase(),
  };
}

/**
 * Pick a proxy URL for this request. Returns null if no proxies are
 * configured (caller falls through to direct).
 */
export function pickProxy(env = process.env) {
  const { proxies, strategy } = loadProxyPool(env);
  if (proxies.length === 0) return null;
  if (strategy === "random") {
    return proxies[Math.floor(Math.random() * proxies.length)];
  }
  // Default: round-robin.
  const idx = counter % proxies.length;
  counter = (counter + 1) >>> 0;
  return proxies[idx];
}

/**
 * Build a fetch() options object that routes through the picked proxy
 * (via the undici `dispatcher` hook, which Netlify Functions support).
 *
 * NOTE: Netlify Functions' runtime is AWS Lambda (Node 18+). To actually
 * route through a proxy in a serverless function, the cleanest path is
 * to use undici's `ProxyAgent` dispatcher. The caller can do:
 *
 *   const { dispatcher } = buildProxyDispatcher(pickProxy());
 *   await fetch(url, { dispatcher });
 *
 * This function returns the dispatcher. Returns undefined when no proxy
 * is configured (caller passes nothing to fetch).
 */
export function buildProxyDispatcher(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    // dynamic require — undici ships with Node 18+ but we keep it lazy
    // so the function cold start doesn't pay for it.
    // eslint-disable-next-line global-require
    const undici = require("undici");
    return new undici.ProxyAgent({ uri: proxyUrl });
  } catch (err) {
    console.warn("[DatIQ] undici ProxyAgent not available:", err.message);
    return undefined;
  }
}

export const _internal = { parseProxies };
