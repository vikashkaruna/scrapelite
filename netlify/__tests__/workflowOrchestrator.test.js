// netlify/__tests__/workflowOrchestrator.test.js
//
// C-35 — runOnce / claimPending / dispatchOne / requeueStuck / state
// transitions. All units are exercised via a fetch mock that simulates
// Supabase + the n8n endpoint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requeueStuck,
  claimPending,
  dispatchOne,
  buildDispatchBody,
  markDone,
  markFailed,
  markFailedOrRetry,
  startRun,
  finishRun,
  runOnce,
  genRunId,
  KIND_TO_N8N_WEBHOOK,
  STUCK_PROCESSING_MS,
  POLL_LIMIT,
} from "../functions/lib/workflowOrchestrator.js";
import { STATE, backoffMs } from "../functions/lib/workflowEnqueue.js";

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseClient = {
  base: "https://x.supabase.co/rest/v1",
  headers: { apikey: "k", Authorization: "Bearer k", "Content-Type": "application/json" },
};
const env = {
  url: "https://x.supabase.co",
  key: "sk",
  n8nBase: "https://n8n-k8q6.srv1738397.hstgr.cloud",
  n8nSecret: "shared-secret",
  adminToken: "admin-tok",
};

// Helper: respond to a fetch call based on URL + method.
function routeFetch(routes) {
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url);
    const m = (init.method || "GET").toUpperCase();
    for (const r of routes) {
      if (r.match(u, m)) return r.respond();
    }
    return new Response("not-routed", { status: 599 });
  });
}

const okJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const emptyJson = (status = 200) => new Response("{}", { status });

describe("workflowOrchestrator constants", () => {
  it("KIND_TO_N8N_WEBHOOK maps every whitelisted kind except payment.captured", () => {
    expect(KIND_TO_N8N_WEBHOOK["schedule.changed"]).toMatch(/^\/webhook\//);
    expect(KIND_TO_N8N_WEBHOOK["contact.received"]).toMatch(/^\/webhook\//);
    expect(KIND_TO_N8N_WEBHOOK["user.lifecycle"]).toMatch(/^\/webhook\//);
    expect(KIND_TO_N8N_WEBHOOK["op.alert"]).toMatch(/^\/webhook\//);
    // payment.captured is deferred to V2 — not in the map.
    expect(KIND_TO_N8N_WEBHOOK["payment.captured"]).toBeUndefined();
  });

  it("STUCK_PROCESSING_MS is 5 minutes", () => {
    expect(STUCK_PROCESSING_MS).toBe(5 * 60 * 1000);
  });

  it("POLL_LIMIT is sane", () => {
    expect(POLL_LIMIT).toBeGreaterThan(0);
    expect(POLL_LIMIT).toBeLessThanOrEqual(200);
  });
});

describe("workflowOrchestrator.genRunId", () => {
  it("starts with wfr_", () => {
    expect(genRunId().startsWith("wfr_")).toBe(true);
  });
  it("produces unique ids", () => {
    const a = genRunId();
    const b = genRunId();
    expect(a).not.toBe(b);
  });
});

describe("requeueStuck", () => {
  it("Patches state=pending for rows stuck in processing > 5 min", async () => {
    const patched = [{ id: "wfe_a", state: "pending" }];
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events") && u.includes("state=eq.processing") && m === "PATCH",
        respond: () => okJson(patched),
      },
    ]);
    const n = await requeueStuck(baseClient);
    expect(n).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/state=eq\.processing/);
    expect(url).toMatch(/started_at=lt\./); // cutoff applied
    const body = JSON.parse(init.body);
    expect(body.state).toBe(STATE.PENDING);
    expect(body.last_error).toMatch(/stuck/);
  });

  it("returns 0 on supabase error (logged by caller, not thrown)", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events") && m === "PATCH",
        respond: () => new Response("err", { status: 500 }),
      },
    ]);
    await expect(requeueStuck(baseClient)).rejects.toThrow(/requeueStuck/);
  });
});

describe("claimPending", () => {
  it("selects pending rows and patches each to processing", async () => {
    const candidates = [
      { id: "wfe_a", kind: "schedule.changed", state: "pending", attempts: 0, max_attempts: 5 },
      { id: "wfe_b", kind: "op.alert", state: "pending", attempts: 1, max_attempts: 5 },
    ];
    const claimed = [
      { id: "wfe_a", state: "processing", attempts: 1 },
      { id: "wfe_b", state: "processing", attempts: 2 },
    ];
    let patchCall = 0;
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events") && u.includes("state=eq.pending") && m === "GET",
        respond: () => okJson(candidates),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => okJson([claimed[patchCall++]]),
      },
    ]);
    const result = await claimPending(baseClient, { limit: 10 });
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe("processing");
    expect(result[0].attempts).toBe(1); // bumped from 0
  });

  it("skips rows another container already claimed (empty patch response)", async () => {
    const candidates = [
      { id: "wfe_a", kind: "schedule.changed", state: "pending", attempts: 0, max_attempts: 5 },
      { id: "wfe_b", kind: "op.alert", state: "pending", attempts: 0, max_attempts: 5 },
    ];
    routeFetch([
      {
        match: (u, m) => u.includes("state=eq.pending") && m === "GET",
        respond: () => okJson(candidates),
      },
      {
        // First call: empty (already claimed elsewhere)
        match: (u, m) => u.includes("wfe_a") && m === "PATCH",
        respond: () => okJson([]),
      },
      {
        // Second call: claimed
        match: (u, m) => u.includes("wfe_b") && m === "PATCH",
        respond: () => okJson([{ id: "wfe_b", state: "processing", attempts: 1 }]),
      },
    ]);
    const result = await claimPending(baseClient);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wfe_b");
  });

  it("returns [] when there are no candidates", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("state=eq.pending") && m === "GET",
        respond: () => okJson([]),
      },
    ]);
    const result = await claimPending(baseClient);
    expect(result).toEqual([]);
  });

  it("throws on supabase select error", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("state=eq.pending") && m === "GET",
        respond: () => new Response("err", { status: 500 }),
      },
    ]);
    await expect(claimPending(baseClient)).rejects.toThrow(/claim select/);
  });
});

describe("startRun / finishRun", () => {
  it("startRun POSTs a workflow_runs row", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
    ]);
    const event = { id: "wfe_a", kind: "schedule.changed", attempts: 1 };
    const r = await startRun(baseClient, event, "n8n", '{"x":1}');
    expect(r.id).toBe("wfr_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/workflow_runs$/);
    const body = JSON.parse(init.body);
    expect(body.event_id).toBe("wfe_a");
    expect(body.attempt_n).toBe(1);
    expect(body.channel).toBe("n8n");
  });

  it("startRun returns null on supabase error", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => new Response("err", { status: 500 }),
      },
    ]);
    const r = await startRun(baseClient, { id: "wfe_a", attempts: 1 }, "n8n", "{}");
    expect(r).toBeNull();
  });

  it("finishRun is a no-op when runId is null", async () => {
    await finishRun(baseClient, null, { x: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finishRun PATCHes workflow_runs", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    await finishRun(baseClient, "wfr_1", { response_status: 200, duration_ms: 42 });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("markDone / markFailed / markFailedOrRetry", () => {
  it("markDone sets state=done and finished_at", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    await markDone(baseClient, { id: "wfe_a" });
    const [_, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.state).toBe("done");
    expect(body.finished_at).toBeDefined();
    expect(body.last_error).toBeNull();
  });

  it("markFailed sets state=failed with truncated error", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    await markFailed(baseClient, { id: "wfe_a" }, "x".repeat(5000));
    const [_, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.state).toBe("failed");
    expect(body.last_error.length).toBe(1000);
  });

  it("markFailedOrRetry re-queues with backoff when attempts < max", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const now = new Date("2026-01-01T00:00:00Z");
    const r = await markFailedOrRetry(baseClient, { id: "wfe_a", attempts: 1, max_attempts: 5 }, "boom", { now });
    expect(r.ok).toBe(false);
    expect(r.retried).toBe(true);
    expect(r.nextAttemptAt).toBe(new Date(now.getTime() + backoffMs(1)).toISOString());
    const [_, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.state).toBe("pending");
    expect(body.last_error).toBe("boom");
    expect(body.next_attempt_at).toBe(r.nextAttemptAt);
  });

  it("markFailedOrRetry fails terminally when attempts >= max", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const r = await markFailedOrRetry(baseClient, { id: "wfe_a", attempts: 5, max_attempts: 5 }, "boom");
    expect(r.ok).toBe(false);
    expect(r.final).toBe(true);
    const [_, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).state).toBe("failed");
  });
});

describe("buildDispatchBody", () => {
  it("denormalizes row.payload._ctx to top-level _ctx in the body", () => {
    const row = {
      id: "wfe_a",
      kind: "schedule.changed",
      payload: {
        url: "https://example.com",
        _ctx: { env: "production", site_url: "https://datiq.app", supabase_url: "abc.supabase.co" },
      },
      state: "processing",
    };
    const body = buildDispatchBody(row);
    expect(body.id).toBe("wfe_a");
    expect(body.kind).toBe("schedule.changed");
    expect(body._ctx).toEqual({
      env: "production",
      site_url: "https://datiq.app",
      supabase_url: "abc.supabase.co",
    });
    // _ctx must NOT also live under payload anymore — the body is what n8n sees
    expect("_ctx" in body.payload).toBe(false);
    expect(body.payload.url).toBe("https://example.com");
  });

  it("substitutes an empty _ctx object when row.payload has no _ctx", () => {
    const row = { id: "wfe_b", kind: "op.alert", payload: { x: 1 }, state: "processing" };
    const body = buildDispatchBody(row);
    expect(body._ctx).toEqual({});
    expect(body.payload).toEqual({ x: 1 });
  });

  it("substitutes an empty _ctx object when row.payload is null/undefined", () => {
    const row = { id: "wfe_c", kind: "op.alert", payload: null, state: "processing" };
    const body = buildDispatchBody(row);
    expect(body._ctx).toEqual({});
    expect(body.payload).toEqual({});
  });

  it("ignores a non-object _ctx inside payload (defence against poisoned rows)", () => {
    const row = { id: "wfe_d", kind: "op.alert", payload: { _ctx: "not-an-object" }, state: "processing" };
    const body = buildDispatchBody(row);
    expect(body._ctx).toEqual({});
  });
});

describe("dispatchOne", () => {
  it("POSTs the event to the n8n webhook for its kind, signs the body, marks done on 2xx", async () => {
    let runPosted = false;
    let runFinished = false;
    let eventPatched = false;
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => {
          runPosted = true;
          return okJson([{ id: "wfr_1" }]);
        },
      },
      {
        match: (u, m) => u.startsWith(env.n8nBase) && m === "POST",
        respond: () => okJson({ ok: true }),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.wfr_1") && m === "PATCH",
        respond: () => {
          runFinished = true;
          return emptyJson(200);
        },
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_a") && m === "PATCH",
        respond: () => {
          eventPatched = true;
          return emptyJson(200);
        },
      },
    ]);
    const row = {
      id: "wfe_a",
      kind: "schedule.changed",
      state: "processing",
      attempts: 1,
      max_attempts: 5,
      payload: {
        _ctx: { env: "production", site_url: "https://datiq.app", supabase_url: "abc.supabase.co" },
      },
      channels: [],
    };
    const fetchImpl = vi.fn(async (url, init) => {
      // Verify the signature header is present
      expect(init.headers["X-DatIQ-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(init.headers["X-DatIQ-Event-Id"]).toBe("wfe_a");
      expect(init.headers["X-DatIQ-Event-Kind"]).toBe("schedule.changed");
      expect(url).toBe(env.n8nBase + KIND_TO_N8N_WEBHOOK["schedule.changed"]);
      // Verify the dispatch body carries _ctx at the top level
      const sent = JSON.parse(init.body);
      expect(sent._ctx).toEqual({
        env: "production",
        site_url: "https://datiq.app",
        supabase_url: "abc.supabase.co",
      });
      // And that _ctx is no longer nested inside payload
      expect("_ctx" in sent.payload).toBe(false);
      return new Response("{}", { status: 200 });
    });
    const r = await dispatchOne(env, baseClient, row, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(runPosted).toBe(true);
    expect(runFinished).toBe(true);
    expect(eventPatched).toBe(true);
  });

  it("retries with backoff on n8n 5xx", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const fetchImpl = vi.fn(async () => new Response("upstream down", { status: 503 }));
    const row = { id: "wfe_a", kind: "schedule.changed", state: "processing", attempts: 1, max_attempts: 5 };
    const r = await dispatchOne(env, baseClient, row, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.retried).toBe(true);
  });

  it("retries with backoff on network error", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const row = { id: "wfe_a", kind: "schedule.changed", state: "processing", attempts: 1, max_attempts: 5 };
    const r = await dispatchOne(env, baseClient, row, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.retried).toBe(true);
  });

  it("fails terminally on unknown kind", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const row = { id: "wfe_a", kind: "made.up", state: "processing", attempts: 1, max_attempts: 5 };
    const fetchImpl = vi.fn();
    const r = await dispatchOne(env, baseClient, row, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    // The event should be marked failed, not retried (no point retrying an unknown kind).
    const patchCall = fetchMock.mock.calls.find(([u, i]) => /workflow_events\?id=eq\.wfe_a/.test(u) && i.method === "PATCH");
    expect(JSON.parse(patchCall[1].body).state).toBe("failed");
  });

  it("fails when N8N_BASE_URL is missing", async () => {
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const row = { id: "wfe_a", kind: "schedule.changed", state: "processing", attempts: 1, max_attempts: 5 };
    const fetchImpl = vi.fn();
    const r = await dispatchOne({ ...env, n8nBase: "" }, baseClient, row, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runOnce", () => {
  it("returns ok:false with reason when client is null", async () => {
    const r = await runOnce(env, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_client");
  });

  it("returns ok:false with reason when n8nBase is missing", async () => {
    const r = await runOnce({ ...env, n8nBase: "" }, baseClient);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_n8n_base_url");
  });

  it("happy path: requeue stuck, claim 1, dispatch 1, mark done", async () => {
    const candidates = [{ id: "wfe_a", kind: "schedule.changed", state: "pending", attempts: 0, max_attempts: 5, payload: {}, channels: [] }];
    let requeued = false;
    routeFetch([
      {
        match: (u, m) => u.includes("state=eq.processing") && m === "PATCH",
        respond: () => {
          requeued = true;
          return okJson([]);
        },
      },
      {
        match: (u, m) => u.includes("state=eq.pending") && m === "GET",
        respond: () => okJson(candidates),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH",
        respond: () => {
          // First call = claim (state:pending → processing); second = mark done
          return okJson([{ id: "wfe_a", kind: "schedule.changed", state: "processing", attempts: 1, max_attempts: 5, payload: {}, channels: [] }]);
        },
      },
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.startsWith(env.n8nBase) && m === "POST",
        respond: () => okJson({ ok: true }),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await runOnce(env, baseClient, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.scanned).toBe(1);
    expect(r.dispatched).toBe(1);
    expect(r.failed).toBe(0);
    expect(requeued).toBe(true);
  });

  it("handles a thrown dispatch without killing the loop", async () => {
    const candidates = [
      { id: "wfe_a", kind: "schedule.changed", state: "pending", attempts: 0, max_attempts: 5, payload: {}, channels: [] },
      { id: "wfe_b", kind: "op.alert", state: "pending", attempts: 0, max_attempts: 5, payload: {}, channels: [] },
    ];
    let claimCall = 0;
    routeFetch([
      { match: (u, m) => u.includes("state=eq.processing") && m === "PATCH", respond: () => okJson([]) },
      { match: (u, m) => u.includes("state=eq.pending") && m === "GET", respond: () => okJson(candidates) },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.") && m === "PATCH" && m === "PATCH",
        respond: () => {
          claimCall++;
          // Claim both rows
          if (claimCall === 1) return okJson([{ id: "wfe_a", kind: "schedule.changed", state: "processing", attempts: 1, max_attempts: 5, payload: {}, channels: [] }]);
          return okJson([{ id: "wfe_b", kind: "op.alert", state: "processing", attempts: 1, max_attempts: 5, payload: {}, channels: [] }]);
        },
      },
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: `wfr_${claimCall}` }]),
      },
      {
        match: (u, m) => u.startsWith(env.n8nBase) && m === "POST",
        respond: () => okJson({ ok: true }),
      },
      { match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH", respond: () => emptyJson(200) },
    ]);
    const fetchImpl = vi.fn(async () => {
      // First call: throw; second call: succeed
      if (!fetchImpl._called) {
        fetchImpl._called = true;
        throw new Error("boom");
      }
      return new Response("{}", { status: 200 });
    });
    const r = await runOnce(env, baseClient, { fetchImpl });
    expect(r.scanned).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.dispatched).toBe(1);
  });
});
