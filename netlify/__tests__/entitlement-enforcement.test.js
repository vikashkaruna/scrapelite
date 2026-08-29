// entitlement-enforcement.test.js — proves the guard is actually WIRED IN.
//
// requireEntitlement.test.js proves the guard decides correctly. This file
// proves extract.js and ai.js call it, honour a denial, and place it at the
// right point in each handler. Those are separate failure modes: a guard that
// works but is never invoked is the more dangerous of the two, because the unit
// tests stay green.
//
// extract.js/ai.js resolve entitlement via `resolveRequestEntitlement` +
// `checkCapability` (not the combined `requireCapability`) so they can inject
// a workspace-membership ctx between the two calls — see
// workspace-member-pause.test.js for that half. Mock the two split calls
// rather than the combined one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({
  resolveRequestEntitlement: vi.fn(),
  checkCapability: vi.fn(),
}));

vi.mock("../functions/lib/requireEntitlement.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveRequestEntitlement: guard.resolveRequestEntitlement,
    checkCapability: guard.checkCapability,
  };
});

const RESOLVED = { userId: "u1", guest: false, entitlement: {}, degraded: false, planMap: {} };
const ALLOW = { allowed: true, code: null, remaining: Infinity };
const DENY_SUSPENDED = {
  allowed: false,
  code: "SUSPENDED",
  reason: "Your subscription lapsed on 1 Aug 2026. Renew to resume extractions and schedules.",
  remaining: 0,
  upgradeTo: null,
};

let fetchMock;

beforeEach(() => {
  vi.resetModules();
  guard.resolveRequestEntitlement.mockReset();
  guard.checkCapability.mockReset();
  guard.resolveRequestEntitlement.mockResolvedValue(RESOLVED);
  guard.checkCapability.mockReturnValue(ALLOW);
  fetchMock = vi.fn();
  fetchMock.mockResolvedValue(new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body) => ({
  httpMethod: "POST",
  headers: { authorization: "Bearer jwt" },
  body: JSON.stringify(body),
});

describe("extract.js honours the subscription gate", () => {
  it("returns 402 with a lifecycle body for a suspended subscriber", async () => {
    guard.checkCapability.mockReturnValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "https://example.com" }));

    expect(r.statusCode).toBe(402);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("SUSPENDED");
    expect(body.lifecycle).toBe(true);
    expect(guard.checkCapability).toHaveBeenCalledWith(RESOLVED, "extract", expect.any(Object));
  });

  it("never calls a scrape provider once denied", async () => {
    guard.checkCapability.mockReturnValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/extract.js");
    await handler(post({ url: "https://example.com" }));
    // Denial must short-circuit before any outbound provider request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks SSRF before entitlement, so a bad URL costs no DB round-trip", async () => {
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "http://127.0.0.1/admin" }));
    expect(r.statusCode).toBe(400);
    expect(guard.resolveRequestEntitlement).not.toHaveBeenCalled();
  });

  it("fails open if the guard itself throws", async () => {
    // An exception inside the entitlement path must not take extraction down.
    guard.resolveRequestEntitlement.mockRejectedValue(new Error("boom"));
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "https://example.com" }));
    expect(r.statusCode).not.toBe(402);
  });

  it("refuses a workspace_id the caller isn't a member of, without touching quota", async () => {
    process.env.SUPABASE_URL = "https://db.example.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "https://example.com", workspaceId: "ws-1" }));
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).code).toBe("WORKSPACE_NOT_MEMBER");
    expect(guard.checkCapability).not.toHaveBeenCalled();
  });
});

describe("ai.js honours the subscription gate", () => {
  const messages = [{ role: "user", content: "hi" }];

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("returns 402 for a suspended subscriber", async () => {
    guard.checkCapability.mockReturnValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages }));
    expect(r.statusCode).toBe(402);
    expect(JSON.parse(r.body).code).toBe("SUSPENDED");
    expect(guard.checkCapability).toHaveBeenCalledWith(RESOLVED, "ai", expect.any(Object));
  });

  it("validates the request body before the entitlement check", async () => {
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages: [] }));
    expect(r.statusCode).toBe(400);
    expect(guard.resolveRequestEntitlement).not.toHaveBeenCalled();
  });

  it("fails open if the guard itself throws", async () => {
    guard.resolveRequestEntitlement.mockRejectedValue(new Error("boom"));
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages }));
    expect(r.statusCode).not.toBe(402);
  });

  it("refuses a workspace_id the caller isn't a member of", async () => {
    process.env.SUPABASE_URL = "https://db.example.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages, workspaceId: "ws-1" }));
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).code).toBe("WORKSPACE_NOT_MEMBER");
  });
});
