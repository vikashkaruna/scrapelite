import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateBearer: vi.fn() }));
vi.mock("../functions/lib/supabaseServerClient.js", () => authMock);

let fetchMock;
let handler;

const ok = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
});

beforeEach(async () => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  authMock.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u1" } });
  fetchMock = vi.fn(async () => ok([]));
  vi.stubGlobal("fetch", fetchMock);
  ({ handler } = await import("../functions/redeem-admin-coupon.js"));
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("redeem-admin-coupon authentication", () => {
  it("requires a signed-in user", async () => {
    authMock.authenticateBearer.mockResolvedValue({
      ok: false,
      status: 401,
      body: { error: "Authentication required" },
    });
    const r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ code: "GRANT1" }) });
    expect(r.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("redeem-admin-coupon user scoping", () => {
  it("returns the caller's newest grant from GET", async () => {
    fetchMock.mockResolvedValueOnce(ok([{
      id: "g1", code: "ALICE-PRO", plan_id: "pro", validity_months: 1,
      status: "assigned", assigned_at: "2026-08-22T00:00:00Z",
    }]));
    const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer jwt" } });
    const body = JSON.parse(r.body);
    expect(body.grant).toMatchObject({ code: "ALICE-PRO", planId: "pro", validityMonths: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("user_id=eq.u1");
  });

  it("redeems through the server RPC using the authenticated user id", async () => {
    fetchMock.mockResolvedValueOnce(ok({
      ok: true, code: "ALICE-PRO", plan_id: "pro", validity_months: 1,
      period_start: "2026-08-22T00:00:00Z", period_end: "2026-09-22T00:00:00Z",
    }));
    const r = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer jwt" },
      body: JSON.stringify({ code: "alice-pro" }),
    });
    expect(r.statusCode).toBe(200);
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain("/rpc/redeem_admin_coupon");
    expect(JSON.parse(call[1].body)).toEqual({ p_user_id: "u1", p_code: "ALICE-PRO" });
  });

  it("does not turn an active plan into a grant", async () => {
    fetchMock.mockResolvedValueOnce(ok({
      ok: false,
      code: "ACTIVE_ENTITLEMENT",
      error: "Your current plan is still active.",
    }));
    const r = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer jwt" },
      body: JSON.stringify({ code: "ALICE-PRO" }),
    });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).code).toBe("ACTIVE_ENTITLEMENT");
  });
});
