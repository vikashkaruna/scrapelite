// netlify/functions/workspaces.test.js
//
// A workspace membership is a real, billable seat (entitlementModel's
// workspace.team_seats gates it against the OWNER's plan), so the properties
// worth pinning are the same shape as referral.test.js: identity must come
// from the verified JWT (never the body), a plan-gated action must actually
// consult the entitlement, and a refusal reason must reach the client as the
// reason the database gave, not a generic 500.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;

const AGENCY_ENT = { plan_id: "agency", status: "active", source: "payment", period_end: "2999-01-01" };

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    // Default: an active Agency entitlement, so plan-gated actions succeed
    // unless a test overrides fetchMock itself.
    if (u.includes("/entitlements?")) return jsonRes([AGENCY_ENT]);
    if (u.includes("/workspace_members?")) return jsonRes([]);
    if (u.includes("/workspaces?")) return jsonRes([]);
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

async function loadHandler(user = { id: "user-1", email: "user-1@x.com" }) {
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user
        ? { ok: true, user, client: {} }
        : { ok: false, status: 401, body: { error: "Authentication required" } },
    ),
  }));
  return (await import("../functions/workspaces.js")).handler;
}

const AUTH = { authorization: "Bearer t" };

describe("workspaces — identity", () => {
  it("refuses a guest with 401 on GET", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
  });

  it("refuses a guest with 401 on POST", async () => {
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "create" }) });
    expect(r.statusCode).toBe(401);
  });

  it("mints the workspace for the AUTHENTICATED user, never a body-supplied one", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([AGENCY_ENT]);
      if (u.includes("/workspaces?")) return jsonRes([]);
      if (u.includes("rpc/create_workspace")) return jsonRes("ws-123");
      return jsonRes({});
    });
    const h = await loadHandler({ id: "real-user", email: "real@x.com" });
    await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "create", name: "Mine", p_owner_id: "victim" }),
    });
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("rpc/create_workspace"));
    expect(JSON.parse(call[1].body).p_owner_id).toBe("real-user");
  });
});

describe("workspaces — GET (list)", () => {
  it("returns this user's workspaces and whether they can create another", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([AGENCY_ENT]); // workspaces: 5
      if (u.includes("/workspace_members?select=workspace_id,role")) {
        return jsonRes([{ workspace_id: "ws-1", role: "owner" }]);
      }
      if (u.includes("/workspaces?select=id,name,owner_id,created_at")) {
        return jsonRes([{ id: "ws-1", name: "Acme", owner_id: "real-user", created_at: "2026-01-01" }]);
      }
      if (u.includes("/workspace_members?select=workspace_id&")) return jsonRes([{ workspace_id: "ws-1" }]);
      if (u.includes("/workspaces?select=id&owner_id=eq.")) return jsonRes([{ id: "ws-1" }]); // 1 owned
      return jsonRes({});
    });
    const h = await loadHandler({ id: "real-user", email: "real@x.com" });
    const r = await h({ httpMethod: "GET", headers: AUTH });
    const body = JSON.parse(r.body);
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].name).toBe("Acme");
    expect(body.canCreate.allowed).toBe(true); // owns 1 of 5
  });

  it("denies creating another workspace once the plan's cap is reached", async () => {
    const FREE_ENT = { plan_id: "free", status: "active" };
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([FREE_ENT]); // workspaces: 1
      if (u.includes("/workspace_members?select=workspace_id,role")) {
        return jsonRes([{ workspace_id: "ws-1", role: "owner" }]);
      }
      if (u.includes("/workspaces?select=id,name")) return jsonRes([{ id: "ws-1", name: "Only one", owner_id: "u", created_at: "x" }]);
      if (u.includes("/workspace_members?select=workspace_id&")) return jsonRes([{ workspace_id: "ws-1" }]);
      if (u.includes("/workspaces?select=id&owner_id=eq.")) return jsonRes([{ id: "ws-1" }]); // already owns 1
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: AUTH });
    const body = JSON.parse(r.body);
    expect(body.canCreate.allowed).toBe(false);
  });
});

describe("workspaces — GET (one workspace)", () => {
  it("refuses a non-member with 403, without leaking member data", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/workspace_members?select=role")) return jsonRes([]); // no membership row
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: AUTH, queryStringParameters: { workspaceId: "ws-1" } });
    expect(r.statusCode).toBe(403);
  });

  it("hides pending invites from a plain member", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/workspace_members?select=role")) return jsonRes([{ role: "member" }]);
      if (u.includes("/workspace_members?select=user_id,role")) {
        return jsonRes([{ user_id: "u", role: "member", created_at: "x", users: { email: "u@x.com" } }]);
      }
      if (u.includes("/workspace_invites?select=id,email")) {
        return jsonRes([{ id: "inv-1", email: "pending@x.com", role: "member", created_at: "x", expires_at: "y" }]);
      }
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", headers: AUTH, queryStringParameters: { workspaceId: "ws-1" } });
    const body = JSON.parse(r.body);
    expect(body.myRole).toBe("member");
    expect(body.members).toHaveLength(1);
    expect(body.invites).toHaveLength(0); // a member does not see who else is invited
  });
});

describe("workspaces — POST invite", () => {
  it("consults workspace.team_seats BEFORE calling the database", async () => {
    const SELECT_ENT = { plan_id: "select", status: "active" }; // team_seats: 1
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([SELECT_ENT]);
      if (u.includes("/workspace_members?select=id&workspace_id=eq.")) return jsonRes([{ id: "m1" }]); // 1 seat used already
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "invite", workspaceId: "ws-1", email: "friend@x.com" }),
    });
    expect(r.statusCode).toBe(402); // DENY_STATUS from requireEntitlement.js
    const rpcCall = fetchMock.mock.calls.find(([u]) => String(u).includes("rpc/create_workspace_invite"));
    expect(rpcCall).toBeUndefined(); // never reached the database
  });

  it("surfaces the database's refusal reason, not a generic error", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/entitlements?")) return jsonRes([AGENCY_ENT]);
      if (u.includes("/workspace_members?select=id&workspace_id=eq.")) return jsonRes([]);
      if (u.includes("rpc/create_workspace_invite")) return jsonRes({ ok: false, reason: "already_invited" });
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "invite", workspaceId: "ws-1", email: "friend@x.com" }),
    });
    const body = JSON.parse(r.body);
    expect(r.statusCode).toBe(409);
    expect(body.reason).toBe("already_invited");
  });
});

describe("workspaces — POST accept", () => {
  it("passes the CALLER'S verified email, never one from the body", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("rpc/accept_workspace_invite")) return jsonRes({ ok: true, workspaceId: "ws-1" });
      return jsonRes({});
    });
    const h = await loadHandler({ id: "real-user", email: "real@x.com" });
    await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "accept", token: "tok-1", p_user_email: "someone-else@x.com" }),
    });
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("rpc/accept_workspace_invite"));
    expect(JSON.parse(call[1].body).p_user_email).toBe("real@x.com");
  });

  it("reports email_mismatch as a 409 with the reason intact", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("rpc/accept_workspace_invite")) {
        return jsonRes({ ok: false, reason: "email_mismatch" });
      }
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: AUTH, body: JSON.stringify({ action: "accept", token: "tok-1" }) });
    const body = JSON.parse(r.body);
    expect(r.statusCode).toBe(409);
    expect(body.reason).toBe("email_mismatch");
  });
});

describe("workspaces — POST remove", () => {
  it("reports owner_cannot_leave distinctly", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("rpc/remove_workspace_member")) {
        return jsonRes({ ok: false, reason: "owner_cannot_leave" });
      }
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "remove", workspaceId: "ws-1", targetUserId: "user-1" }),
    });
    const body = JSON.parse(r.body);
    expect(r.statusCode).toBe(409);
    expect(body.reason).toBe("owner_cannot_leave");
  });
});

describe("workspaces — POST revoke_invite", () => {
  it("refuses a plain member with 403, without touching the database", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/workspace_members?select=role")) return jsonRes([{ role: "member" }]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "revoke_invite", workspaceId: "ws-1", inviteId: "inv-1" }),
    });
    expect(r.statusCode).toBe(403);
    const patchCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/workspace_invites?"));
    expect(patchCall).toBeUndefined();
  });
});

describe("workspaces — misc", () => {
  it("400s an unknown action", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", headers: AUTH, body: JSON.stringify({ action: "nonsense" }) });
    expect(r.statusCode).toBe(400);
  });

  it("405s any other method", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "DELETE", headers: AUTH });
    expect(r.statusCode).toBe(405);
  });
});
