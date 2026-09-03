// webVitals.test.js — the PageSpeed lookup had NO tests, which is how a
// misconfigured key came to be worse than no key at all.
//
// PSI works unauthenticated at low volume. So an EMPTY PAGESPEED_API_KEY
// degrades to a rate limit, while a WRONG one failed every lookup — LCP, INP
// and CLS read "not measured" on every audit, the Technical pillar silently
// redistributed 30% of its weight, and nothing on any screen said why.

import { describe, it, expect, vi } from "vitest";
import { fetchWebVitals, parseFieldMetrics } from "../../functions/lib/audit/webVitals.js";

const CLOUD_KEY = "AIzaSyD_examplekey_0123456789abcdefg";
const AI_STUDIO_KEY = "AQ.Ab8RN6IEXAMPLEexampleEXAMPLEexample_bWeQ";

const FIELD = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8 },
    },
  },
};

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const fail = (status, message) => ({
  ok: false, status,
  json: async () => ({ error: { message } }),
  clone() { return { json: async () => ({ error: { message } }) }; },
});

const KIND_REJECTION = "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.";

function keyOf(url) {
  return new URL(url).searchParams.get("key");
}

describe("fetchWebVitals key handling", () => {
  it("sends the key when one is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(FIELD));
    const r = await fetchWebVitals("https://acme.io", { env: { PAGESPEED_API_KEY: CLOUD_KEY }, fetchImpl });
    expect(r.source).toBe("field");
    expect(keyOf(fetchImpl.mock.calls[0][0])).toBe(CLOUD_KEY);
  });

  it("works keyless when no key is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(FIELD));
    const r = await fetchWebVitals("https://acme.io", { env: {}, fetchImpl });
    expect(r.lcp).toBe(2.4);
    expect(keyOf(fetchImpl.mock.calls[0][0])).toBeNull();
  });

  it("RETRIES KEYLESS when the key is the wrong kind of Google credential", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fail(403, KIND_REJECTION))
      .mockResolvedValueOnce(ok(FIELD));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await fetchWebVitals("https://acme.io", { env: { PAGESPEED_API_KEY: AI_STUDIO_KEY }, fetchImpl });
    // The measurement survives — that is the whole point.
    expect(r.source).toBe("field");
    expect(r.lcp).toBe(2.4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(keyOf(fetchImpl.mock.calls[1][0])).toBeNull();
    // And the operator gets told, in the log, with the remedy.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/PAGESPEED_API_KEY/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ai_studio/));
    warn.mockRestore();
  });

  it("retries keyless for an ordinary invalid key too", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fail(400, "API key not valid. Please pass a valid API key."))
      .mockResolvedValueOnce(ok(FIELD));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await fetchWebVitals("https://acme.io", { env: { PAGESPEED_API_KEY: "nonsense" }, fetchImpl });
    expect(r.source).toBe("field");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("does NOT retry a quota error — the keyless quota is no better", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(429, "Quota exceeded for quota metric 'Queries'"));
    const r = await fetchWebVitals("https://acme.io", { env: { PAGESPEED_API_KEY: CLOUD_KEY }, fetchImpl });
    expect(r.unavailable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry when there was no key to blame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(403, KIND_REJECTION));
    const r = await fetchWebVitals("https://acme.io", { env: {}, fetchImpl });
    expect(r.unavailable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a failure is always unavailable, NEVER a zero score", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(500, "Internal error"));
    const r = await fetchWebVitals("https://acme.io", { env: {}, fetchImpl });
    expect(r.unavailable).toBe(true);
    expect(r.lcp).toBeUndefined();
    expect(parseFieldMetrics(undefined)).toBeNull();
  });
});
