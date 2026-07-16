// netlify/functions/admin-auth.test.js
// C-23 — Correct PIN (hash match) → token; wrong PIN → 401; demo flag returned.
// C-24 — Admin bypass via header injection rejected.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const REAL_PIN = "1d3c4a-real-strong-pin-do-not-use-in-prod";
const REAL_PIN_HASH = sha256(REAL_PIN);

let handler;

beforeEach(() => {
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.ADMIN_TOKEN_SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.ADMIN_TOKEN_SECRET;
});

async function loadHandler() {
  const mod = await import("../functions/admin-auth.js");
  return mod.handler;
}

describe("admin-auth — hash-match (C-23)", () => {
  beforeEach(() => {
    process.env.ADMIN_PIN_HASH = REAL_PIN_HASH;
  });

  it("correct PIN (matches the hash) → 200 + token + exp", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: REAL_PIN }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^[^.]+\.[^.]+$/); // base64url.base64url
    expect(typeof body.exp).toBe("number");
    expect(body.exp).toBeGreaterThan(Date.now());
  });

  it("correct PIN — demo:false (real env hash configured)", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: REAL_PIN }),
    });
    const body = JSON.parse(r.body);
    expect(body.demo).toBe(false);
  });

  it("wrong PIN → 401 + BAD_PIN code", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: "wrong-pin" }),
    });
    expect(r.statusCode).toBe(401);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("BAD_PIN");
  });

  it("missing PIN → 400 + MISSING_PIN", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({}) });
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("MISSING_PIN");
  });

  it("invalid JSON body → 400 + MISSING_PIN", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "not json" });
    expect(r.statusCode).toBe(400);
  });

  it("ADMIN_PIN (plaintext) fallback also works", async () => {
    delete process.env.ADMIN_PIN_HASH;
    process.env.ADMIN_PIN = REAL_PIN;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: REAL_PIN }),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("admin-auth — demo mode (no env PIN)", () => {
  it("accepts the documented demo PIN ADMIN123 when no real PIN is set", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: "ADMIN123" }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.demo).toBe(true);
  });

  it("rejects a wrong PIN even in demo mode", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ pin: "not-admin123" }),
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("admin-auth — header-injection bypass (C-24, FR-X-06)", () => {
  beforeEach(() => {
    process.env.ADMIN_PIN_HASH = REAL_PIN_HASH;
  });

  it("a fake 'x-admin-bypass' header does not grant access without a valid PIN", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: {
        "x-admin-bypass": "true",
        "x-admin": "yes",
        "x-debug-admin": "1",
        "x-internal-pin": REAL_PIN, // attacker tries to inject the real PIN via header
      },
      body: JSON.stringify({ pin: "" }),
    });
    // Either 400 (missing PIN) or 401 (bad PIN) — never 200
    expect([400, 401]).toContain(r.statusCode);
    const body = JSON.parse(r.body);
    expect(body.ok).toBeFalsy();
  });

  it("a valid PIN with no bypass header still authenticates", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { "x-admin-bypass": "true" }, // header ignored
      body: JSON.stringify({ pin: REAL_PIN }),
    });
    // The bypass header is ignored, but the real PIN still works
    expect(r.statusCode).toBe(200);
  });
});

describe("admin-auth — method handling", () => {
  it("GET / PUT / DELETE → 405", async () => {
    const h = await loadHandler();
    for (const m of ["GET", "PUT", "DELETE", "PATCH"]) {
      const r = await h({ httpMethod: m, body: "{}" });
      expect(r.statusCode).toBe(405);
    }
  });

  it("OPTIONS → 200 (CORS preflight)", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
