// netlify/functions/referral.test.js
//
// The referral loop grants real, paid quota, so the properties worth pinning
// are the ones that stop it being forged or farmed: a verified identity, a
// user id that never comes from the body, and a refusal that is reported as a
// refusal rather than swallowed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

async function loadHandler(user = { id: "user-1" }) {
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user
        ? { ok: true, user, client: {} }
        : { ok: false, status: 401, body: { error: "Authentication required" } },
    ),
  }));
  return (await import("../functions/referral.js")).handler;
}

const AUTH = { authorization: "Bearer t" };

describe("referral — identity", () => {
  it("refuses a guest with 401", async () => {
    // A referral grants paid quota; an anonymous identity can be re-made
    // without limit, so it is not something a reward can be attributed to.
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
  });

  it("NEVER takes the user id from the request body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, bonus: 25 }), { status: 200 }));
    const h = await loadHandler({ id: "real-user" });
    await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ code: "Q7BKM2XR", user_id: "victim", p_invitee_id: "victim" }),
    });
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("redeem_referral_code"));
    expect(JSON.parse(call[1].body).p_invitee_id).toBe("real-user");
  });

  it("does not let the caller choose the bonus amount", async () => {
    // Otherwise the "reward" is a number the beneficiary picks.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, bonus: 25 }), { status: 200 }));
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ code: "Q7BKM2XR", bonus: 100000, p_bonus: 100000 }),
    });
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("redeem_referral_code"));
    expect(JSON.parse(call[1].body).p_bonus).toBe(25);
  });
});

describe("referral — GET", () => {
  // ── 0079 — THE REWARD IS READ FROM THE LEDGER, NOT bonus_extractions ────
  // Grant rows are stored NEGATIVE (0037's convention: positive is
  // consumption), so the handler flips the sign. Asserting the old column
  // here would have gone green against a banner showing every referrer 0.
  it("returns the server-issued code and standing", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("issue_referral_code")) return new Response('"Q7BKM2XR"', { status: 200 });
      if (u.includes("referral_redemptions")) return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200 });
      if (u.includes("credit_ledger")) {
        return new Response(JSON.stringify([{ credits: -25 }, { credits: -25 }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
    const h = await loadHandler();
    const body = JSON.parse((await h({ httpMethod: "GET", headers: AUTH })).body);
    expect(body.code).toBe("Q7BKM2XR");
    expect(body.referrals).toBe(2);
    expect(body.bonus).toBe(50);
    expect(body.bonusPerReferral).toBe(25);
  });

  // ⚠️ It asks only for REFERRAL grants. Summing every grant would report a
  // customer's monthly allowance as something their invites earned them.
  it("counts only referral grants, not the monthly allowance", async () => {
    let ledgerQuery = "";
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("issue_referral_code")) return new Response('"Q7BKM2XR"', { status: 200 });
      if (u.includes("credit_ledger")) { ledgerQuery = u; return new Response("[]", { status: 200 }); }
      return new Response("[]", { status: 200 });
    });
    const h = await loadHandler();
    await h({ httpMethod: "GET", headers: AUTH });
    expect(ledgerQuery).toContain("reason=eq.grant");
    expect(ledgerQuery).toContain("referral-");
  });

  it("returns a NULL code when the store cannot answer, never a placeholder", async () => {
    // The bug this replaces shipped a fabricated code ("AAAAAAAA") to every
    // user. A null makes the banner render nothing, which is honest.
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const h = await loadHandler();
    const body = JSON.parse((await h({ httpMethod: "GET", headers: AUTH })).body);
    expect(body.code).toBeNull();
    expect(body.degraded).toBe(true);
  });

  it("returns a null code rather than 500 when Supabase is unconfigured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: AUTH });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).code).toBeNull();
  });
});

describe("referral — POST", () => {
  const post = (code) => ({ httpMethod: "POST", headers: AUTH, body: JSON.stringify({ code }) });

  it("redeems a valid code and reports the bonus", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, bonus: 25 }), { status: 200 }));
    const h = await loadHandler();
    const r = await h(post("Q7BKM2XR"));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, bonus: 25 });
  });

  it("requires a code", async () => {
    const h = await loadHandler();
    expect((await h(post(""))).statusCode).toBe(400);
  });

  it.each([
    ["self", "You can't redeem your own invite code."],
    ["already", "You've already used an invite code on this account."],
    ["invalid", "That invite code doesn't exist. Check it and try again."],
  ])("reports a %s refusal as 409 with copy the server owns", async (reason, copy) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, reason }), { status: 200 }));
    const h = await loadHandler();
    const r = await h(post("Q7BKM2XR"));
    expect(r.statusCode).toBe(409);
    const body = JSON.parse(r.body);
    expect(body.reason).toBe(reason);
    expect(body.error).toBe(copy);
  });

  it("reports an unreachable store as 503, NOT as a bad code", async () => {
    // A retryable outage must not be reported to the user as "that code
    // doesn't exist" — they would stop trying a code that is perfectly good.
    fetchMock.mockRejectedValue(new Error("network down"));
    const h = await loadHandler();
    const r = await h(post("Q7BKM2XR"));
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body).reason).toBe("unavailable");
  });

  it("rejects a malformed body", async () => {
    const h = await loadHandler();
    expect((await h({ httpMethod: "POST", headers: AUTH, body: "not json" })).statusCode).toBe(400);
  });
});

describe("referral — method guard", () => {
  it("rejects anything else with 405", async () => {
    const h = await loadHandler();
    expect((await h({ httpMethod: "DELETE", headers: AUTH })).statusCode).toBe(405);
  });
});
