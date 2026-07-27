// entitlementClient.test.js — the UX cache in front of the entitlement row.
//
// This cache is not authorization (the server re-resolves every mutation), so
// the properties that matter here are about staleness and leakage between
// users, not about enforcement.
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ fetchEntitlement: vi.fn() }));
vi.mock("./billingRepo.js", () => repo);

const ROW = { user_id: "u1", plan_id: "pro", status: "active", version: 3 };
const CACHE_KEY = "datiq.entitlement";

let mod;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  repo.fetchEntitlement.mockReset();
  repo.fetchEntitlement.mockResolvedValue(ROW);
  mod = await import("./entitlementClient.js");
});

describe("caching", () => {
  it("fetches once and serves the cache within the TTL", async () => {
    expect(await mod.loadEntitlement()).toEqual(ROW);
    expect(await mod.loadEntitlement()).toEqual(ROW);
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has expired", async () => {
    await mod.loadEntitlement({ now: 0 });
    await mod.loadEntitlement({ now: mod.TTL_MS + 1 });
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(2);
  });

  it("refetches when forced, regardless of freshness", async () => {
    await mod.loadEntitlement();
    await mod.loadEntitlement({ force: true });
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const [a, b, c] = await Promise.all([
      mod.loadEntitlement(),
      mod.loadEntitlement(),
      mod.loadEntitlement(),
    ]);
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(1);
    expect(a).toEqual(ROW);
    expect(b).toEqual(ROW);
    expect(c).toEqual(ROW);
  });

  it("survives a reload by reading the persisted entry", async () => {
    await mod.loadEntitlement();
    vi.resetModules();
    const fresh = await import("./entitlementClient.js");
    expect(fresh.getCachedEntitlement()).toEqual(ROW);
  });

  it("caches a null result so a free user does not refetch on every render", async () => {
    repo.fetchEntitlement.mockResolvedValue(null);
    expect(await mod.loadEntitlement()).toBeNull();
    expect(await mod.loadEntitlement()).toBeNull();
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(1);
  });
});

describe("getCachedEntitlement", () => {
  it("returns null before anything has been loaded", () => {
    expect(mod.getCachedEntitlement()).toBeNull();
  });

  it("is synchronous after a load, so first paint can gate correctly", async () => {
    await mod.loadEntitlement();
    expect(mod.getCachedEntitlement()).toEqual(ROW);
  });

  it("ignores a corrupted persisted entry instead of throwing", async () => {
    localStorage.setItem(CACHE_KEY, "{not json");
    expect(mod.getCachedEntitlement()).toBeNull();
  });
});

describe("clearEntitlementCache", () => {
  it("drops memory and persisted copies so the next user cannot see this one", async () => {
    await mod.loadEntitlement();
    mod.clearEntitlementCache();
    expect(mod.getCachedEntitlement()).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("forces a refetch afterwards", async () => {
    await mod.loadEntitlement();
    mod.clearEntitlementCache();
    await mod.loadEntitlement();
    expect(repo.fetchEntitlement).toHaveBeenCalledTimes(2);
  });
});

describe("noteEntitlementVersion", () => {
  it("busts the cache when the server reports a newer version", async () => {
    await mod.loadEntitlement();
    mod.noteEntitlementVersion(4); // cached row is version 3
    expect(mod.getCachedEntitlement()).toBeNull();
  });

  it("keeps the cache for the same or an older version", async () => {
    await mod.loadEntitlement();
    mod.noteEntitlementVersion(3);
    mod.noteEntitlementVersion(2);
    expect(mod.getCachedEntitlement()).toEqual(ROW);
  });

  it("ignores a non-numeric version header", async () => {
    await mod.loadEntitlement();
    mod.noteEntitlementVersion("nonsense");
    mod.noteEntitlementVersion(undefined);
    expect(mod.getCachedEntitlement()).toEqual(ROW);
  });
});
