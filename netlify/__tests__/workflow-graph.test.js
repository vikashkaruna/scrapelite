// GET /api/workflow-graph — the read-only orchestration view.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  listLists: vi.fn(),
  listWatchlists: vi.fn(),
  listRules: vi.fn(),
  listExecutions: vi.fn(),
  serviceDb: vi.fn(() => null),
}));

vi.mock("../functions/lib/supabaseServerClient.js", () => ({ authenticateBearer: mocks.authenticateBearer }));
vi.mock("../functions/lib/bulkStore.js", () => ({ listLists: mocks.listLists }));
vi.mock("../functions/lib/watchlistStore.js", () => ({
  listWatchlists: mocks.listWatchlists, serviceDb: mocks.serviceDb,
}));
vi.mock("../functions/lib/ruleStore.js", () => ({
  listRules: mocks.listRules,
  listExecutions: mocks.listExecutions,
}));

let handler;
beforeEach(async () => {
  vi.resetModules();
  for (const m of Object.values(mocks)) m.mockReset?.();
  mocks.serviceDb.mockReturnValue(null);
  mocks.listLists.mockResolvedValue({ lists: [] });
  mocks.listWatchlists.mockResolvedValue({ watchlists: [] });
  mocks.listRules.mockResolvedValue({ rules: [] });
  mocks.listExecutions.mockResolvedValue({ executions: [] });
  ({ handler } = await import("../functions/workflow-graph.js"));
});
afterEach(() => vi.restoreAllMocks());

const get = () => handler({ httpMethod: "GET", headers: {} });

describe("/api/workflow-graph", () => {
  it("requires a real session", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: false });
    const r = await get();
    expect(r.statusCode).toBe(401);
  });

  it("forwards a 503 deployment fault verbatim instead of 'Sign in'", async () => {
    // 2026-09-29 stg incident: authenticateBearer's 503 (revoked server anon
    // key) was collapsed into 401 "Sign in to view your workflow." — telling a
    // signed-in user to re-authenticate for an outage no sign-in could fix.
    mocks.authenticateBearer.mockResolvedValue({
      ok: false,
      status: 503,
      body: { error: "Supabase rejected this server's API key…", reason: "invalid_api_key" },
    });
    const r = await get();
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body).reason).toBe("invalid_api_key");
  });

  it("an auth FAILURE is never treated as an anonymous request", async () => {
    // The defect this guards: `auth.ok ? auth.user?.id : null` turned a failure
    // into userId=null, and the stores' `if (userId)` filters then applied NO
    // filter to a service-key query — returning every tenant's rules.
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: null });
    const r = await get();
    expect(r.statusCode).toBe(401);
    expect(mocks.listRules).not.toHaveBeenCalled();
  });

  it("scopes every store read to the caller", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
    await get();
    expect(mocks.listLists).toHaveBeenCalledWith("u-1");
    expect(mocks.listWatchlists).toHaveBeenCalledWith("u-1");
    expect(mocks.listRules).toHaveBeenCalledWith("u-1");
  });

  it("returns the graph, with the blocking gap named", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
    mocks.listRules.mockResolvedValue({
      rules: [{ id: "r1", name: "Price alert", status: "active", trigger_source: "watchlist", action_type: "slack" }],
    });
    const r = await get();
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    // A rule listening for competitor changes with no watchlists can never
    // fire, and today that is completely silent.
    expect(body.issues.map((i) => i.code)).toContain("rule_unreachable");
    expect(body.counts.blocking).toBeGreaterThan(0);
  });

  it("tolerates a bare array from a store rather than the wrapped shape", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
    mocks.listWatchlists.mockResolvedValue([{ id: "w1", name: "R", targets: [] }]);
    const r = await get();
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).counts.watchlists).toBe(1);
  });

  it("is read-only — a POST is refused", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
    const r = await handler({ httpMethod: "POST", headers: {} });
    expect(r.statusCode).toBe(405);
  });

  it("degrades to a named error rather than throwing", async () => {
    mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
    mocks.listLists.mockRejectedValue(new Error("db down"));
    const r = await get();
    expect(r.statusCode).toBe(502);
    expect(JSON.parse(r.body).code).toBe("graph_failed");
  });
});
