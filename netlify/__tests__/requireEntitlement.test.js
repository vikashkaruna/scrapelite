// requireEntitlement.test.js — server-side capability enforcement.
//
// The two invariants worth protecting here are asymmetric on purpose:
//   fail OPEN when we could not determine entitlement (infra),
//   fail CLOSED only on an explicitly-read non-active status.
// A future "hardening" that flips the first one would turn a Supabase blip
// into a full product outage, so it is tested as a first-class requirement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => supabaseMock) }));

const AUTH = { authorization: "Bearer jwt-abc" };
const ev = (headers = AUTH) => ({ httpMethod: "POST", headers, body: "{}" });

let mod;

beforeEach(async () => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mod = await import("../functions/lib/requireEntitlement.js");
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Stub the entitlements REST read. */
function entitlementRow(row) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => (row ? [row] : []),
  });
}

// period_end must be RELATIVE to now: a fixed old date lands past day 90 and
// correctly computes PURGED, not SUSPENDED. 5 days ago is inside the 30-day
// suspended window.
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const paidSuspended = {
  user_id: "user-1",
  plan_id: "pro",
  status: "suspended",
  source: "payment",
  period_end: daysAgo(5),
};

describe("fail OPEN on infrastructure failure", () => {
  it("allows when the entitlements read returns non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { check, resolved } = await mod.requireCapability(ev(), "extract");
    expect(resolved.degraded).toBe(true);
    expect(check.allowed).toBe(true);
  });

  it("allows when the entitlements read throws (network down)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(check.allowed).toBe(true);
  });

  it("allows when the service key is not configured", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    vi.resetModules();
    mod = await import("../functions/lib/requireEntitlement.js");
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(check.allowed).toBe(true);
  });

  it("allows when the JWT cannot be verified rather than 500-ing", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    entitlementRow(null);
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(check.allowed).toBe(true);
  });
});

describe("fail CLOSED on an explicit non-active status", () => {
  it("denies extract for a suspended subscriber", async () => {
    entitlementRow(paidSuspended);
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(check.allowed).toBe(false);
    expect(check.code).toBe("SUSPENDED");
  });

  it("still allows export for a suspended subscriber (data portability)", async () => {
    entitlementRow(paidSuspended);
    const { check } = await mod.requireCapability(ev(), "export.csv");
    expect(check.allowed).toBe(true);
  });

  it("denies schedules for a suspended subscriber", async () => {
    entitlementRow(paidSuspended);
    const { check } = await mod.requireCapability(ev(), "schedules");
    expect(check.allowed).toBe(false);
  });

  it("denies a lapsed subscriber even when the row still says active (stricter wins)", async () => {
    entitlementRow({ ...paidSuspended, status: "active" });
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(check.allowed).toBe(false);
    expect(check.code).toBe("SUSPENDED");
  });
});

describe("guests are not covered by this module", () => {
  it("treats a request with no Authorization header as an uncovered guest", async () => {
    const { resolved, check } = await mod.requireCapability(ev({}), "extract");
    expect(resolved.guest).toBe(true);
    expect(check.allowed).toBe(true);
  });

  it("does not attempt an entitlements read for a guest", async () => {
    global.fetch = vi.fn();
    await mod.requireCapability(ev({}), "extract");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("signed-in user with no entitlement row", () => {
  it("is treated as an active Free plan, not as unlimited", async () => {
    entitlementRow(null);
    const allowed = await mod.requireCapability(ev(), "extract");
    expect(allowed.check.allowed).toBe(true);

    entitlementRow(null);
    const denied = await mod.requireCapability(ev(), "export.pdf"); // Free has no PDF
    expect(denied.check.allowed).toBe(false);
    expect(denied.check.code).toBe("NOT_IN_PLAN");
  });
});

describe("the entitlements read uses the service key", () => {
  it("sends the service key, not the caller's JWT", async () => {
    entitlementRow(paidSuspended);
    await mod.requireCapability(ev(), "extract");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain("/entitlements?user_id=eq.user-1");
    expect(opts.headers.apikey).toBe("service-key");
    expect(opts.headers.Authorization).toBe("Bearer service-key");
  });

  it("url-encodes the user id", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: "user/with?chars" } },
      error: null,
    });
    entitlementRow(null);
    await mod.requireCapability(ev(), "extract");
    expect(global.fetch.mock.calls[0][0]).toContain("user%2Fwith%3Fchars");
  });
});

describe("denyResponse", () => {
  it("returns 402 with a machine-readable code and lifecycle flag", async () => {
    entitlementRow(paidSuspended);
    const { check } = await mod.requireCapability(ev(), "extract");
    const res = mod.denyResponse(check);
    expect(res.statusCode).toBe(402);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("SUSPENDED");
    expect(body.lifecycle).toBe(true);
    expect(body.error).toMatch(/lapsed/i);
  });

  it("marks plan-limit denials as non-lifecycle so the client routes to upgrade", async () => {
    entitlementRow(null);
    const { check } = await mod.requireCapability(ev(), "schedules");
    const body = JSON.parse(mod.denyResponse(check).body);
    expect(body.lifecycle).toBe(false);
    expect(body.upgradeTo).toBe("pro");
  });

  it("never leaks the service key into a response body", async () => {
    entitlementRow(paidSuspended);
    const { check } = await mod.requireCapability(ev(), "extract");
    expect(mod.denyResponse(check).body).not.toContain("service-key");
  });
});
