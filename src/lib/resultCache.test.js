// src/lib/resultCache.test.js — FD2 (idempotent result cache + URL dedup).

import { describe, it, expect } from "vitest";
import {
  normaliseUrl,
  hashOptions,
  buildCacheKey,
  isCacheable,
  makeCacheEntry,
  isCacheEntryFresh,
  InProcessLRU,
  dedupDecision,
} from "./resultCache.js";

describe("normaliseUrl (FD2)", () => {
  it("lowercases the host", () => {
    expect(normaliseUrl("https://EXAMPLE.com/path")).toBe("https://example.com/path");
  });

  it("strips the default port (443 for https, 80 for http)", () => {
    expect(normaliseUrl("https://example.com:443/x")).toBe("https://example.com/x");
    expect(normaliseUrl("http://example.com:80/x")).toBe("https://example.com/x");
  });

  it("upgrades http to https by default", () => {
    expect(normaliseUrl("http://example.com/x")).toBe("https://example.com/x");
  });

  it("strips utm_* tracking params", () => {
    expect(normaliseUrl("https://x.com/a?utm_source=fb&utm_medium=email"))
      .toBe("https://x.com/a");
  });

  it("strips fbclid, gclid, msclkid, mc_cid, mc_eid, igshid, ref", () => {
    expect(normaliseUrl("https://x.com/a?fbclid=1&gclid=2&ref=3"))
      .toBe("https://x.com/a");
  });

  it("preserves non-tracking params and sorts them", () => {
    expect(normaliseUrl("https://x.com/a?z=1&a=2"))
      .toBe("https://x.com/a?a=2&z=1");
  });

  it("strips the trailing slash (but keeps '/')", () => {
    expect(normaliseUrl("https://x.com/")).toBe("https://x.com/");
    expect(normaliseUrl("https://x.com/path/")).toBe("https://x.com/path");
  });

  it("strips the URL fragment", () => {
    expect(normaliseUrl("https://x.com/a#section")).toBe("https://x.com/a");
  });

  it("returns the trimmed lowercase input for invalid URLs", () => {
    expect(normaliseUrl("not a url")).toBe("not a url");
    expect(normaliseUrl("  GARBAGE  ")).toBe("garbage");
  });

  it("URLs that differ only by tracking params dedup to the same key", () => {
    const a = normaliseUrl("https://x.com/a?utm_source=fb");
    const b = normaliseUrl("https://x.com/a?fbclid=1");
    const c = normaliseUrl("https://X.COM/a");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("hashOptions (FD2)", () => {
  it("is stable for the same options", () => {
    expect(hashOptions({ renderJs: false, customPrompt: "x" }))
      .toBe(hashOptions({ renderJs: false, customPrompt: "x" }));
  });

  it("differs when renderJs flips", () => {
    expect(hashOptions({ renderJs: true })).not.toBe(hashOptions({ renderJs: false }));
  });

  it("differs when customPrompt changes", () => {
    expect(hashOptions({ customPrompt: "a" })).not.toBe(hashOptions({ customPrompt: "b" }));
  });

  it("ignores AbortController / signal fields", () => {
    const a = hashOptions({ renderJs: true, customPrompt: "x" });
    const b = hashOptions({ renderJs: true, customPrompt: "x", signal: { aborted: false } });
    expect(a).toBe(b);
  });
});

describe("buildCacheKey (FD2)", () => {
  it("combines normalised URL + options hash", () => {
    const k = buildCacheKey("https://x.com/a", { renderJs: true });
    expect(k).toMatch(/^https:\/\/x\.com\/a::[a-z0-9]+$/);
  });

  it("same URL + same options = same key", () => {
    const a = buildCacheKey("https://x.com/a", { renderJs: true });
    const b = buildCacheKey("https://x.com/a", { renderJs: true });
    expect(a).toBe(b);
  });

  it("URLs with different tracking params dedup to same key", () => {
    const a = buildCacheKey("https://x.com/a?utm_source=fb", { renderJs: true });
    const b = buildCacheKey("https://x.com/a?gclid=1", { renderJs: true });
    expect(a).toBe(b);
  });

  it("different options produce different keys", () => {
    const a = buildCacheKey("https://x.com/a", { renderJs: true });
    const b = buildCacheKey("https://x.com/a", { renderJs: false });
    expect(a).not.toBe(b);
  });
});

describe("isCacheable (FD2)", () => {
  it("returns true for normal extractions", () => {
    expect(isCacheable({ renderJs: false })).toBe(true);
    expect(isCacheable({})).toBe(true);
    expect(isCacheable(null)).toBe(true);
  });

  it("returns false when a customPrompt is set (output is per-call)", () => {
    expect(isCacheable({ customPrompt: "find prices" })).toBe(false);
  });
});

describe("makeCacheEntry + isCacheEntryFresh (FD2)", () => {
  it("marks an entry as fresh within its TTL", () => {
    const e = makeCacheEntry({ result: { data: 1 }, ttlMs: 1000, now: 0 });
    expect(isCacheEntryFresh(e, 500)).toBe(true);
  });

  it("marks an entry as stale past its TTL", () => {
    const e = makeCacheEntry({ result: { data: 1 }, ttlMs: 1000, now: 0 });
    expect(isCacheEntryFresh(e, 1500)).toBe(false);
  });

  it("returns false for null entry", () => {
    expect(isCacheEntryFresh(null)).toBe(false);
    expect(isCacheEntryFresh(undefined)).toBe(false);
  });

  it("returns false for entries without expiresAt", () => {
    expect(isCacheEntryFresh({ result: 1 })).toBe(false);
  });
});

describe("InProcessLRU (FD2)", () => {
  it("sets and gets", () => {
    const l = new InProcessLRU(3);
    l.set("a", 1);
    expect(l.get("a")).toBe(1);
  });

  it("evicts the oldest when capacity is exceeded", () => {
    const l = new InProcessLRU(2);
    l.set("a", 1);
    l.set("b", 2);
    l.set("c", 3);
    expect(l.size()).toBe(2);
    expect(l.get("a")).toBeUndefined();
    expect(l.get("b")).toBe(2);
    expect(l.get("c")).toBe(3);
  });

  it("get() refreshes recency (LRU semantics)", () => {
    const l = new InProcessLRU(2);
    l.set("a", 1);
    l.set("b", 2);
    l.get("a"); // touch
    l.set("c", 3);
    expect(l.get("a")).toBe(1);
    expect(l.get("b")).toBeUndefined();
  });

  it("delete and clear work", () => {
    const l = new InProcessLRU(3);
    l.set("a", 1);
    l.set("b", 2);
    l.delete("a");
    expect(l.has("a")).toBe(false);
    l.clear();
    expect(l.size()).toBe(0);
  });
});

describe("dedupDecision (FD2)", () => {
  it("returns cacheable=true with a key for cacheable options", () => {
    const d = dedupDecision("https://x.com/a", { renderJs: false });
    expect(d.cacheable).toBe(true);
    expect(d.key).toMatch(/^https:\/\/x\.com\/a::/);
    expect(d.ttlMs).toBeGreaterThan(0);
  });

  it("returns cacheable=false when options are not cacheable", () => {
    const d = dedupDecision("https://x.com/a", { customPrompt: "x" });
    expect(d.cacheable).toBe(false);
    expect(d.key).toBeNull();
  });

  it("respects custom ttlMs", () => {
    const d = dedupDecision("https://x.com/a", {}, { ttlMs: 60_000 });
    expect(d.ttlMs).toBe(60_000);
  });
});
