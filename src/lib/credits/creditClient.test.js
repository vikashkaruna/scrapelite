import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const credits = vi.fn();
vi.mock("../apiClient.js", () => ({ apiClient: { credits: (...a) => credits(...a) } }));

const mod = await import("./creditClient.js");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mod.clearCreditsCache();
});
afterEach(() => mod.clearCreditsCache());

describe("fetchCredits", () => {
  it("returns the server's status and caches it", async () => {
    credits.mockResolvedValue({ enforced: true, available: 750, grants: 1 });
    const now = Date.now();
    await expect(mod.fetchCredits({ now })).resolves.toMatchObject({ enforced: true, available: 750 });
    await mod.fetchCredits({ now: now + 1000 });
    expect(credits).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has passed", async () => {
    credits.mockResolvedValue({ enforced: true, available: 750 });
    const now = Date.now();
    await mod.fetchCredits({ now });
    await mod.fetchCredits({ now: now + mod.TTL_MS + 1 });
    expect(credits).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent callers onto one request", async () => {
    credits.mockImplementation(() => new Promise((r) => setTimeout(() => r({ enforced: true, available: 5 }), 5)));
    await Promise.all([mod.fetchCredits(), mod.fetchCredits(), mod.fetchCredits()]);
    expect(credits).toHaveBeenCalledTimes(1);
  });

  // 🔴 "We could not read it" must never render as a confident zero — the same
  // distinction the audit scorer draws between an unmeasured signal and one
  // that genuinely scored nothing.
  it("reports a failed read as DEGRADED, not as an empty balance", async () => {
    credits.mockRejectedValue(new Error("offline"));
    const r = await mod.fetchCredits();
    expect(r.degraded).toBe(true);
    expect(r.available).toBeNull();
  });
});

describe("describeCredits — what may be shown on a screen", () => {
  it("shows a real balance", () => {
    expect(mod.describeCredits({ enforced: true, available: 1 })).toBe("1 credit remaining");
    expect(mod.describeCredits({ enforced: true, available: 1234 })).toBe("1,234 credits remaining");
    expect(mod.describeCredits({ enforced: true, available: 0 })).toBe("No credits remaining");
  });

  // 🔴 An account never granted credits is not "out of credits". Saying so
  // tells a customer they have exhausted something they were never given.
  it("says NOTHING for an account that is not on the credit system", () => {
    expect(mod.describeCredits({ enforced: false, available: 0 })).toBeNull();
    expect(mod.describeCredits({ enforced: false, available: null, grants: 0 })).toBeNull();
  });

  it("says nothing when the balance could not be read", () => {
    expect(mod.describeCredits({ degraded: true, enforced: true, available: null })).toBeNull();
    expect(mod.describeCredits(null)).toBeNull();
  });
});
