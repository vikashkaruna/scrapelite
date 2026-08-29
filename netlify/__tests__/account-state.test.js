// netlify/__tests__/account-state.test.js — the danger zone's contract.
//
// The three things that must never regress:
//   1. the user_id comes from the JWT, never from the body
//   2. deletion needs a typed confirmation, checked SERVER-side
//   3. nothing here deletes anything — it records intent and freezes

import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticate = vi.fn();
const state = vi.fn();
const setFrozen = vi.fn();
const requestDeletion = vi.fn();
const cancelDeletion = vi.fn();

vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => authenticate(...a),
}));
vi.mock("../functions/lib/accountState.js", () => ({
  getAccountState: (...a) => state(...a),
  setAccountFrozen: (...a) => setFrozen(...a),
  requestAccountDeletion: (...a) => requestDeletion(...a),
  cancelAccountDeletion: (...a) => cancelDeletion(...a),
}));

const { handler, DELETE_CONFIRMATION } = await import("../functions/account-state.js");

const call = (method, body, headers = { authorization: "Bearer t" }) =>
  handler({ httpMethod: method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  // This is authenticateBearer's REAL return shape ({ok, user, client}) — see
  // lib/supabaseServerClient.js. A prior version of this mock used {userId},
  // which is what the pre-fix account-state.js incorrectly expected after
  // passing authenticateBearer a bare header string instead of the full
  // event object; the mock matching the bug's own wrong contract is exactly
  // why this suite stayed green while /api/account-state 401'd on every real
  // request. Mocking to the ACTUAL shared-helper contract is what would have
  // caught it.
  authenticate.mockResolvedValue({ ok: true, user: { id: "user-1" }, client: {} });
  state.mockResolvedValue({ available: true, frozen: false });
  setFrozen.mockResolvedValue({ ok: true });
  requestDeletion.mockResolvedValue({ ok: true, purgeAfter: "2026-09-26T00:00:00Z", graceDays: 30 });
  cancelDeletion.mockResolvedValue({ ok: true });
});

describe("account-state — authentication", () => {
  it("refuses an anonymous caller", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401, body: { error: "Authentication required" } });
    const res = await call("GET");
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_REQUIRED");
  });

  it("calls authenticateBearer with the full event object, not just a header string", async () => {
    // The regression this whole file exists to catch: passing a bare string
    // instead of `event` makes the shared helper read `.headers` off a
    // string (always undefined), so it 401s unconditionally regardless of
    // whether the caller's JWT is valid.
    await call("GET");
    const [arg] = authenticate.mock.calls.at(-1);
    expect(typeof arg).toBe("object");
    expect(arg.headers).toBeTruthy();
  });

  it("resolves the user from the JWT, never from the body", async () => {
    // A caller that could name its own user_id could freeze — or schedule the
    // deletion of — somebody else's account. Same class of bug as
    // verify-payment.js once trusting a client-supplied planId.
    await call("POST", { action: "freeze", user_id: "victim", userId: "victim" });
    expect(setFrozen).toHaveBeenCalledWith("user-1", true, undefined);
  });
});

describe("account-state — freeze", () => {
  it("freezes", async () => {
    const res = await call("POST", { action: "freeze", reason: "holiday" });
    expect(res.statusCode).toBe(200);
    expect(setFrozen).toHaveBeenCalledWith("user-1", true, "holiday");
  });

  it("unfreezes", async () => {
    await call("POST", { action: "unfreeze" });
    expect(setFrozen).toHaveBeenCalledWith("user-1", false);
  });

  it("surfaces the deletion-pending interlock as guidance, not as a crash", async () => {
    // Unfreezing an account awaiting deletion is refused by the database,
    // because that would leave it consuming units with a purge date on it.
    // The user needs to be told what to do instead, not shown an error code.
    setFrozen.mockResolvedValue({ ok: false, error: "deletion_pending" });
    const res = await call("POST", { action: "unfreeze" });
    expect(res.statusCode).toBe(409);
    const b = JSON.parse(res.body);
    expect(b.code).toBe("deletion_pending");
    expect(b.error).toMatch(/cancel that first/i);
  });
});

describe("account-state — deletion", () => {
  it("refuses without the typed confirmation", async () => {
    const res = await call("POST", { action: "request_deletion" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("CONFIRMATION_REQUIRED");
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it("refuses a near-miss confirmation", async () => {
    // Case-sensitive on purpose: typing the word is meant to be a deliberate
    // act, and "delete" is what you type when you are not really reading.
    for (const bad of ["delete", "Delete", "DELETE ", "DELETE ACCOUNT", true, 1]) {
      const res = await call("POST", { action: "request_deletion", confirm: bad });
      expect(res.statusCode, `accepted ${JSON.stringify(bad)}`).toBe(400);
    }
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it("records the request with the exact confirmation", async () => {
    const res = await call("POST", { action: "request_deletion", confirm: DELETE_CONFIRMATION });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.graceDays).toBe(30);
    expect(b.purgeAfter).toBeTruthy();
    expect(requestDeletion).toHaveBeenCalledWith("user-1");
  });

  it("cancels a pending deletion", async () => {
    await call("POST", { action: "cancel_deletion" });
    expect(cancelDeletion).toHaveBeenCalledWith("user-1");
  });

  it("says so plainly when there is nothing to cancel", async () => {
    cancelDeletion.mockResolvedValue({ ok: false, error: "not_pending" });
    const res = await call("POST", { action: "cancel_deletion" });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/no pending deletion/i);
  });
});

describe("account-state — shape", () => {
  it("rejects an unknown action rather than doing something adjacent", async () => {
    const res = await call("POST", { action: "purge_now" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("UNKNOWN_ACTION");
    expect(requestDeletion).not.toHaveBeenCalled();
    expect(setFrozen).not.toHaveBeenCalled();
  });

  it("has no destructive action at all", async () => {
    // The whole point: this endpoint records intent. billing-purge.js — with
    // its five interlocks and its disarmed-by-default switch — remains the only
    // thing in the system that deletes a user.
    for (const action of ["delete", "purge", "destroy", "remove_account", "hard_delete"]) {
      const res = await call("POST", { action, confirm: DELETE_CONFIRMATION });
      expect(res.statusCode, `${action} was accepted`).toBe(400);
    }
  });

  it("never caches the state", async () => {
    const res = await call("GET");
    expect(res.headers["Cache-Control"]).toMatch(/no-store/);
  });

  it("rejects other methods", async () => {
    expect((await call("DELETE", {})).statusCode).toBe(405);
  });
});
