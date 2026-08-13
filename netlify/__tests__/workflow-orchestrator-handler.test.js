// netlify/__tests__/workflow-orchestrator-handler.test.js
//
// C-36 — Netlify handler for the orchestrator function. Tests both the
// scheduled-invocation path (no httpMethod) and the HTTP path
// (POST with action=run-now or action=dispatch, with auth).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.N8N_BASE_URL;
  delete process.env.N8N_WEBHOOK_SECRET;
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.WORKFLOW_ORCHESTRATOR_TOKEN;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/workflow-orchestrator.js");
  return mod.handler;
}

function setSupabase() {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "sk";
}

function setN8n() {
  process.env.N8N_BASE_URL = "https://n8n-k8q6.srv1738397.hstgr.cloud";
  process.env.N8N_WEBHOOK_SECRET = "shared-secret";
}

function setAdmin() {
  process.env.WORKFLOW_ORCHESTRATOR_TOKEN = "admin-tok";
}

const okJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyJson = (status = 200) => new Response("{}", { status });

// Route fetch based on URL+method.
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

describe("workflow-orchestrator handler — scheduled path", () => {
  it("returns 200 'skipped (no supabase)' when no Supabase configured", async () => {
    const h = await loadHandler();
    const r = await h({});
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/no supabase/);
  });

  it("returns 200 'skipped (no N8N_BASE_URL)' when n8n not configured", async () => {
    setSupabase();
    const h = await loadHandler();
    const r = await h({});
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/no N8N_BASE_URL/);
  });

  it("happy path: returns summary string on success", async () => {
    setSupabase();
    setN8n();
    routeFetch([
      { match: (u, m) => u.includes("state=eq.processing") && m === "PATCH", respond: () => okJson([]) },
      { match: (u, m) => u.includes("state=eq.pending") && m === "GET", respond: () => okJson([]) },
    ]);
    const h = await loadHandler();
    const r = await h({});
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/scanned=0/);
  });

  it("returns 500 when claim throws", async () => {
    setSupabase();
    setN8n();
    routeFetch([
      { match: (u, m) => u.includes("state=eq.processing") && m === "PATCH", respond: () => okJson([]) },
      {
        match: (u, m) => u.includes("state=eq.pending") && m === "GET",
        respond: () => new Response("err", { status: 500 }),
      },
    ]);
    const h = await loadHandler();
    const r = await h({});
    expect(r.statusCode).toBe(500);
  });
});

describe("workflow-orchestrator handler — HTTP path", () => {
  it("rejects non-POST methods", async () => {
    setSupabase();
    setAdmin();
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(405);
  });

  it("rejects when supabase is not configured", async () => {
    setAdmin();
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: {}, body: '{"action":"run-now"}' });
    expect(r.statusCode).toBe(503);
  });

  it("rejects without auth", async () => {
    setSupabase();
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: {}, body: '{"action":"run-now"}' });
    expect(r.statusCode).toBe(401);
  });

  it("accepts with Bearer admin token", async () => {
    setSupabase();
    setN8n();
    setAdmin();
    routeFetch([
      { match: (u, m) => u.includes("state=eq.processing") && m === "PATCH", respond: () => okJson([]) },
      { match: (u, m) => u.includes("state=eq.pending") && m === "GET", respond: () => okJson([]) },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"run-now"}',
    });
    expect(r.statusCode).toBe(200);
  });

  it("accepts with valid HMAC signature", async () => {
    setSupabase();
    setN8n();
    setAdmin();
    // Build a signature for a known body.
    const { buildHeader } = await import("../functions/lib/n8nSignature.js");
    const body = '{"action":"run-now"}';
    const sig = buildHeader(process.env.N8N_WEBHOOK_SECRET, body);
    routeFetch([
      { match: (u, m) => u.includes("state=eq.processing") && m === "PATCH", respond: () => okJson([]) },
      { match: (u, m) => u.includes("state=eq.pending") && m === "GET", respond: () => okJson([]) },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { "x-datiq-signature": sig },
      body,
    });
    expect(r.statusCode).toBe(200);
  });

  it("rejects invalid HMAC signature", async () => {
    setSupabase();
    setN8n();
    setAdmin();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { "x-datiq-signature": "t=1700000000000,v1=deadbeef" },
      body: '{"action":"run-now"}',
    });
    expect(r.statusCode).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    setSupabase();
    setAdmin();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: "not-json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("returns 404 for unknown action", async () => {
    setSupabase();
    setAdmin();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"bogus"}',
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /dispatch with no event_id returns 400", async () => {
    setSupabase();
    setAdmin();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"dispatch"}',
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /dispatch with missing event returns 404", async () => {
    setSupabase();
    setAdmin();
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_x") && m === "GET",
        respond: () => okJson([]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"dispatch","event_id":"wfe_x"}',
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /dispatch on a 'done' event returns 409", async () => {
    setSupabase();
    setAdmin();
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_done") && m === "GET",
        respond: () => okJson([{ id: "wfe_done", state: "done", kind: "op.alert", attempts: 3, max_attempts: 5 }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"dispatch","event_id":"wfe_done"}',
    });
    expect(r.statusCode).toBe(409);
  });

  it("POST /dispatch on a 'cancelled' event returns 409", async () => {
    setSupabase();
    setAdmin();
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_c") && m === "GET",
        respond: () => okJson([{ id: "wfe_c", state: "cancelled", kind: "op.alert", attempts: 1, max_attempts: 5 }]),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"dispatch","event_id":"wfe_c"}',
    });
    expect(r.statusCode).toBe(409);
  });

  it("POST /dispatch happy path: re-claims and dispatches, returns 200", async () => {
    setSupabase();
    setN8n();
    setAdmin();
    routeFetch([
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_a") && m === "GET",
        respond: () => okJson([{ id: "wfe_a", state: "pending", kind: "schedule.changed", attempts: 0, max_attempts: 5, payload: {}, channels: [] }]),
      },
      {
        match: (u, m) => u.includes("/workflow_events?id=eq.wfe_a") && m === "PATCH",
        respond: () => emptyJson(200),
      },
      {
        match: (u, m) => u.includes("/workflow_runs") && m === "POST",
        respond: () => okJson([{ id: "wfr_1" }]),
      },
      {
        match: (u, m) => u.startsWith(process.env.N8N_BASE_URL) && m === "POST",
        respond: () => okJson({ ok: true }),
      },
      {
        match: (u, m) => u.includes("/workflow_runs?id=eq.") && m === "PATCH",
        respond: () => emptyJson(200),
      },
    ]);
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: "Bearer admin-tok" },
      body: '{"action":"dispatch","event_id":"wfe_a"}',
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
  });
});

describe("workflow-orchestrator handler — config", () => {
  it("exports the 5-min cron schedule", async () => {
    const mod = await import("../functions/workflow-orchestrator.js");
    expect(mod.config).toBeDefined();
    expect(mod.config.schedule).toBe("*/5 * * * *");
  });
});
