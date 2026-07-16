// netlify/functions/admin-general-config.test.js
// C-26 — GET merges DEFAULTS + saved; POST sanitises integer ranges; token-gated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
let handler;

const TEST_SECRET = "test-secret";
function makeAdminToken() {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.ADMIN_PIN_HASH;
  delete process.env.ADMIN_PIN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/admin-general-config.js");
  return mod.handler;
}

describe("admin-general-config GET (C-26)", () => {
  it("returns DEFAULTS when Supabase is unconfigured", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.settings).toEqual({
      guest_trial_soft_limit: 3,
      guest_trial_reprompt_interval: 2,
      guest_single_hard_limit: 10,
      guest_batch_hard_limit: 5,
    });
    expect(body.persisted).toBe(false);
  });

  it("merges DEFAULTS + saved overrides", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { value: { guest_trial_soft_limit: 7, guest_batch_hard_limit: 20 } },
        ]),
        { status: 200 },
      ),
    );
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    const body = JSON.parse(r.body);
    // Overrides applied
    expect(body.settings.guest_trial_soft_limit).toBe(7);
    expect(body.settings.guest_batch_hard_limit).toBe(20);
    // Non-overridden fields use DEFAULTS
    expect(body.settings.guest_trial_reprompt_interval).toBe(2);
    expect(body.settings.guest_single_hard_limit).toBe(10);
    expect(body.persisted).toBe(true);
  });
});

describe("admin-general-config POST (C-26)", () => {
  it("missing token → 401", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ settings: { guest_trial_soft_limit: 5 } }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("valid token + Supabase → 200 + persisted + sanitised values", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    // readFromSupabase returns empty array (no prior settings)
    // upsert returns 200
    fetchMock
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({
        settings: {
          guest_trial_soft_limit: 5,
          guest_trial_reprompt_interval: 3,
          guest_single_hard_limit: 20,
          guest_batch_hard_limit: 10,
        },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.persisted).toBe(true);
    expect(body.settings.guest_trial_soft_limit).toBe(5);
  });

  it("sanitises out-of-range integers", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    let captured = null;
    fetchMock
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockImplementationOnce(async (_url, init) => {
        captured = JSON.parse(init.body);
        return new Response("", { status: 200 });
      });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({
        settings: {
          guest_trial_soft_limit: 9999,      // out of range (1..100) — dropped
          guest_single_hard_limit: -1,        // out of range — dropped
          guest_batch_hard_limit: 7,         // in range — kept
        },
      }),
    });
    // The in-range value is persisted.
    expect(captured.value.guest_batch_hard_limit).toBe(7);
    // Out-of-range values are dropped. The merge with DEFAULTS + the empty
    // existing store means the dropped fields fall back to the DEFAULT value
    // (3 for soft_limit, 10 for single_hard_limit) — i.e. the sanitisation is
    // "we didn't take the user's value", not "we wiped the field".
    expect(captured.value.guest_trial_soft_limit).toBe(3);   // DEFAULT
    expect(captured.value.guest_single_hard_limit).toBe(10); // DEFAULT
  });

  it("all-out-of-range payload → 400 (nothing valid to save)", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({
        settings: {
          guest_trial_soft_limit: 9999,
          unknown_field: "x",
        },
      }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("invalid JSON → 400", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: "not json",
    });
    expect(r.statusCode).toBe(400);
  });

  it("Supabase unconfigured + valid token → 200 + persisted:false + warning", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ settings: { guest_trial_soft_limit: 5 } }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.persisted).toBe(false);
    expect(body.warning).toMatch(/Supabase not configured/);
  });

  it("partial update preserves the previously-stored fields (merge with existing)", async () => {
    process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    // readFromSupabase returns prior settings
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              value: {
                guest_trial_soft_limit: 4,
                guest_single_hard_limit: 15,
                guest_batch_hard_limit: 8,
              },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(async (_url, init) => {
        const sent = JSON.parse(init.body);
        // The partial update only changes soft_limit; the others must stay
        expect(sent.value.guest_trial_soft_limit).toBe(5);
        expect(sent.value.guest_single_hard_limit).toBe(15);
        expect(sent.value.guest_batch_hard_limit).toBe(8);
        return new Response("", { status: 200 });
      });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      body: JSON.stringify({ settings: { guest_trial_soft_limit: 5 } }),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("admin-general-config — method handling", () => {
  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});
