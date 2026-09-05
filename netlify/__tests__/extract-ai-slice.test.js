// Budget policy for the AI enrichment path — see aiSliceMs() in extract.js.
//
// A capability run makes up to TWO model calls with a related-page scrape
// between them. The first version of this fix handed the whole remaining budget
// to whichever call asked first, which stopped the 504 but starved the retry —
// and the retry is the COMMON case (a homepage whose pricing lives at /pricing
// is exactly the run that reported the bug).
import { describe, expect, it } from "vitest";
import { aiSliceMs, relatedFetchMs, AI_CALL_MIN_MS } from "../functions/extract.js";

// Minimal stand-in for lib/audit/deadline.js — only remaining() is consulted.
const at = (ms) => ({ remaining: () => ms });

describe("aiSliceMs — splitting the budget across two model calls", () => {
  it("holds back the retry path when the budget is generous", () => {
    // 15s left: the first call must NOT take all of it, or the retry is dead.
    const slice = aiSliceMs(at(15_000));
    expect(slice).toBeLessThan(15_000);
    expect(slice).toBeGreaterThanOrEqual(AI_CALL_MIN_MS);
    // What it holds back must actually be enough for a scrape + a model call.
    expect(15_000 - slice).toBeGreaterThanOrEqual(AI_CALL_MIN_MS);
  });

  it("gives the first call everything when the budget is tight", () => {
    // 5s left: holding back would half-starve BOTH calls. One complete answer
    // beats two aborted ones — and skipping the retry is reported honestly.
    expect(aiSliceMs(at(5_000))).toBe(5_000);
  });

  it("never returns a slice below the useful floor while claiming to reserve", () => {
    // Whatever the budget, the first call either gets a workable slice or the
    // lot — it is never handed a sliver that is guaranteed to abort.
    for (const left of [1_000, 4_000, 7_000, 8_000, 11_000, 20_000, 30_000]) {
      const slice = aiSliceMs(at(left));
      expect(slice === left || slice >= AI_CALL_MIN_MS).toBe(true);
      expect(slice).toBeLessThanOrEqual(left);
    }
  });

  it("gives the retry everything left — nothing follows it", () => {
    expect(aiSliceMs(at(6_000), { isRetry: true })).toBe(6_000);
    expect(aiSliceMs(at(800), { isRetry: true })).toBe(800);
  });

  it("the retry is never handed less than the first call would have held back", () => {
    // The reserve has to be real: if the first call takes `slice`, the retry
    // path must still have the reserve available to it.
    const left = 15_000;
    const first = aiSliceMs(at(left));
    const afterFirst = left - first;
    expect(aiSliceMs(at(afterFirst), { isRetry: true })).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
  });
});

describe("relatedFetchMs — the scrape BETWEEN the two model calls", () => {
  it("skips entirely when there is no room to reason over what it fetches", () => {
    // Pages we will have no time left to read are not worth fetching.
    expect(relatedFetchMs(at(AI_CALL_MIN_MS))).toBe(0);
    expect(relatedFetchMs(at(2_000))).toBe(0);
  });

  it("never exceeds the per-fetch ceiling on a generous budget", () => {
    expect(relatedFetchMs(at(60_000))).toBe(9_000);
  });

  it("clamps to what is left, minus a model call", () => {
    const ms = relatedFetchMs(at(10_000));
    expect(ms).toBe(10_000 - AI_CALL_MIN_MS);
    expect(ms).toBeLessThan(9_000); // would have overrun the old 9s constant
  });

  it("falls back to the ceiling when unbudgeted (no deadline passed)", () => {
    expect(relatedFetchMs(null)).toBe(9_000);
  });
});
