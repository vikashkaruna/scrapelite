// billing-purge.test.js — the interlocks.
//
// This is the only function in DatIQ that destroys customer data, so the tests
// that matter are the ones proving it REFUSES to run. Every case below asserts
// that no DELETE was issued.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;

const ENV_KEYS = [
  "PURGE_ENABLED",
  "PURGE_DRY_RUN",
  "PURGE_MAX_USERS_PER_RUN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
];

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.PURGE_ENABLED = "1";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body, headers = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
});

const PURGEABLE = {
  user_id: "u1",
  plan_id: "pro",
  period_end: "2026-05-01T00:00:00Z",
  purge_after: "2026-07-30T00:00:00Z",
  last_notice_kind: "delete_d90",
  version: 3,
};

/** Wire a happy path: fresh lifecycle run, one purgeable user, counts, deletes. */
function wireHappyPath({ lastSuccess = new Date().toISOString(), rows = [PURGEABLE] } = {}) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("billing_cron_runs") && (!opts.method || opts.method === "GET")) {
      return ok([{ last_success: lastSuccess }]);
    }
    if (u.includes("/entitlements?") && u.includes("status=eq.deactivated")) return ok(rows);
    if (opts.method === "DELETE") return ok(null);
    if (opts.method === "PATCH" || opts.method === "POST") return ok(null);
    // count query
    return ok([], { "content-range": "0-0/4" });
  });
}

const deletes = () => fetchMock.mock.calls.filter(([, o]) => o?.method === "DELETE");

async function run() {
  const mod = await import("../functions/billing-purge.js");
  return mod.handler();
}

describe("interlock 1 — disabled by default", () => {
  it("does nothing at all unless PURGE_ENABLED is exactly 1", async () => {
    delete process.env.PURGE_ENABLED;
    const r = await run();
    expect(r.body).toMatch(/PURGE_ENABLED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not armed by a truthy-looking value", async () => {
    process.env.PURGE_ENABLED = "true";
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("interlock 2 — refuses when dunning is stale", () => {
  it("aborts when billing-lifecycle has never succeeded", async () => {
    wireHappyPath({ lastSuccess: null });
    const r = await run();
    expect(r.body).toMatch(/ABORTED/);
    expect(deletes()).toHaveLength(0);
  });

  it("aborts when billing-lifecycle last succeeded more than 48h ago", async () => {
    // The nightmare scenario: dunning silently died, so nobody was warned, but
    // the purge cron is healthy and would happily delete everything.
    const threeDaysAgo = new Date(Date.now() - 72 * 3600_000).toISOString();
    wireHappyPath({ lastSuccess: threeDaysAgo });
    const r = await run();
    expect(r.body).toMatch(/ABORTED/);
    expect(deletes()).toHaveLength(0);
  });

  it("proceeds when dunning ran recently", async () => {
    wireHappyPath({ lastSuccess: new Date(Date.now() - 3600_000).toISOString() });
    const r = await run();
    expect(r.body).not.toMatch(/ABORTED/);
    expect(deletes().length).toBeGreaterThan(0);
  });
});

describe("interlocks 3 and 4 — only warned, deactivated accounts", () => {
  it("filters on last_notice_kind = delete_d90", async () => {
    wireHappyPath();
    await run();
    const query = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes("status=eq.deactivated"));
    expect(query).toContain("last_notice_kind=eq.delete_d90");
  });

  it("filters on a purge_after date already in the past", async () => {
    wireHappyPath();
    await run();
    const query = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes("status=eq.deactivated"));
    expect(query).toContain("purge_after=lt.");
    expect(query).toContain("purge_after=not.is.null");
  });

  it("deletes nothing when nobody qualifies", async () => {
    wireHappyPath({ rows: [] });
    const r = await run();
    expect(deletes()).toHaveLength(0);
    expect(r.body).toMatch(/eligible 0/);
  });
});

describe("interlock 5 — bounded blast radius", () => {
  it("caps the number of accounts per run", async () => {
    process.env.PURGE_MAX_USERS_PER_RUN = "7";
    wireHappyPath();
    await run();
    const query = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes("status=eq.deactivated"));
    expect(query).toContain("limit=7");
  });

  it("defaults to a small cap when unset", async () => {
    wireHappyPath();
    await run();
    const query = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes("status=eq.deactivated"));
    expect(query).toContain("limit=50");
  });
});

describe("dry run", () => {
  it("reports what it would delete and deletes nothing", async () => {
    process.env.PURGE_DRY_RUN = "1";
    wireHappyPath();
    const r = await run();
    expect(r.body).toMatch(/DRY RUN/);
    expect(deletes()).toHaveLength(0);
  });
});

describe("what survives a purge", () => {
  it("never deletes invoices, payment_events or entitlements", async () => {
    wireHappyPath();
    await run();
    const deleted = deletes().map(([u]) => String(u));
    for (const table of ["invoices", "invoice_lines", "payment_events", "entitlements", "subscriptions"]) {
      expect(deleted.some((u) => u.includes(`/${table}?`))).toBe(false);
    }
  });

  it("deletes the user's own content", async () => {
    wireHappyPath();
    await run();
    const deleted = deletes().map(([u]) => String(u));
    expect(deleted.some((u) => u.includes("/extractions?"))).toBe(true);
    expect(deleted.some((u) => u.includes("/scheduled_tasks?"))).toBe(true);
  });

  it("scopes every delete to one user", async () => {
    wireHappyPath();
    await run();
    for (const [u] of deletes()) {
      expect(String(u)).toContain("user_id=eq.u1");
    }
  });
});

describe("failure handling", () => {
  it("does not mark a user purged when deletion failed", async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("billing_cron_runs") && (!opts.method || opts.method === "GET")) {
        return ok([{ last_success: new Date().toISOString() }]);
      }
      if (u.includes("/entitlements?") && u.includes("status=eq.deactivated")) return ok([PURGEABLE]);
      if (opts.method === "DELETE") return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
      return ok([], { "content-range": "0-0/4" });
    });
    const r = await run();
    const patched = fetchMock.mock.calls.filter(
      ([u, o]) => o?.method === "PATCH" && String(u).includes("/entitlements?"),
    );
    expect(patched).toHaveLength(0);
    expect(r.body).toMatch(/failed 1/);
  });
});

describe("lifecycleIsFresh", () => {
  it("is a pure predicate over the heartbeat", async () => {
    const { lifecycleIsFresh } = await import("../functions/billing-purge.js");
    const now = new Date("2026-07-27T12:00:00Z");
    expect(lifecycleIsFresh("2026-07-27T10:00:00Z", now)).toBe(true);
    expect(lifecycleIsFresh("2026-07-25T10:00:00Z", now)).toBe(false);
    expect(lifecycleIsFresh(null, now)).toBe(false);
    expect(lifecycleIsFresh("nonsense", now)).toBe(false);
  });
});
