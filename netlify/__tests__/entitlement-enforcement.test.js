// entitlement-enforcement.test.js — proves the guard is actually WIRED IN.
//
// requireEntitlement.test.js proves the guard decides correctly. This file
// proves extract.js and ai.js call it, honour a denial, and place it at the
// right point in each handler. Those are separate failure modes: a guard that
// works but is never invoked is the more dangerous of the two, because the unit
// tests stay green.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ requireCapability: vi.fn() }));

vi.mock("../functions/lib/requireEntitlement.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requireCapability: guard.requireCapability };
});

const ALLOW = { resolved: {}, check: { allowed: true, code: null, remaining: Infinity } };
const DENY_SUSPENDED = {
  resolved: {},
  check: {
    allowed: false,
    code: "SUSPENDED",
    reason: "Your subscription lapsed on 1 Aug 2026. Renew to resume extractions and schedules.",
    remaining: 0,
    upgradeTo: null,
  },
};

let fetchMock;

beforeEach(() => {
  vi.resetModules();
  guard.requireCapability.mockReset();
  guard.requireCapability.mockResolvedValue(ALLOW);
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
    guard.requireCapability.mockResolvedValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "https://example.com" }));

    expect(r.statusCode).toBe(402);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("SUSPENDED");
    expect(body.lifecycle).toBe(true);
    expect(guard.requireCapability).toHaveBeenCalledWith(expect.anything(), "extract");
  });

  it("never calls a scrape provider once denied", async () => {
    guard.requireCapability.mockResolvedValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/extract.js");
    await handler(post({ url: "https://example.com" }));
    // Denial must short-circuit before any outbound provider request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks SSRF before entitlement, so a bad URL costs no DB round-trip", async () => {
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "http://127.0.0.1/admin" }));
    expect(r.statusCode).toBe(400);
    expect(guard.requireCapability).not.toHaveBeenCalled();
  });

  it("fails open if the guard itself throws", async () => {
    // An exception inside the entitlement path must not take extraction down.
    guard.requireCapability.mockRejectedValue(new Error("boom"));
    const { handler } = await import("../functions/extract.js");
    const r = await handler(post({ url: "https://example.com" }));
    expect(r.statusCode).not.toBe(402);
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
    guard.requireCapability.mockResolvedValue(DENY_SUSPENDED);
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages }));
    expect(r.statusCode).toBe(402);
    expect(JSON.parse(r.body).code).toBe("SUSPENDED");
    expect(guard.requireCapability).toHaveBeenCalledWith(expect.anything(), "ai");
  });

  it("validates the request body before the entitlement check", async () => {
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages: [] }));
    expect(r.statusCode).toBe(400);
    expect(guard.requireCapability).not.toHaveBeenCalled();
  });

  it("fails open if the guard itself throws", async () => {
    guard.requireCapability.mockRejectedValue(new Error("boom"));
    const { handler } = await import("../functions/ai.js");
    const r = await handler(post({ messages }));
    expect(r.statusCode).not.toBe(402);
  });
});
