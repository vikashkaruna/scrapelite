// netlify/__tests__/workflowEnqueue.test.js
//
// C-34 — buildEvent validates input, genId produces unique IDs, enqueue
// does the right thing on success and on every error path, backoff()
// returns a sane schedule.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  enqueue,
  enqueueEvent,
  backoffMs,
  nextAttemptAt,
  genId,
  STATE,
  KIND_WHITELIST,
  MAX_ATTEMPTS_DEFAULT,
} from "../functions/lib/workflowEnqueue.js";

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const client = { base: "https://x.supabase.co/rest/v1", headers: { apikey: "k", Authorization: "Bearer k" } };

describe("workflowEnqueue.STATE / KIND_WHITELIST", () => {
  it("exposes the documented state values", () => {
    expect(STATE.PENDING).toBe("pending");
    expect(STATE.PROCESSING).toBe("processing");
    expect(STATE.DONE).toBe("done");
    expect(STATE.FAILED).toBe("failed");
    expect(STATE.CANCELLED).toBe("cancelled");
  });

  it("exposes the documented kinds", () => {
    for (const k of [
      "schedule.changed",
      "contact.received",
      "user.lifecycle",
      "payment.captured",
      "op.alert",
    ]) {
      expect(KIND_WHITELIST.has(k)).toBe(true);
    }
  });
});

describe("workflowEnqueue.genId", () => {
  it("starts with the given prefix", () => {
    expect(genId("wfe").startsWith("wfe_")).toBe(true);
    expect(genId("wfr").startsWith("wfr_")).toBe(true);
  });

  it("default prefix is 'wfe'", () => {
    expect(genId().startsWith("wfe_")).toBe(true);
  });

  it("two calls produce different IDs (within a tight loop)", () => {
    const a = genId();
    const b = genId();
    expect(a).not.toBe(b);
  });
});

describe("workflowEnqueue.backoffMs", () => {
  it("returns the documented schedule", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(60_000); // 1 min
    expect(backoffMs(2)).toBe(5 * 60_000); // 5 min
    expect(backoffMs(3)).toBe(30 * 60_000); // 30 min
    expect(backoffMs(4)).toBe(2 * 60 * 60_000); // 2h
    expect(backoffMs(5)).toBe(12 * 60 * 60_000); // 12h
  });

  it("clamps very large attempt counts to 12h", () => {
    expect(backoffMs(99)).toBe(12 * 60 * 60_000);
  });

  it("treats negative or non-numeric as 0", () => {
    expect(backoffMs(-5)).toBe(0);
    expect(backoffMs("garbage")).toBe(0);
    expect(backoffMs(null)).toBe(0);
  });
});

describe("workflowEnqueue.nextAttemptAt", () => {
  it("returns ISO timestamp offset by backoff", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const iso = nextAttemptAt(1, from);
    expect(iso).toBe("2026-01-01T00:01:00.000Z");
  });

  it("defaults `from` to now", () => {
    const before = Date.now();
    const iso = nextAttemptAt(2); // 5 min
    const after = Date.now();
    const ts = new Date(iso).getTime();
    expect(ts).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(ts).toBeLessThanOrEqual(after + 5 * 60_000 + 50);
  });
});

describe("workflowEnqueue.buildEvent", () => {
  it("returns a valid event with defaults", () => {
    const e = buildEvent({ kind: "schedule.changed" });
    expect(e.id).toMatch(/^wfe_/);
    expect(e.kind).toBe("schedule.changed");
    expect(e.state).toBe("pending");
    expect(e.attempts).toBe(0);
    expect(e.max_attempts).toBe(MAX_ATTEMPTS_DEFAULT);
    expect(e.channels).toEqual([]);
    expect(e.payload).toEqual({});
    expect(e.ref_id).toBeNull();
    expect(e.user_id).toBeNull();
    expect(typeof e.created_at).toBe("string");
    expect(typeof e.next_attempt_at).toBe("string");
  });

  it("respects refId, userId, payload, channels", () => {
    const e = buildEvent({
      kind: "op.alert",
      refId: "sch_x",
      userId: "11111111-1111-1111-1111-111111111111",
      payload: { reason: "scrape failed 3x" },
      channels: [{ type: "slack", channel: "#datiq-alerts" }],
    });
    expect(e.ref_id).toBe("sch_x");
    expect(e.user_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(e.payload).toEqual({ reason: "scrape failed 3x" });
    expect(e.channels).toEqual([{ type: "slack", channel: "#datiq-alerts" }]);
  });

  it("throws on missing kind", () => {
    expect(() => buildEvent({})).toThrow(/kind is required/);
  });

  it("throws on unknown kind", () => {
    expect(() => buildEvent({ kind: "made.up" })).toThrow(/unknown kind/);
  });

  it("throws on non-array channels", () => {
    expect(() => buildEvent({ kind: "op.alert", channels: "not-an-array" })).toThrow(/channels must be an array/);
  });

  it("warns on empty channels (but does not throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = buildEvent({ kind: "op.alert", channels: [] });
    expect(e.channels).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws on out-of-range maxAttempts", () => {
    expect(() => buildEvent({ kind: "op.alert", maxAttempts: 0 })).toThrow(/maxAttempts/);
    expect(() => buildEvent({ kind: "op.alert", maxAttempts: 21 })).toThrow(/maxAttempts/);
  });

  it("respects a custom id when provided", () => {
    const e = buildEvent({ kind: "op.alert", id: "wfe_custom" });
    expect(e.id).toBe("wfe_custom");
  });

  it("respects a custom nextAttemptAt", () => {
    const future = "2099-01-01T00:00:00Z";
    const e = buildEvent({ kind: "op.alert", nextAttemptAt: future });
    expect(e.next_attempt_at).toBe(future);
  });
});

describe("workflowEnqueue.enqueueEvent", () => {
  it("POSTs to /workflow_events and returns the inserted row", async () => {
    const inserted = { id: "wfe_abc", kind: "op.alert", state: "pending" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([inserted]), { status: 201 }));
    const r = await enqueueEvent(client, { id: "wfe_abc", kind: "op.alert", state: "pending" });
    expect(r.ok).toBe(true);
    expect(r.event).toEqual(inserted);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/workflow_events"),
      expect.objectContaining({ method: "POST", body: expect.any(String) })
    );
  });

  it("handles a non-array response (single object)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "wfe_x" }), { status: 201 }));
    const r = await enqueueEvent(client, { id: "wfe_x", kind: "op.alert" });
    expect(r.ok).toBe(true);
    expect(r.event.id).toBe("wfe_x");
  });

  it("returns {ok:false} on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const r = await enqueueEvent(client, { id: "wfe_x", kind: "op.alert" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/supabase 500/);
  });

  it("returns {ok:false} on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await enqueueEvent(client, { id: "wfe_x", kind: "op.alert" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network: ECONNREFUSED/);
  });

  it("returns {ok:false} on missing client", async () => {
    const r = await enqueueEvent(null, { id: "wfe_x", kind: "op.alert" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing client/);
  });

  it("returns {ok:false} on invalid event", async () => {
    const r = await enqueueEvent(client, null);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid event/);
  });

  it("truncates long error bodies in the result", async () => {
    const big = "x".repeat(5000);
    fetchMock.mockResolvedValueOnce(new Response(big, { status: 500 }));
    const r = await enqueueEvent(client, { id: "wfe_x", kind: "op.alert" });
    expect(r.ok).toBe(false);
    expect(r.error.length).toBeLessThan(500);
  });
});

describe("workflowEnqueue.enqueue (convenience)", () => {
  it("builds + posts in one call", async () => {
    const inserted = { id: "wfe_y", kind: "schedule.changed" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([inserted]), { status: 201 }));
    const r = await enqueue(client, { kind: "schedule.changed", refId: "sch_a" });
    expect(r.ok).toBe(true);
    expect(r.event).toEqual(inserted);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/workflow_events");
    const body = JSON.parse(init.body);
    expect(body.kind).toBe("schedule.changed");
    expect(body.ref_id).toBe("sch_a");
    expect(body.state).toBe("pending");
  });

  it("returns {ok:false} on bad kind without calling fetch", async () => {
    const r = await enqueue(client, { kind: "made.up" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown kind/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
