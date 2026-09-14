// guest-usage.test.js — POST /api/guest-usage reserves an anonymous batch credit.
//
// 🔴 It used to answer `{allowed: true, authenticated: true}` for ANY request
// carrying an Authorization header, without looking at the token — so the
// batch-run quota was one fake header away from unlimited.

import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticate = vi.fn();
const consume = vi.fn();
vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => authenticate(...a),
}));
vi.mock("../functions/lib/guestUsage.js", () => ({
  consumeGuestCredit: (...a) => consume(...a),
}));

const { handler } = await import("../functions/guest-usage.js");

const post = (headers = {}, body = { kind: "batch" }) => handler({
  httpMethod: "POST", headers, body: JSON.stringify(body),
});

describe("guest-usage", () => {
  beforeEach(() => {
    authenticate.mockReset();
    consume.mockReset();
    consume.mockResolvedValue({ allowed: true, remaining: 4, cookie: "datiq_guest_id=x", degraded: false });
  });

  it("exempts a VERIFIED signed-in caller without touching the guest quota", async () => {
    authenticate.mockResolvedValue({ ok: true, user: { id: "u1" } });
    const res = await post({ authorization: "Bearer real" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ allowed: true, authenticated: true });
    expect(consume).not.toHaveBeenCalled();
  });

  it("🔴 charges a forged or expired token like any guest", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401 });
    consume.mockResolvedValue({ allowed: false, remaining: 0, cookie: "datiq_guest_id=x", reason: "batch_limit_reached" });
    const res = await post({ authorization: "Bearer forged" });
    expect(consume).toHaveBeenCalledWith(expect.anything(), "batch");
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).authenticated).toBeUndefined();
  });

  it("charges a request with no token, and sets the identity cookie", async () => {
    const res = await post({}, { kind: "batch" });
    expect(authenticate).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(expect.anything(), "batch");
    expect(res.statusCode).toBe(200);
    expect(res.headers["Set-Cookie"]).toBe("datiq_guest_id=x");
  });

  it("defaults an unknown kind to a single credit", async () => {
    await post({}, { kind: "everything" });
    expect(consume).toHaveBeenCalledWith(expect.anything(), "single");
  });

  it("answers OPTIONS and refuses other methods", async () => {
    expect((await handler({ httpMethod: "OPTIONS" })).statusCode).toBe(204);
    expect((await handler({ httpMethod: "GET" })).statusCode).toBe(405);
  });
});
