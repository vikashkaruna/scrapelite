import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cacheKey, readCache, writeCache, loadWithCache,
  rememberActiveAudit, readActiveAudit, clearDiscoverabilityCache,
  summarizeAudit, formatAuditContext, CACHE_PREFIX,
} from "./tabCache.js";

beforeEach(() => { localStorage.clear(); });

describe("tabCache — localStorage first, database authoritative", () => {
  it("scopes keys by user AND workspace so accounts and workspaces never share a paint", () => {
    const a = cacheKey("entity-graph", { userId: "u1", workspaceId: "w1" });
    expect(a).not.toBe(cacheKey("entity-graph", { userId: "u2", workspaceId: "w1" }));
    expect(a).not.toBe(cacheKey("entity-graph", { userId: "u1", workspaceId: "w2" }));
    expect(a.startsWith(CACHE_PREFIX)).toBe(true);
  });

  it("paints the cached value first, then the database value, and stores the fresh one", async () => {
    const key = cacheKey("truth.records", { userId: "u1" });
    writeCache(key, { records: [{ id: "old" }] });
    const seen = [];
    await loadWithCache(key, async () => ({ records: [{ id: "new" }] }), (d, meta) => seen.push([d.records[0].id, meta.fromCache]));
    expect(seen).toEqual([["old", true], ["new", false]]);
    expect(readCache(key).data.records[0].id).toBe("new");
  });

  it("with nothing cached, only the database value is applied", async () => {
    const apply = vi.fn();
    await loadWithCache(cacheKey("x", {}), async () => ({ ok: 1 }), apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].fromCache).toBe(false);
  });

  it("a failed database fetch keeps the cached paint and rethrows", async () => {
    const key = cacheKey("y", {});
    writeCache(key, { v: 1 });
    const apply = vi.fn();
    await expect(loadWithCache(key, async () => { throw new Error("offline"); }, apply)).rejects.toThrow("offline");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(readCache(key).data).toEqual({ v: 1 });
  });

  it("remembers the active audit per user/workspace and sign-out sweeps everything", () => {
    rememberActiveAudit({ userId: "u1", workspaceId: null }, { id: "a-1", domain: "acme.com" });
    writeCache(cacheKey("z", { userId: "u1" }), { v: 1 });
    localStorage.setItem("datiq.theme", "dark");
    expect(readActiveAudit({ userId: "u1" }).id).toBe("a-1");
    expect(readActiveAudit({ userId: "u2" })).toBeNull();
    clearDiscoverabilityCache();
    expect(readActiveAudit({ userId: "u1" })).toBeNull();
    expect(readCache(cacheKey("z", { userId: "u1" }))).toBeNull();
    expect(localStorage.getItem("datiq.theme")).toBe("dark");
  });

  it("summarises an audit row into domain · profile · device · page type · date", () => {
    const summary = summarizeAudit({
      audit: {
        id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000",
        target_url: "https://www.acme.com/pricing",
        audit_profile: "balanced",
        device_profile: "mobile",
        page_type: "pricing_page",
        created_at: "2026-09-15T09:30:00Z",
      },
    });
    expect(summary).toMatchObject({ shortId: "0f1e2d3c", domain: "acme.com", profile: "balanced", device: "mobile", pageType: "pricing_page" });
    const line = formatAuditContext(summary);
    expect(line.startsWith("acme.com · Balanced · Mobile · Pricing Page · ")).toBe(true);
    expect(line).toMatch(/2026/);
  });

  it("returns null for something that is not an audit", () => {
    expect(summarizeAudit(null)).toBeNull();
    expect(summarizeAudit({})).toBeNull();
  });
});
