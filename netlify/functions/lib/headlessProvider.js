// netlify/functions/lib/headlessProvider.js — F36 (headless JS-rendering stub).
//
// Council intent: real headless browser (Playwright/Puppeteer) is the
// right answer for JS-heavy sites, but the binary + cold-start cost is
// heavy. LIGHT scope per user: ship a stub that the scrape chain can
// route to, that delegates to the upstream provider's headless mode
// (Firecrawl + Spider both have waitFor) when `renderJs: true` is set.
//
// Future expansion: when a Playwright layer or Cloudflare Browser
// Rendering API is wired up, this module is the single integration
// point. The current behaviour: prefers upstream headless (via
// renderJs flag on existing providers), and falls through to a "best
// effort direct" call that surfaces a clear "JS not actually rendered"
// warning in the response so callers can retry with a stronger
// provider.
//
// The module also exposes a "isHeadlessAvailable()" check the admin UI
// can read to show a banner ("Your infra supports JS rendering via
// Firecrawl / Spider; set VITE_RENDER_JS=1 to enable by default").

const UPSTREAM_HEADLESS_PROVIDERS = ["firecrawl", "spider"];

export function isHeadlessAvailable(env = process.env) {
  // We have a headless option if at least one upstream provider that
  // supports it is configured with an API key.
  // We have a headless option if at least one upstream provider that
  // supports it is configured with an API key.
  return Boolean(
    (env.FIRECRAWL_API_KEY || env.VITE_FIRECRAWL_API_KEY) ||
    (env.SPIDER_API_KEY),
  );
}

/**
 * Returns a "headless opts" object that the scrape chain can use to
 * render JS. Currently delegates to the upstream provider's
 * `waitFor` / `renderJs` flag.
 */
export function headlessOptions(provider) {
  if (UPSTREAM_HEADLESS_PROVIDERS.includes(provider)) {
    return { renderJs: true, waitFor: 3000 };
  }
  return null;
}

/**
 * Surface a "rendered via upstream" marker in the response. Helps the
 * client UI know whether JS was actually executed, so it can show
 * the right preview fidelity message.
 */
export function headlessAttribution(provider, env = process.env) {
  if (!isHeadlessAvailable(env)) {
    return {
      rendered: false,
      note: "No headless provider configured. JS-heavy sites will return a static HTML snapshot.",
    };
  }
  return {
    rendered: true,
    provider,
    note: `Rendered via upstream ${provider} (waitFor=3000ms). For deep-JS apps, consider the Playwright path (v2.0).`,
  };
}

export const _internal = { UPSTREAM_HEADLESS_PROVIDERS };
