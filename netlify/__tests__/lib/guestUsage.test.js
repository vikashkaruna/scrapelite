import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { consumeGuestCredit, _internal } from "../../functions/lib/guestUsage.js";

describe("guestUsage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a secure cookie and sends only a hash to the RPC", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ allowed: true, remaining: 9 }), { status: 200 }));
    const result = await consumeGuestCredit({ headers: {} }, "single");
    expect(result.allowed).toBe(true);
    expect(result.cookie).toMatch(/HttpOnly/);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.p_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.p_kind).toBe("single");
  });

  it("returns a denial without failing open when the RPC denies", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ allowed: false, reason: "single_limit_reached", remaining: 0 }), { status: 200 }));
    const result = await consumeGuestCredit({ headers: { cookie: `${_internal.COOKIE}=known` } });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("single_limit_reached");
  });

  it("fails open on a database outage while retaining the identity cookie", async () => {
    fetch.mockRejectedValue(new Error("down"));
    const result = await consumeGuestCredit({ headers: {} });
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.cookie).toContain(`${_internal.COOKIE}=`);
  });

  it("does not create or consume a guest identity for a VERIFIED user", async () => {
    const result = await consumeGuestCredit(
      { headers: { authorization: "Bearer user-jwt" } }, "single", { verifiedUserId: "user-1" },
    );
    expect(result.authenticated).toBe(true);
    expect(result.cookie).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  // 🔴 The header used to be enough. `Authorization: Bearer x` bought unlimited
  // guest extractions and audits, because this helper trusted its caller to
  // have verified a token nobody verified.
  it("charges an unverified Authorization header exactly like a guest", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ allowed: false, reason: "single_limit_reached", remaining: 0 }), { status: 200 }));
    const result = await consumeGuestCredit({ headers: { authorization: "Bearer forged" } }, "single");
    expect(result.authenticated).toBeUndefined();
    expect(result.allowed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the audit limit ONLY for audit credits", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ allowed: true, remaining: 0 }), { status: 200 }));
    await consumeGuestCredit({ headers: {} }, "audit");
    const audit = JSON.parse(fetch.mock.calls[0][1].body);
    expect(audit.p_kind).toBe("audit");
    expect(audit.p_audit_limit).toBe(_internal.DEFAULT_AUDIT_LIMIT);
    await consumeGuestCredit({ headers: {} }, "single");
    const single = JSON.parse(fetch.mock.calls[1][1].body);
    // A single credit must still resolve against a pre-0073 function signature.
    expect(single).not.toHaveProperty("p_audit_limit");
  });

  it("defaults guests to ONE free audit, overridable by env", () => {
    expect(_internal.limits({}).audit).toBe(1);
    expect(_internal.limits({ GUEST_AUDIT_HARD_LIMIT: "3" }).audit).toBe(3);
  });
});
