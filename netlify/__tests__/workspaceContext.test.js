// workspaceContext.test.js — resolveWorkspaceMembership / buildWorkspaceCtx
// in isolation. entitlement-enforcement.test.js proves extract.js/ai.js call
// this; workspace-member-pause.e2e.test.js proves a paused seat is actually
// refused end to end through the real can(). This file proves the lookup
// itself: membership found/not-found/paused, and the fail-open posture when
// the service key isn't configured or the request errors.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceMembership, buildWorkspaceCtx } from "../functions/lib/workspaceContext.js";

beforeEach(() => {
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubFetch = (status, body) => {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body ?? []), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("resolveWorkspaceMembership", () => {
  it("reports memberPaused:false for an active member", async () => {
    stubFetch(200, [{ paused_at: null }]);
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r).toEqual({ ok: true, memberPaused: false });
  });

  it("reports memberPaused:true for a paused member", async () => {
    stubFetch(200, [{ paused_at: "2026-08-01T00:00:00Z" }]);
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r).toEqual({ ok: true, memberPaused: true });
  });

  it("refuses a caller who has no membership row at all", async () => {
    stubFetch(200, []);
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WORKSPACE_NOT_MEMBER");
  });

  it("scopes the lookup to the caller's own user id, not a client-supplied one", async () => {
    const fetchMock = stubFetch(200, [{ paused_at: null }]);
    await resolveWorkspaceMembership("ws-1", "u1");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("workspace_id=eq.ws-1");
    expect(url).toContain("user_id=eq.u1");
  });

  it("fails open (not refused) when the service key is unconfigured", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r).toEqual({ ok: true, memberPaused: false });
  });

  it("fails open when the lookup itself errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r).toEqual({ ok: true, memberPaused: false });
  });

  it("fails open on a non-OK response (degraded, not refused)", async () => {
    stubFetch(500, {});
    const r = await resolveWorkspaceMembership("ws-1", "u1");
    expect(r).toEqual({ ok: true, memberPaused: false });
  });
});

describe("buildWorkspaceCtx", () => {
  it("returns an empty ctx and no refusal when no workspace id is supplied", async () => {
    const r = await buildWorkspaceCtx({ userId: "u1" }, undefined);
    expect(r).toEqual({ ctx: {}, refusal: null });
  });

  it("returns an empty ctx when the caller has no resolved user id (guest)", async () => {
    const r = await buildWorkspaceCtx({ userId: null }, "ws-1");
    expect(r).toEqual({ ctx: {}, refusal: null });
  });

  it("trims a workspace id and looks up membership", async () => {
    stubFetch(200, [{ paused_at: null }]);
    const r = await buildWorkspaceCtx({ userId: "u1" }, "  ws-1  ");
    expect(r).toEqual({ ctx: { memberPaused: false }, refusal: null });
  });

  it("surfaces a refusal instead of a ctx for a non-member", async () => {
    stubFetch(200, []);
    const r = await buildWorkspaceCtx({ userId: "u1" }, "ws-1");
    expect(r.ctx).toBeNull();
    expect(r.refusal.code).toBe("WORKSPACE_NOT_MEMBER");
  });
});
