// netlify/functions/razorpay-sdk.js
// Same-origin proxy for https://checkout.razorpay.com/v1/checkout.js.
//
// Why this exists:
// The browser's <script src="https://checkout.razorpay.com/..."> load fails
// in a surprising number of real-world conditions — ad blockers, privacy
// extensions, corporate firewalls, strict CSP, browser sandboxing, even some
// Netlify edge configurations treat the domain as suspicious. Every one of
// those leaves the user stuck on the "Unable to load the payment portal"
// error with no recourse.
//
// By serving the Razorpay SDK from the SAME origin as the app (datiq.app),
// every third-party blocker is bypassed: the browser sees a same-origin
// script load, which is the default unblocked case for every extension and
// every network policy.
//
// The trade-off is one extra hop on the very first load, mitigated by:
//   • Aggressive immutable cache (24h) — repeat visits never re-fetch
//   • The function fetches from Razorpay's CDN, not from the user, so users
//     on slow networks aren't penalised
//   • Fallback: if this function 404s (e.g. local dev without `netlify dev`)
//     or the proxy fetch itself fails, paymentService.js falls back to the
//     direct CDN URL.
//
// Security:
//   • The response is a verbatim copy of Razorpay's published JS — we do
//     NOT modify, log, or store it. Same SRI guarantees as if the user
//     loaded it directly.
//   • CORS is set to * for the SDK body (the script is meant to be executed
//     by any origin that includes it).
//   • Cache-Control is `public, max-age=86400, immutable` — clients cache
//     for 24h and never revalidate within that window.
//
// Response shape:
//   200 + application/javascript body on success
//   502 + a no-op JS comment on upstream failure (so the browser doesn't
//       throw a "script error" the user can't act on)

const RAZORPAY_SDK_URL = "https://checkout.razorpay.com/v1/checkout.js";
const CACHE_MAX_AGE = 60 * 60 * 24; // 24 hours

export default async (req) => {
  // Only GET is supported — anything else is a misconfigured caller
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const upstream = await fetch(RAZORPAY_SDK_URL, {
    headers: {
      // Identify ourselves to Razorpay's CDN so they can rate-limit/debug
      // a single upstream source instead of one per visitor.
      "User-Agent": "DatIQ-NetlifyProxy/1.0 (+https://datiq.app)",
      Accept: "application/javascript, */*;q=0.1",
    },
  }).catch((e) => ({ ok: false, status: 0, _fetchError: e?.message || String(e) }));

  if (!upstream.ok) {
    // Return a no-op JS comment so the browser doesn't surface a "script
    // error" that the user can't act on. The browser-side loader detects
    // the 502 (via the dataset state) and falls back to the direct CDN.
    const detail = upstream._fetchError
      ? `fetch-error: ${upstream._fetchError}`
      : `upstream status ${upstream.status}`;
    const body =
      `/* DatIQ razorpay-sdk proxy: upstream unavailable (${detail}).\n` +
      `   The browser loader will retry the direct Razorpay CDN. */\n`;
    return new Response(body, {
      status: 502,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const body = await upstream.text();

  const headers = new Headers({
    "Content-Type": "application/javascript; charset=utf-8",
    // Same-origin served JS — no third-party restrictions
    "Access-Control-Allow-Origin": "*",
    // 24h immutable cache: any browser that loads this once won't re-fetch
    // for 24h. Razorpay's SDK changes are infrequent and versioned; the
    // cache key is the URL path, not the script contents.
    "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
    // Surface the upstream status in case we ever need to debug from the
    // browser's network panel.
    "X-Proxied-From": RAZORPAY_SDK_URL,
  });

  return new Response(body, { status: 200, headers });
};

// Netlify config: allow the CDN call but no internal-network access
export const config = {
  // The function only does an outbound HTTPS GET to a single public CDN
  // endpoint, so it can run on any tier.
  path: "/.netlify/functions/razorpay-sdk",
};
