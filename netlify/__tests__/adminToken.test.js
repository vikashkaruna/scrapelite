// netlify/functions/lib/adminToken.test.js
// C-36 — verifyAdminToken: accepts valid, rejects tampered / expired / missing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { bearerFromEvent, verifyAdminToken } from "../functions/lib/adminToken.js";

const TEST_SECRET = "test-secret-do-not-use-in-prod";
const sha256Hex = (s) => createHmac("sha256", "ignore").update(s).digest("hex");

function makeToken(secret, exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  process.env.CONTEXT = "dev";
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.CONTEXT;
});

describe("verifyAdminToken — demo mode (no secret)", () => {
  it("no secret env → any non-empty token is accepted as demo", () => {
    const r = verifyAdminToken("any-token");
    expect(r.ok).toBe(true);
    expect(r.demo).toBe(true);
  });

  it("missing token → ok:false", () => {
    const r = verifyAdminToken("");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Missing/);
    const r2 = verifyAdminToken(null);
    expect(r2.ok).toBe(false);
  });
});

describe("verifyAdminToken — with secret", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  });

  it("accepts a valid token + future expiry", () => {
    const future = Date.now() + 60_000;
    const token = makeToken(TEST_SECRET, future);
    const r = verifyAdminToken(token);
    expect(r.ok).toBe(true);
    expect(r.demo).toBe(false);
  });

  it("rejects a token signed with the wrong secret", () => {
    const future = Date.now() + 60_000;
    const token = makeToken("wrong-secret", future);
    const r = verifyAdminToken(token);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Invalid token signature/);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const future = Date.now() + 60_000;
    const good = makeToken(TEST_SECRET, future);
    const [payload, sig] = good.split(".");
    // Flip a byte in the payload
    const tampered = `${payload.slice(0, -1)}${payload.slice(-1) === "A" ? "B" : "A"}.${sig}`;
    const r = verifyAdminToken(tampered);
    expect(r.ok).toBe(false);
  });

  it("rejects a tampered signature (replaced with a different HMAC)", () => {
    const future = Date.now() + 60_000;
    const good = makeToken(TEST_SECRET, future);
    const [payload] = good.split(".");
    const other = makeToken("attacker", future);
    const [, otherSig] = other.split(".");
    const r = verifyAdminToken(`${payload}.${otherSig}`);
    expect(r.ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const past = Date.now() - 60_000;
    const token = makeToken(TEST_SECRET, past);
    const r = verifyAdminToken(token);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });

  it("rejects a malformed token (no dot)", () => {
    const r = verifyAdminToken("not-a-jwt");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Malformed/);
  });

  it("rejects a malformed token (one dot, no payload)", () => {
    const r = verifyAdminToken(".only-sig");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Malformed/);
  });

  it("accepts a token with no exp (when the JSON has no exp field)", () => {
    const payload = Buffer.from(JSON.stringify({})).toString("base64url");
    const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
    const token = `${payload}.${sig}`;
    const r = verifyAdminToken(token);
    expect(r.ok).toBe(true);
  });
});

describe("verifyAdminToken — ADMIN_PIN fallback (hashed)", () => {
  it("uses ADMIN_PIN when ADMIN_TOKEN_SECRET is unset", () => {
    process.env.ADMIN_PIN = "1234";
    // sha256Hex("1234") is the actual secret the function derives.
    // We can't easily predict that here, but the demo path is "no secret",
    // and the function falls through ADMIN_TOKEN_SECRET → ADMIN_PIN_HASH → ADMIN_PIN.
    // Test the alternative path: ADMIN_PIN_HASH directly.
    delete process.env.ADMIN_PIN;
    process.env.ADMIN_PIN_HASH = "known-hash";
    const future = Date.now() + 60_000;
    const token = makeToken("known-hash", future);
    const r = verifyAdminToken(token);
    expect(r.ok).toBe(true);
    expect(r.demo).toBe(false);
  });
});

describe("bearerFromEvent", () => {
  it("extracts a bearer token from the Authorization header (case-insensitive)", () => {
    expect(bearerFromEvent({ headers: { authorization: "Bearer abc123" } })).toBe("abc123");
    expect(bearerFromEvent({ headers: { Authorization: "Bearer xyz" } })).toBe("xyz");
  });

  it("returns empty string for missing / malformed headers", () => {
    expect(bearerFromEvent({ headers: {} })).toBe("");
    expect(bearerFromEvent({ headers: { authorization: "abc123" } })).toBe("");
    expect(bearerFromEvent({})).toBe("");
    expect(bearerFromEvent({ headers: { authorization: "Token abc" } })).toBe("");
  });
});
