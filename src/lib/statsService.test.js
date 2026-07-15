import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtStat, getStats } from "./statsService.js";

/**
 * U-68..69 — statsService is the read-side for the social-proof
 * counters on Home. Cached for 5 min; returns null on failure so the
 * UI can hide the section.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getStats — caching (U-68)", () => {
  it("first call fetches; second call within TTL returns cached (no second fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ teams: 50, extractions: 200 }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const a = await getStats();
    expect(a.teams).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const b = await getStats();
    expect(b.teams).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getStats — failure path (U-69)", () => {
  it("5xx → returns { teams: null, extractions: null }", async () => {
    globalThis.fetch = vi.fn(async () => new Response("server error", { status: 503 }));
    const r = await getStats();
    expect(r.teams).toBeNull();
    expect(r.extractions).toBeNull();
  });

  it("missing keys → returns null", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await getStats();
    expect(r.teams).toBeNull();
    expect(r.extractions).toBeNull();
  });
});

describe("fmtStat", () => {
  it("null / undefined → null", () => {
    expect(fmtStat(null)).toBeNull();
    expect(fmtStat(undefined)).toBeNull();
  });
  it("< 1K → n+", () => {
    expect(fmtStat(0)).toBe("0+");
    expect(fmtStat(42)).toBe("42+");
    expect(fmtStat(999)).toBe("999+");
  });
  it(">= 1K, < 10K → X.YK+", () => {
    expect(fmtStat(1234)).toBe("1.2K+");
    expect(fmtStat(9999)).toBe("10.0K+");
  });
  it(">= 10K, < 1M → XK+", () => {
    expect(fmtStat(12345)).toBe("12K+");
  });
  it(">= 1M → X.YM+", () => {
    expect(fmtStat(1_500_000)).toBe("1.5M+");
  });
});
