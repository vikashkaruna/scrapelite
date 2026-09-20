// netlify/__tests__/admin-automation.test.js
//
// C-39 — admin-automation Netlify function: GET (stats + events) and
// POST (retry/cancel/dispatch/run-now). Mocks supabase + the
// orchestrator self-call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.WORKFLOW_ORCHESTRATOR_TOKEN;
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/admin-automation.js");
  return mod.handler;
}

function setSupabase() {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "sk";
}

function setAdminSecret() {
  // A stable secret for HMAC.
  process.env.ADMIN_TOKEN_SECRET = "test-secret";
}

async function makeAdminToken() {
  const { createHmac } = await import("node:crypto");
  const { issueAdminToken } = await import("../functions/admin-auth.js").catch(() => ({}));
  // Manual: build a token the verifier accepts.
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 })).toString("base64url");
  const sig = createHmac("sha256", process.env.ADMIN_TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

const okJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

describe("admin-automation — GET (stats + events)", () => {
  it("returns 503 when supabase not configured", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: {} });
    expect(r.statusCode).toBe(503);
  });

  it("returns stats + events on success", async () => {
    setSupabase();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events") && u.includes("state=in") && m === "GET",
        respond: () => okJson([
          { state: "pending", kind: "schedule.changed", attempts: 0, created_at: "2026-07-26T20:00:00Z" },
          { state: "done", kind: "contact.received", attempts: 1, started_at: "2026-07-26T19:00:00Z", finished_at: "2026-07-26T19:00:02Z", created_at: "2026-07-26T19:00:00Z" },
        ]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events") && u.includes("created_at=gte") && m === "GET",
        respond: () => okJson([]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?select=kind") && m === "GET",
        respond: () => okJson([
          { kind: "schedule.changed" },
          { kind: "schedule.changed" },
          { kind: "contact.received" },
        ]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?select=id,kind") && m === "GET",
        respond: () => okJson([
          { id: "wfe_a", kind: "schedule.changed", state: "pending", ref_id: "sch_x", user_id: "u1", attempts: 0, max_attempts: 5, next_attempt_at: "2026-07-26T20:00:00Z", last_error: null, created_at: "2026-07-26T20:00:00Z", finished_at: null },
        ]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: {} });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.stats.byState.pending).toBe(1);
    expect(body.stats.byState.done).toBe(1);
    expect(body.stats.avgTimeToDoneMs).toBe(2000);
    expect(body.stats.byKind["schedule.changed"]).toBe(2);
    expect(body.events).toHaveLength(1);
  });

  it("returns event detail when ?event_id is set", async () => {
    setSupabase();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?id=eq.wfe_x") && m === "GET",
        respond: () => okJson([{ id: "wfe_x", state: "failed", kind: "op.alert" }]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_runs?event_id=eq.wfe_x") && m === "GET",
        respond: () => okJson([{ id: "wfr_1", attempt_n: 1, response_status: 500 }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { event_id: "wfe_x" } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.event.id).toBe("wfe_x");
    expect(body.runs).toHaveLength(1);
  });
});

describe("admin-automation — POST (actions)", () => {
  it("rejects POST without a Bearer token", async () => {
    setSupabase();
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: {}, body: '{"action":"run-now"}' });
    expect(r.statusCode).toBe(401);
  });

  it("rejects POST with an invalid token", async () => {
    setSupabase();
    setAdminSecret();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer invalid.token" },
      body: '{"action":"run-now"}',
    });
    expect(r.statusCode).toBe(401);
  });

  it("accepts a valid admin token", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    routeFetch([
      { match: (u) => u.includes("/api/workflow-orchestrator/run-now"), respond: () => okJson({ ok: true, scanned: 0, dispatched: 0, failed: 0, requeued: 0 }) },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"run-now"}',
    });
    expect(r.statusCode).toBe(200);
  });

  it("retry: PATCHes the event back to pending and returns the row", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?id=eq.wfe_x") && m === "PATCH",
        respond: () => okJson([{ id: "wfe_x", state: "pending", attempts: 0 }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"retry","event_id":"wfe_x"}',
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.event.state).toBe("pending");
  });

  it("cancel: PATCHes the event to cancelled with a reason", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?id=eq.wfe_x") && m === "PATCH",
        respond: () => okJson([{ id: "wfe_x", state: "cancelled" }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"cancel","event_id":"wfe_x","reason":"obsolete"}',
    });
    expect(r.statusCode).toBe(200);
    const [_, init] = fetchMock.mock.calls[0];
    const patchBody = JSON.parse(init.body);
    expect(patchBody.state).toBe("cancelled");
    expect(patchBody.last_error).toMatch(/obsolete/);
  });

  it("dispatch: force-dispatches an event via the orchestrator in-process", async () => {
    setSupabase();
    setAdminSecret();
    process.env.N8N_BASE_URL = "https://n8n.example.com";
    process.env.N8N_WEBHOOK_SECRET = "secret";
    const token = await makeAdminToken();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?id=eq.wfe_x") && m === "GET",
        respond: () => okJson([{ id: "wfe_x", kind: "schedule.changed", state: "pending", payload: {}, attempts: 0, max_attempts: 5 }]),
      },
      {
        match: (u, m) => u.includes("/webhook/datiq/schedule-changed") && m === "POST",
        respond: () => okJson({ ok: true }),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "run_1" }]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/workflow_events?id=eq.wfe_x") && m === "PATCH",
        respond: () => okJson([{ id: "wfe_x", state: "processing" }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"dispatch","event_id":"wfe_x"}',
    });
    expect(r.statusCode).toBe(200);
  });

  it("delete: deletes workflow_runs and workflow_events", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    const deletedCalls = [];
    fetchMock.mockImplementation(async (url, init) => {
      deletedCalls.push({ url: String(url), method: init?.method });
      return okJson([{ id: "wfe_x", state: "failed" }]);
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"delete","event_id":"wfe_x"}',
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(deletedCalls.some((c) => c.url.includes("/workflow_runs?event_id=eq.wfe_x") && c.method === "DELETE")).toBe(true);
    expect(deletedCalls.some((c) => c.url.includes("/workflow_events?id=eq.wfe_x") && c.method === "DELETE")).toBe(true);
  });

  it("returns 400 on unknown action", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"bogus"}',
    });
    expect(r.statusCode).toBe(400);
  });

  it("returns 400 on retry with no event_id", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: '{"action":"retry"}',
    });
    expect(r.statusCode).toBe(400);
  });

  it("returns 400 on invalid JSON", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("handles set-config and get-config actions", async () => {
    setSupabase();
    setAdminSecret();
    const token = await makeAdminToken();
    routeFetch([
      {
        match: (u, m) => u.includes("/rest/v1/app_config") && m === "POST",
        respond: () => okJson([{ key: "automation_pipeline", value: { mode: "event_driven" } }]),
      },
      {
        match: (u, m) => u.includes("/rest/v1/app_config") && m === "GET",
        respond: () => okJson([{ value: { mode: "event_driven", polling_interval_minutes: 60 } }]),
      },
    ]);
    const h = await loadHandler();
    const setRes = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "set-config", config: { mode: "event_driven" } }),
    });
    expect(setRes.statusCode).toBe(200);

    const getRes = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "get-config" }),
    });
    expect(getRes.statusCode).toBe(200);
  });
});

describe("admin-automation — misc", () => {
  it("returns 405 for non-GET/POST methods", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "DELETE" });
    expect(r.statusCode).toBe(405);
  });

  it("OPTIONS returns 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});
