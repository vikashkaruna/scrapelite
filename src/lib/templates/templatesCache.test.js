import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  readTemplatesCache, writeTemplatesCache, clearTemplatesCache, __testing,
} from "./templatesCache.js";

const { KEY, SHAPE_VERSION, MAX_PAINT_AGE_MS } = __testing;
const LIVE = { templates: [{ template_key: "account_brief" }, { template_key: "custom_one" }] };

describe("templatesCache", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a good response", () => {
    expect(writeTemplatesCache(LIVE)).toBe(true);
    expect(readTemplatesCache().templates).toHaveLength(2);
  });

  it("returns null when nothing is cached", () => {
    expect(readTemplatesCache()).toBeNull();
  });

  // The core rule. A degraded response is the six built-in seeds, not the
  // catalogue — caching it would persist an outage past its own end and
  // silently drop templates a workspace really has.
  it("refuses to cache a degraded response", () => {
    expect(writeTemplatesCache({ ...LIVE, degraded: true })).toBe(false);
    expect(readTemplatesCache()).toBeNull();
  });

  it("a degraded response never overwrites a good cache", () => {
    writeTemplatesCache(LIVE);
    writeTemplatesCache({ templates: [{ template_key: "seed_only" }], degraded: true });
    expect(readTemplatesCache().templates.map((t) => t.template_key))
      .toEqual(["account_brief", "custom_one"]);
  });

  it("refuses an empty list — an empty catalogue is indistinguishable from a broken read", () => {
    expect(writeTemplatesCache({ templates: [] })).toBe(false);
    expect(writeTemplatesCache({})).toBe(false);
    expect(writeTemplatesCache(null)).toBe(false);
  });

  it("drops an entry written by an older shape rather than feeding it forward", () => {
    localStorage.setItem(KEY, JSON.stringify({ v: SHAPE_VERSION - 1, cachedAt: Date.now(), templates: LIVE.templates }));
    expect(readTemplatesCache()).toBeNull();
  });

  it("drops an entry past the max paint age", () => {
    const now = Date.now();
    writeTemplatesCache(LIVE, now);
    expect(readTemplatesCache(now + MAX_PAINT_AGE_MS - 1000)).toBeTruthy();
    expect(readTemplatesCache(now + MAX_PAINT_AGE_MS + 1000)).toBeNull();
  });

  it("drops an entry stamped in the future (clock change / tampering)", () => {
    const now = Date.now();
    writeTemplatesCache(LIVE, now);
    expect(readTemplatesCache(now - 60_000)).toBeNull();
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readTemplatesCache()).toBeNull();
  });

  // Safari private mode and "block site data" make the ACCESSOR itself throw.
  // A caching layer must never be the reason a page fails to render.
  it("never throws when localStorage itself is unavailable", () => {
    // Spy on the INSTANCE, not Storage.prototype: test/setup.js installs a
    // storage object whose setItem/getItem are own properties, so a prototype
    // spy is never reached and the test would pass without exercising
    // anything.
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(() => readTemplatesCache()).not.toThrow();
    expect(readTemplatesCache()).toBeNull();
    expect(writeTemplatesCache(LIVE)).toBe(false);
  });

  it("clear removes the entry", () => {
    writeTemplatesCache(LIVE);
    clearTemplatesCache();
    expect(readTemplatesCache()).toBeNull();
  });
});
