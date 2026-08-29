// webVitals.js — Core Web Vitals via the PageSpeed Insights API.
//
// ── WHY AN EXTERNAL CALL ───────────────────────────────────────────────────
// LCP, INP and CLS cannot be computed from HTML. They need either a real
// browser running Lighthouse or Chrome's field dataset, and a Netlify function
// with a ten-second budget and no Chrome binary can do neither. PageSpeed
// Insights exposes both: CrUX field data from real Chrome users, plus a lab
// Lighthouse run. It works without an API key at low volume; PAGESPEED_API_KEY
// raises the quota.
//
// ── FIELD DATA BEATS LAB DATA ──────────────────────────────────────────────
// Where CrUX has data for the URL we use it, because it is what real users on
// real devices experienced. Lab data is a single synthetic run from one
// datacentre and systematically flatters well-connected origins. Lab is the
// fallback, and the source is recorded on the result so a report never presents
// one as the other.
//
// ── FAILURE IS ALWAYS `null`, NEVER A SCORE ────────────────────────────────
// Rate limits, timeouts, URLs with no field data, PSI outages: all return null.
// The signal then drops out of the Technical pillar and its 30% redistributes.
// Returning a low score on a failed lookup would subtract ~7.5 points from
// every audit during an outage and then show a phantom "+7.5 improvement" when
// service resumed — inventing the trend the validation loop exists to measure.

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Hard ceiling on how long we will wait.
 *
 * PSI regularly takes 20-30 seconds for a cold lab run, which is longer than
 * the whole audit's budget. Twelve seconds is enough to get a cached field-data
 * response — the one we actually prefer — and short enough that a slow lab run
 * degrades to "not measured" instead of taking the audit down with it.
 */
export const PSI_TIMEOUT_MS = 12_000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CrUX field metrics → our units (LCP seconds, INP ms, CLS unitless). */
export function parseFieldMetrics(loadingExperience) {
  const m = loadingExperience?.metrics;
  if (!m) return null;
  const lcpMs = num(m.LARGEST_CONTENTFUL_PAINT_MS?.percentile);
  const inpMs = num(m.INTERACTION_TO_NEXT_PAINT?.percentile);
  // CrUX reports CLS multiplied by 100 so it can be an integer.
  const clsRaw = num(m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  const ttfb = num(m.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile);

  if (lcpMs === null && inpMs === null && clsRaw === null) return null;
  return {
    lcp: lcpMs === null ? null : Math.round((lcpMs / 1000) * 100) / 100,
    inp: inpMs,
    cls: clsRaw === null ? null : Math.round((clsRaw / 100) * 1000) / 1000,
    ttfb,
    source: "field",
  };
}

/** Lighthouse lab audits → the same units. */
export function parseLabMetrics(lighthouseResult) {
  const a = lighthouseResult?.audits;
  if (!a) return null;
  const lcpMs = num(a["largest-contentful-paint"]?.numericValue);
  const cls = num(a["cumulative-layout-shift"]?.numericValue);
  // Lighthouse cannot measure INP without real interaction; TBT is its proxy
  // and is NOT the same metric, so we report it separately rather than
  // presenting it as INP. Claiming a measured INP we did not measure would be
  // exactly the invented-number problem the whole engine avoids.
  const tbt = num(a["total-blocking-time"]?.numericValue);
  const ttfb = num(a["server-response-time"]?.numericValue);

  if (lcpMs === null && cls === null) return null;
  return {
    lcp: lcpMs === null ? null : Math.round((lcpMs / 1000) * 100) / 100,
    inp: null,
    cls: cls === null ? null : Math.round(cls * 1000) / 1000,
    ttfb,
    totalBlockingTimeMs: tbt,
    source: "lab",
  };
}

/**
 * Fetch Core Web Vitals for one URL.
 *
 * @param {string} url
 * @param {object} opts
 * @param {"mobile"|"desktop"} [opts.strategy]
 * @param {typeof fetch} [opts.fetchImpl]  injected in tests
 * @returns {Promise<{lcp,inp,cls,ttfb,source}|null>} null on any failure
 */
export async function fetchWebVitals(url, opts = {}) {
  const env = opts.env || process.env;
  const strategy = opts.strategy === "desktop" ? "desktop" : "mobile";
  const fetchImpl = opts.fetchImpl || fetch;

  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const key = env.PAGESPEED_API_KEY || env.GOOGLE_PAGESPEED_KEY;
  if (key) params.set("key", key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || PSI_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${PSI_ENDPOINT}?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { error: `PageSpeed returned ${res.status}`, unavailable: true };
    }
    const data = await res.json();

    // Field data first: real users beat one synthetic run from a datacentre.
    const field = parseFieldMetrics(data.loadingExperience)
      || parseFieldMetrics(data.originLoadingExperience);
    if (field) return field;

    const lab = parseLabMetrics(data.lighthouseResult);
    if (lab) return lab;

    return { error: "PageSpeed returned no usable metrics", unavailable: true };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err?.name === "AbortError";
    return {
      error: aborted ? `PageSpeed timed out after ${opts.timeoutMs || PSI_TIMEOUT_MS}ms` : (err?.message || "PageSpeed request failed"),
      unavailable: true,
    };
  }
}

/** Is a Core Web Vitals lookup even possible in this environment? */
export function webVitalsAvailable(env = process.env) {
  // PSI works keyless at low volume, so this is only false when explicitly
  // disabled — an operator switch for air-gapped or cost-controlled deploys.
  return env.DISABLE_PAGESPEED !== "1";
}
