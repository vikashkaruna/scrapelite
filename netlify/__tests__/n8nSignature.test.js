// netlify/__tests__/n8nSignature.test.js
//
// C-33 — HMAC signing of webhook payloads from DatIQ → self-hosted n8n.
// Replay window enforced via timestamp; constant-time signature compare.

import { describe, expect, it } from "vitest";
import { sign, verify, buildHeader, TOLERANCE_MS } from "../functions/lib/n8nSignature.js";

const SECRET = "test-shared-secret-xyz";
const BODY = JSON.stringify({ kind: "schedule.changed", id: "wfe_abc" });

describe("n8nSignature.sign", () => {
  it("returns a hex digest of expected length", () => {
    const s = sign(SECRET, BODY, 1700000000000);
    expect(s).toMatch(/^[0-9a-f]{64}$/); // sha256 → 64 hex chars
  });

  it("is deterministic for the same inputs", () => {
    const a = sign(SECRET, BODY, 1700000000000);
    const b = sign(SECRET, BODY, 1700000000000);
    expect(a).toBe(b);
  });

  it("changes when body changes", () => {
    const a = sign(SECRET, BODY, 1700000000000);
    const b = sign(SECRET, BODY + "x", 1700000000000);
    expect(a).not.toBe(b);
  });

  it("changes when secret changes", () => {
    const a = sign(SECRET, BODY, 1700000000000);
    const b = sign("different", BODY, 1700000000000);
    expect(a).not.toBe(b);
  });

  it("changes when timestamp changes", () => {
    const a = sign(SECRET, BODY, 1700000000000);
    const b = sign(SECRET, BODY, 1700000000001);
    expect(a).not.toBe(b);
  });

  it("throws on missing secret", () => {
    expect(() => sign("", BODY)).toThrow(/secret is required/);
  });

  it("throws when body is not a string", () => {
    expect(() => sign(SECRET, { foo: 1 })).toThrow(/rawBody must be a string/);
  });
});

describe("n8nSignature.buildHeader", () => {
  it("returns 't=<ms>,v1=<hex>' format", () => {
    const h = buildHeader(SECRET, BODY, 1700000000000);
    expect(h).toMatch(/^t=1700000000000,v1=[0-9a-f]{64}$/);
  });

  it("is verifiable with verify()", () => {
    const h = buildHeader(SECRET, BODY);
    const v = verify(SECRET, BODY, h);
    expect(v.ok).toBe(true);
  });
});

describe("n8nSignature.verify", () => {
  it("accepts a fresh valid signature", () => {
    const h = buildHeader(SECRET, BODY);
    const v = verify(SECRET, BODY, h);
    expect(v.ok).toBe(true);
  });

  it("rejects missing header", () => {
    const v = verify(SECRET, BODY, "");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("missing");
  });

  it("rejects malformed header (no t= prefix)", () => {
    const v = verify(SECRET, BODY, "garbage");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("malformed");
  });

  it("rejects malformed header (no v1= prefix)", () => {
    const v = verify(SECRET, BODY, "t=1700000000000");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("malformed");
  });

  it("rejects expired timestamp (older than tolerance)", () => {
    const old = Date.now() - TOLERANCE_MS - 1000;
    const h = buildHeader(SECRET, BODY, old);
    const v = verify(SECRET, BODY, h);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("rejects future timestamp beyond tolerance", () => {
    const future = Date.now() + TOLERANCE_MS + 1000;
    const h = buildHeader(SECRET, BODY, future);
    const v = verify(SECRET, BODY, h);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("rejects wrong secret", () => {
    const h = buildHeader("right-secret", BODY);
    const v = verify("wrong-secret", BODY, h);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad_sig");
  });

  it("rejects tampered body", () => {
    const h = buildHeader(SECRET, BODY);
    const v = verify(SECRET, BODY + "tampered", h);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad_sig");
  });

  it("rejects signature with wrong length (different algorithm)", () => {
    // Build a header with a 32-char sig (md5-ish) — wrong length, should fail.
    const v = verify(SECRET, BODY, `t=${Date.now()},v1=abcdef0123456789abcdef0123456789`);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad_sig");
  });

  it("uses timingSafeEqual (constant-time compare)", () => {
    // Indirect: verify the same signature on the same body yields ok:true
    // regardless of position, and a wrong sig with the same length yields
    // bad_sig (proving we got past the length check, into the compare).
    const h = buildHeader(SECRET, BODY);
    const [tsPart, sigPart] = h.split(",v1=");
    // Flip one hex char in the middle of the sig.
    const flipped =
      sigPart.slice(0, 10) +
      (sigPart[10] === "0" ? "1" : "0") +
      sigPart.slice(11);
    const tampered = `${tsPart},v1=${flipped}`;
    const v = verify(SECRET, BODY, tampered);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad_sig");
  });

  it("respects a custom tolerance window", () => {
    const ts = Date.now() - 2000; // 2s old
    const h = buildHeader(SECRET, BODY, ts);
    // Default 5 min: passes
    expect(verify(SECRET, BODY, h).ok).toBe(true);
    // 1s tolerance: fails
    const v = verify(SECRET, BODY, h, 1000);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("rejects when secret is missing on the verifier side", () => {
    const h = buildHeader(SECRET, BODY);
    const v = verify("", BODY, h);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("missing_secret");
  });
});
