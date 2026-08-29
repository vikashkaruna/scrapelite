// netlify/__tests__/lib/accountState.test.js
// getAccountState now also returns periodEnd (0033) so DangerZone.jsx can show
// a plan-aware deletion message before the user ever confirms.

import { describe, it, expect, vi, afterEach } from "vitest";
import { getAccountState } from "../../functions/lib/accountState.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_KEY: "sk" };

describe("getAccountState", () => {
  it("returns planId and periodEnd for an active paid plan", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
      frozen_at: null, frozen_reason: null, deletion_requested_at: null,
      deletion_purge_after: null, status: "active", plan_id: "business",
      period_end: "2026-11-27T00:00:00Z",
    }]), { status: 200 })));
    const state = await getAccountState("user-1", ENV);
    expect(state.available).toBe(true);
    expect(state.planId).toBe("business");
    expect(state.periodEnd).toBe("2026-11-27T00:00:00Z");
  });

  it("periodEnd is null for a free/never-purchased account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
      frozen_at: null, frozen_reason: null, deletion_requested_at: null,
      deletion_purge_after: null, status: "active", plan_id: "free", period_end: null,
    }]), { status: 200 })));
    const state = await getAccountState("user-2", ENV);
    expect(state.planId).toBe("free");
    expect(state.periodEnd).toBeNull();
  });

  it("requests period_end in the select so it is never silently dropped", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getAccountState("user-3", ENV);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("period_end");
  });

  it("reports unavailable, never throws, when Supabase is unconfigured", async () => {
    const state = await getAccountState("user-4", {});
    expect(state).toEqual({ available: false });
  });
});
