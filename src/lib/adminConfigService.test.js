import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRealUsers,
  getAiConfig,
  getGeneralConfig,
  getRevenueData,
  saveAiConfig,
  saveGeneralConfig,
} from "./adminConfigService.js";

/**
 * U-66..67 — adminConfigService is the client wrapper for the admin
 * AI/general/revenue/users endpoints. Token-gated paths (POST) must
 * throw without a token; non-gated paths (GET) work without one.
 * getRevenueData returns {fromSeed: true} when Supabase is unconfigured.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Token-gated POSTs throw without a token (U-66)", () => {
  it("saveAiConfig without a token: server returns 401, client throws", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(saveAiConfig({ providerOrder: ["gemini"] })).rejects.toThrow();
  });

  it("saveGeneralConfig without a token: throws", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(saveGeneralConfig({ guest_trial_soft_limit: 5 })).rejects.toThrow();
  });

  it("saveAiConfig with a token: server returns 200, client returns parsed JSON", async () => {
    localStorage.setItem("scrapelite.adminAuth", "valid.token");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, persisted: true }), { status: 200 }),
    );
    const r = await saveAiConfig({ providerOrder: ["gemini"] });
    expect(r.ok).toBe(true);
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer valid.token");
  });
});

describe("Non-gated GETs work without a token (U-66)", () => {
  it("getAiConfig returns parsed JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, config: { providerOrder: ["gemini"] } }), {
        status: 200,
      }),
    );
    const r = await getAiConfig();
    expect(r.ok).toBe(true);
    expect(r.config.providerOrder).toEqual(["gemini"]);
  });

  it("getGeneralConfig returns parsed JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, settings: { guest_trial_soft_limit: 5 } }), {
        status: 200,
      }),
    );
    const r = await getGeneralConfig();
    expect(r.ok).toBe(true);
    expect(r.settings.guest_trial_soft_limit).toBe(5);
  });
});

describe("getRevenueData fallback (U-67)", () => {
  it("returns {fromSeed: true, ...} when the server signals a fallback (Supabase unconfigured)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          metrics: { mrr: 0, arr: 0 },
          trend: [],
          fromSeed: true,
          warning: "Supabase not configured; showing seed data.",
        }),
        { status: 200 },
      ),
    );
    const r = await getRevenueData();
    expect(r.fromSeed).toBe(true);
    expect(r.warning).toMatch(/Supabase not configured/);
  });

  it("fetchRealUsers returns {users, fromSeed} shape", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ users: [], fromSeed: true }), { status: 200 }),
    );
    const r = await fetchRealUsers();
    expect(Array.isArray(r.users)).toBe(true);
    expect(r.fromSeed).toBe(true);
  });
});
