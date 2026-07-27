// netlify/__tests__/lib/zapierEventStore.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appendEvent, pollEvents } from "../../functions/lib/zapierEventStore.js";

function makeDb() {
  const state = { zapier_events: [] };
  const mock = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || "GET").toUpperCase();
    if (u.pathname.endsWith("/zapier_events")) {
      if (method === "POST") {
        const body = JSON.parse(init.body || "{}");
        const id = `e-${state.zapier_events.length + 1}`;
        const row = { id, ...body, created_at: new Date().toISOString() };
        state.zapier_events.push(row);
        return new Response(null, { status: 201 });
      }
      // GET
      const matches = [];
      for (const row of state.zapier_events) {
        let match = true;
        for (const [k, v] of u.searchParams) {
          if (k === "select" || k === "order" || k === "limit") continue;
          const [op, ...rest] = v.split(".");
          const val = rest.join(".");
          if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
          if (op === "gt" && !(row[k] > val)) { match = false; break; }
        }
        if (match) matches.push(row);
      }
      return new Response(JSON.stringify(matches), { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  return { mock, state };
}

const TEST_DB = { base: "https://test.supabase.co/rest/v1", headers: { apikey: "k", Authorization: "Bearer k" } };

describe("zapierEventStore", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  describe("appendEvent", () => {
    it("inserts an event", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      const r = await appendEvent({
        userId: "u1", eventType: "new_extraction", payload: { id: "e1" },
      }, { db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(state.zapier_events).toHaveLength(1);
    });
    it("returns missing_args when userId / eventType is missing", async () => {
      const r = await appendEvent({ eventType: "x", payload: {} }, { db: TEST_DB });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("missing_args");
    });
    it("returns unavailable when service db is unconfigured", async () => {
      const prev = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_KEY };
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      try {
        const r = await appendEvent({ userId: "u", eventType: "x", payload: {} });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("unavailable");
      } finally {
        process.env.SUPABASE_URL = prev.u;
        process.env.SUPABASE_SERVICE_KEY = prev.k;
      }
    });
  });

  describe("pollEvents", () => {
    it("returns rows for a user, optionally filtered by type", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.zapier_events.push(
        { id: "e1", user_id: "u1", event_type: "new_extraction", payload: { x: 1 }, created_at: "2026-07-28T10:00:00Z" },
        { id: "e2", user_id: "u1", event_type: "monitoring_alert", payload: { y: 2 }, created_at: "2026-07-28T11:00:00Z" },
        { id: "e3", user_id: "u-other", event_type: "new_extraction", payload: {}, created_at: "2026-07-28T12:00:00Z" },
      );
      const r = await pollEvents({ userId: "u1", eventType: "new_extraction" }, { db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.events).toHaveLength(1);
      expect(r.events[0].id).toBe("e1");
    });
    it("filters by since cursor (gt timestamp)", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.zapier_events.push(
        { id: "e1", user_id: "u1", event_type: "new_extraction", payload: {}, created_at: "2026-07-28T10:00:00Z" },
        { id: "e2", user_id: "u1", event_type: "new_extraction", payload: {}, created_at: "2026-07-28T11:00:00Z" },
      );
      const r = await pollEvents({ userId: "u1", since: "2026-07-28T10:30:00Z" }, { db: TEST_DB });
      expect(r.events.map((e) => e.id)).toEqual(["e2"]);
    });
  });
});
