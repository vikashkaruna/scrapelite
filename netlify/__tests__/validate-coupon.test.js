// netlify/functions/validate-coupon.test.js
// Read-only coupon status check used by the Account-page "Apply" flow so it
// can report a real exhausted/expired verdict instead of blind local success.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/validate-coupon.js");
  return mod.handler;
}

function post(body) {
  return { httpMethod: "POST", body: JSON.stringify(body) };
}

describe("validate-coupon", () => {
  it("rejects a missing code", async () => {
    const h = await loadHandler();
    const r = await h(post({}));
    expect(r.statusCode).toBe(400);
  });

  it("reports found:false for a code that isn't in the server coupon set", async () => {
    const h = await loadHandler();
    const r = await h(post({ code: "NOPE" }));
    const b = JSON.parse(r.body);
    expect(b).toEqual({ ok: true, found: false });
  });

  it("reports a static (unlimited-use) coupon as valid without a Supabase read", async () => {
    const h = await loadHandler();
    // EARLYBIRD is inactive in the static table — use LAUNCH20 (active, capped).
    const r = await h(post({ code: "launch20" }));
    const b = JSON.parse(r.body);
    expect(b.found).toBe(true);
    expect(b.active).toBe(true);
    expect(b.expired).toBe(false);
    expect(b.type).toBe("percent");
    expect(b.value).toBe(20);
    // No Supabase configured → exhausted can't be determined → reported false.
    expect(b.exhausted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an inactive static coupon as active:false", async () => {
    const h = await loadHandler();
    const r = await h(post({ code: "EARLYBIRD" }));
    const b = JSON.parse(r.body);
    expect(b.found).toBe(true);
    expect(b.active).toBe(false);
  });

  it("reports expired:true for a coupon past its expiresAt", async () => {
    const h = await loadHandler();
    // EARLYBIRD's static expiresAt (2026-04-01) is in the past relative to "today".
    const r = await h(post({ code: "EARLYBIRD" }));
    const b = JSON.parse(r.body);
    expect(b.expired).toBe(true);
  });

  it("carries the coupon's own planId restriction", async () => {
    const h = await loadHandler();
    const r = await h(post({ code: "INDIE10" }));
    const b = JSON.parse(r.body);
    expect(b.planId).toBe("select");
  });

  it("reports exhausted:true when Supabase's real usage count has hit maxUses", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc-key";
    const h = await loadHandler();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("pricing_config")) {
        return { ok: true, json: async () => [] }; // no overrides → static LAUNCH20 (maxUses 100)
      }
      if (String(url).includes("coupon_counters")) {
        return { ok: true, json: async () => [{ uses: 100 }] };
      }
      return { ok: false, json: async () => null };
    });
    const r = await h(post({ code: "LAUNCH20" }));
    const b = JSON.parse(r.body);
    expect(b.found).toBe(true);
    expect(b.exhausted).toBe(true);
  });

  it("reports exhausted:false when Supabase's real usage count is under maxUses", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc-key";
    const h = await loadHandler();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("pricing_config")) return { ok: true, json: async () => [] };
      if (String(url).includes("coupon_counters")) return { ok: true, json: async () => [{ uses: 3 }] };
      return { ok: false, json: async () => null };
    });
    const r = await h(post({ code: "LAUNCH20" }));
    const b = JSON.parse(r.body);
    expect(b.exhausted).toBe(false);
  });

  it("fails open (exhausted:false) when the Supabase usage read errors", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc-key";
    const h = await loadHandler();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("pricing_config")) return { ok: true, json: async () => [] };
      throw new Error("network down");
    });
    const r = await h(post({ code: "LAUNCH20" }));
    const b = JSON.parse(r.body);
    expect(b.found).toBe(true);
    expect(b.exhausted).toBe(false);
  });

  it("never touches coupon_counters or coupon_redemptions for writes (read-only)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "svc-key";
    const h = await loadHandler();
    fetchMock.mockImplementation(async (url, opts) => {
      expect((opts && opts.method) || "GET").toBe("GET");
      if (String(url).includes("pricing_config")) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ uses: 1 }] };
    });
    await h(post({ code: "LAUNCH20" }));
    expect(fetchMock).toHaveBeenCalled();
  });
});
