// netlify/functions/templates.js contract tests.
//
// The properties worth pinning here are the ones that cost money or leak:
//   - identity comes from the verified JWT, never the body
//   - a failed run charges NOTHING
//   - non-chargeable events (cache hits, skips) never reach the ledger
//   - a guest gets a working estimate but no persisted run
//   - one user cannot read another's run (404, not 403 — no enumeration)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
const FREE_ENT = { plan_id: "free", status: "active", source: "signup", period_end: "2999-01-01" };

const TEMPLATE_ROW = {
  template_key: "account_brief", version: 2, status: "published", title: "Sales-ready Account Brief",
  persona: "sales", summary: "s",
  input_schema: { fields: [{ name: "domain", kind: "domain", required: true, label: "Company domain" }] },
  extraction_schema: { fields: [] },
  output_schema: { blocks: [{ kind: "summary", title: "x" }] },
  prompt_bundle: { extract: "PROMPT" },
  credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 3, ai_calls_per_unit: 2 },
  plan_entitlement: "template.run", min_plan: "free",
};

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/entitlements?")) return jsonRes([FREE_ENT]);
    if (u.includes("/workflow_templates?")) return jsonRes([TEMPLATE_ROW]);
    if (u.includes("/template_runs?")) return jsonRes([]);
    if (u.includes("rpc/credit_balance")) return jsonRes(0);
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

async function loadHandler(user = { id: "user-1", email: "u1@x.com" }) {
  // The mock must supply the WHOLE module surface, not just the function under
  // test: requireEntitlement.js imports getUserScopedClient from here too, and
  // an undefined import throws inside resolveRequestEntitlement — which the
  // handler's own try/catch then turns into an opaque 500. That failure looks
  // like a bug in the handler and is not one.
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user ? { ok: true, user, client: {} }
           : { ok: false, status: 401, body: { error: "Authentication required" } }),
    getUserScopedClient: vi.fn(() => ({ client: null, problem: null, message: null })),
    bearerToken: vi.fn((h) => String(h || "").replace(/^Bearer\s+/i, "") || null),
  }));
  return (await import("../functions/templates.js")).handler;
}

const AUTH = { authorization: "Bearer t" };
const post = (body, headers = AUTH) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });

describe("templates — catalogue", () => {
  it("serves the catalogue without auth (it is an acquisition surface)", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).templates.length).toBeGreaterThan(0);
  });

  it("does NOT leak prompt bundles in the catalogue listing", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
    for (const t of JSON.parse(r.body).templates) {
      expect(t.prompt_bundle).toBeUndefined();
    }
  });

  it("still renders a catalogue when Supabase is unconfigured, flagged as degraded", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
    const b = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(b.degraded).toBe(true);
    expect(b.templates.length).toBe(5); // the five published seeds
  });

  it("rejects an unknown method", async () => {
    const h = await loadHandler();
    expect((await h({ httpMethod: "DELETE", headers: AUTH })).statusCode).toBe(405);
  });
});

describe("templates — estimate", () => {
  it("returns an itemised estimate with no run row written", async () => {
    const h = await loadHandler();
    const r = await h(post({ action: "estimate", templateKey: "account_brief", input: { domain: "acme.com" } }));
    const b = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    // base 1 + 3 pages x1 + 2 ai x2 = 8
    expect(b.estimate.credits).toBe(8);
    expect(b.estimate.breakdown.map((x) => x.unit)).toEqual(["run", "page", "ai_call"]);
    const wrote = fetchMock.mock.calls.some(([u, i]) =>
      String(u).includes("/template_runs") && i?.method === "POST");
    expect(wrote).toBe(false);
  });

  it("normalises the input it echoes back", async () => {
    const h = await loadHandler();
    const r = await h(post({ action: "estimate", templateKey: "account_brief",
      input: { domain: "https://WWW.Acme.com/about" } }));
    expect(JSON.parse(r.body).input.domain).toBe("acme.com");
  });

  it("rejects a missing required input with the human label", async () => {
    const h = await loadHandler();
    const r = await h(post({ action: "estimate", templateKey: "account_brief", input: {} }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/Company domain is required/);
  });

  it("404s an unknown template", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("/workflow_templates?") ? jsonRes([]) : jsonRes({}));
    const h = await loadHandler();
    const r = await h(post({ action: "estimate", templateKey: "no_such", input: {} }));
    expect(r.statusCode).toBe(404);
  });

  it("rejects an unknown action rather than guessing", async () => {
    const h = await loadHandler();
    expect((await h(post({ action: "obliterate" }))).statusCode).toBe(400);
  });
});

describe("templates — start", () => {
  it("gives a guest a working estimate but persists nothing", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "POST", headers: {},
      body: JSON.stringify({ action: "start", templateKey: "account_brief", input: { domain: "acme.com" } }) });
    const b = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(b.guest).toBe(true);
    expect(b.runId).toBeNull();
    expect(b.estimate.credits).toBe(8);
    expect(b.note).toMatch(/Sign in/);
  });

  // NOTE: supabase-js serialises a single-row .insert(obj) as a bare object,
  // not as [obj] — so the captured body is the row itself.
  it("creates a run for a signed-in user and returns the prompts it must execute", async () => {
    const inserted = [];
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([FREE_ENT]);
      if (u.includes("/workflow_templates?")) return jsonRes([TEMPLATE_ROW]);
      if (u.includes("/template_runs") && init?.method === "POST") {
        inserted.push(JSON.parse(init.body));
        return jsonRes([{ id: "trun_x", status: "running" }]);
      }
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "start", templateKey: "account_brief", input: { domain: "acme.com" } }));
    const b = JSON.parse(r.body);
    expect(b.runId).toMatch(/^trun_/);
    expect(b.template.prompt_bundle.extract).toBe("PROMPT");
    expect(inserted[0].user_id).toBe("user-1");
    expect(inserted[0].credits_estimated).toBe(8);
    // The version is PINNED on the run, which is what makes it reproducible.
    expect(inserted[0].template_version).toBe(2);
  });

  it("takes the owner from the JWT, never from the request body", async () => {
    const inserted = [];
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([FREE_ENT]);
      if (u.includes("/workflow_templates?")) return jsonRes([TEMPLATE_ROW]);
      if (u.includes("/template_runs") && init?.method === "POST") {
        inserted.push(JSON.parse(init.body)); return jsonRes([{ id: "trun_x" }]);
      }
      return jsonRes({});
    });
    const h = await loadHandler({ id: "real-user", email: "r@x.com" });
    await h(post({ action: "start", templateKey: "account_brief",
      input: { domain: "acme.com" }, user_id: "attacker", userId: "attacker" }));
    expect(inserted[0].user_id).toBe("real-user");
  });
});

describe("templates — finish charges only for work actually done", () => {
  const runRow = { id: "trun_1", user_id: "user-1", credits_estimated: 8, workspace_id: null };

  function mockWithRun(spend) {
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([FREE_ENT]);
      if (u.includes("/template_runs?")) return jsonRes([runRow]);
      if (u.includes("/template_runs") && init?.method === "PATCH") return jsonRes([{ ...runRow, status: "complete" }]);
      if (u.includes("rpc/credit_spend")) { spend.push(JSON.parse(init.body)); return jsonRes({ ok: true }); }
      return jsonRes({});
    });
  }

  it("charges the real events, collapsed into one ledger row per unit", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler();
    const r = await h(post({ action: "finish", runId: "trun_1", output: { a: 1 },
      events: [
        { unit: "page", credits: 1 }, { unit: "page", credits: 1 }, { unit: "page", credits: 1 },
        { unit: "ai_call", credits: 2 }, { unit: "ai_call", credits: 2 },
      ] }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).charged).toBe(7);
    expect(spend).toHaveLength(2);
    expect(spend.find((s) => s.p_unit === "page").p_credits).toBe(3);
    expect(spend.find((s) => s.p_unit === "ai_call").p_credits).toBe(4);
  });

  it("does NOT charge for cache hits or skipped unchanged pages", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler();
    const r = await h(post({ action: "finish", runId: "trun_1",
      events: [{ unit: "page", credits: 1, cached: true }, { unit: "page", credits: 1, skipped: true }] }));
    expect(JSON.parse(r.body).charged).toBe(0);
    expect(spend).toHaveLength(0);
  });

  it("does NOT charge for a failed provider call", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler();
    const r = await h(post({ action: "finish", runId: "trun_1",
      events: [{ unit: "page", credits: 1, failed: true }] }));
    expect(JSON.parse(r.body).charged).toBe(0);
  });

  it("discloses an overrun instead of quietly billing more than quoted", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler();
    const r = await h(post({ action: "finish", runId: "trun_1",
      events: [{ unit: "ai_call", credits: 40 }] }));
    const rec = JSON.parse(r.body).reconciliation;
    expect(rec.verdict).toBe("overrun");
    expect(rec.needsDisclosure).toBe(true);
  });

  it("a FAILED run charges nothing at all", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler();
    const r = await h(post({ action: "fail", runId: "trun_1", error: "provider down" }));
    expect(JSON.parse(r.body).charged).toBe(0);
    expect(spend).toHaveLength(0);
  });

  it("refuses to finish another user's run, and 404s rather than 403 (no enumeration)", async () => {
    const spend = []; mockWithRun(spend);
    const h = await loadHandler({ id: "someone-else", email: "e@x.com" });
    const r = await h(post({ action: "finish", runId: "trun_1", events: [{ unit: "page", credits: 5 }] }));
    expect(r.statusCode).toBe(404);
    expect(spend).toHaveLength(0);
  });

  it("requires auth to finish a run", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "POST", headers: {},
      body: JSON.stringify({ action: "finish", runId: "trun_1" }) });
    expect(r.statusCode).toBe(401);
  });
});

describe("templates — reading a run", () => {
  it("404s another user's run", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("/template_runs?") ? jsonRes([{ id: "trun_1", user_id: "someone-else" }]) : jsonRes({}));
    const h = await loadHandler({ id: "user-1", email: "u@x.com" });
    const r = await h({ httpMethod: "GET", headers: AUTH, queryStringParameters: { runId: "trun_1" } });
    expect(r.statusCode).toBe(404);
  });

  it("returns my own run", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("/template_runs?") ? jsonRes([{ id: "trun_1", user_id: "user-1", status: "complete" }]) : jsonRes({}));
    const h = await loadHandler({ id: "user-1", email: "u@x.com" });
    const r = await h({ httpMethod: "GET", headers: AUTH, queryStringParameters: { runId: "trun_1" } });
    expect(JSON.parse(r.body).run.status).toBe("complete");
  });
});
