// probeSupabaseAuth — anon-key validity, not just GoTrue liveness.
//
// The old probe hit /auth/v1/health ONLY. That endpoint is unauthenticated, so
// it answers 200 with a completely invalid apikey — which is why the
// /admin/health "supabase-auth" card stayed green for days while every
// auth.getUser() in the product failed with "Invalid API key" and users were
// told their sessions had expired. These tests pin the distinction.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { probeSupabaseAuth } from "../functions/lib/healthProbes.js";
import { HEALTH_STATUS } from "../../src/lib/healthModel.js";

const GOOD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpayload.sig";
const STRIPPED = "****************aB3d";
const URL_ = "https://proj.supabase.co";

const ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"];
let saved;
let fetchMock;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Liveness 200, then whatever the key check should answer. */
function wire({ keyStatus = 200, keyBody = {} } = {}) {
  fetchMock.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("/auth/v1/health")) {
      return new Response(JSON.stringify({ name: "GoTrue", version: "2.1" }), { status: 200 });
    }
    if (u.includes("/rest/v1/")) {
      return new Response(JSON.stringify(keyBody), { status: keyStatus });
    }
    return new Response("{}", { status: 200 });
  });
}

describe("probeSupabaseAuth", () => {
  it("reports not-configured when there is no URL at all", async () => {
    const r = await probeSupabaseAuth();
    expect(r.configured).toBe(false);
  });

  it("is healthy when GoTrue is live AND the anon key is accepted", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
    wire({ keyStatus: 200 });
    const r = await probeSupabaseAuth();
    expect(r.configured).toBe(true);
    expect(r.reachable).toBe(true);
    expect(r.status).toBeUndefined(); // no explicit override → classified ok
    expect(r.detail.anonKeyValid).toBe(true);
  });

  // THE REGRESSION: liveness passes, the key is rejected. The old probe
  // returned healthy here.
  it("goes DOWN when GoTrue is live but the anon key is rejected", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
    wire({ keyStatus: 401, keyBody: { message: "Invalid API key" } });
    const r = await probeSupabaseAuth();
    expect(r.status).toBe(HEALTH_STATUS.DOWN);
    expect(r.note).toMatch(/Invalid API key/);
    expect(r.note).toMatch(/SUPABASE_ANON_KEY/);
  });

  it("goes DOWN when the anon key was redacted by the secret scanner", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = STRIPPED;
    process.env.VITE_SUPABASE_ANON_KEY = STRIPPED;
    const r = await probeSupabaseAuth();
    expect(r.status).toBe(HEALTH_STATUS.DOWN);
    expect(r.note).toMatch(/SECRETS_SCAN_OMIT_KEYS/);
    // Reported without spending a network call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The house rule: "not checked" is never "down", in either direction.
  it("does NOT invent an outage when the anon key is simply absent", async () => {
    process.env.SUPABASE_URL = URL_;
    wire({ keyStatus: 200 });
    const r = await probeSupabaseAuth();
    expect(r.reachable).toBe(true);
    expect(r.status).not.toBe(HEALTH_STATUS.DOWN);
    expect(r.note).toMatch(/not checked/i);
  });

  it("reports 'not verified' rather than DOWN when the key check cannot complete", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/auth/v1/health")) {
        return new Response(JSON.stringify({ name: "GoTrue" }), { status: 200 });
      }
      throw new Error("connection reset");
    });
    const r = await probeSupabaseAuth();
    expect(r.status).not.toBe(HEALTH_STATUS.DOWN);
    expect(r.note).toMatch(/not verified/i);
  });

  it("uses the SAME key the functions would, skipping a redacted server var", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = STRIPPED;      // redacted → must be skipped
    process.env.VITE_SUPABASE_ANON_KEY = GOOD_KEY; // healthy → must be used
    wire({ keyStatus: 200 });
    const r = await probeSupabaseAuth();
    expect(r.detail.keySource).toBe("VITE_SUPABASE_ANON_KEY");
    expect(r.status).not.toBe(HEALTH_STATUS.DOWN);
  });

  it("never puts the raw key in the observation", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
    wire({ keyStatus: 401, keyBody: { message: "Invalid API key" } });
    const r = await probeSupabaseAuth();
    expect(JSON.stringify(r)).not.toContain(GOOD_KEY);
  });

  it("still reports DOWN when GoTrue itself errors", async () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const r = await probeSupabaseAuth();
    expect(r.status).toBe(HEALTH_STATUS.DOWN);
  });

  // The offline key/URL comparison — the check that finally resolved this.
  describe("offline identity diagnosis", () => {
    const KEY_FOR = (ref) => {
      const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({ iss: "supabase", ref, role: "anon", exp: 2099946073 }),
      ).toString("base64url");
      return `${h}.${p}.sig`;
    };

    it("names both projects on a ref mismatch, without any network call", async () => {
      process.env.SUPABASE_URL = "https://aubwooslkkrprdxuiyvj.supabase.co";
      process.env.SUPABASE_ANON_KEY = KEY_FOR("aubwooslkkyprdxuiyvj");
      const r = await probeSupabaseAuth();
      expect(r.status).toBe(HEALTH_STATUS.DOWN);
      expect(r.note).toContain("aubwooslkkrprdxuiyvj");
      expect(r.note).toContain("aubwooslkkyprdxuiyvj");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("surfaces the refs in detail so the card shows them side by side", async () => {
      process.env.SUPABASE_URL = "https://proj.supabase.co";
      process.env.SUPABASE_ANON_KEY = KEY_FOR("proj");
      wire({ keyStatus: 200 });
      const r = await probeSupabaseAuth();
      expect(r.detail).toMatchObject({ urlRef: "proj", keyRef: "proj", keyRole: "anon" });
    });

    // Production's fault. The old code answered "GoTrue returned HTTP 401",
    // which read as "the auth service is down" and sent debugging the wrong way.
    it("blames the key, not GoTrue, when the gateway 401s the liveness call", async () => {
      process.env.SUPABASE_URL = "https://api.datiq.app";
      process.env.SUPABASE_ANON_KEY = KEY_FOR("sikkfxysjhirmtwkumpt");
      fetchMock.mockResolvedValue(new Response("", { status: 401 }));
      const r = await probeSupabaseAuth();
      expect(r.status).toBe(HEALTH_STATUS.DOWN);
      expect(r.note).toMatch(/gateway rejected/i);
      expect(r.note).toMatch(/not necessarily down/i);
      // And it explains the custom-domain trap that caused it.
      expect(r.note).toMatch(/rest\/v1/);
    });

    it("does NOT short-circuit the live checks for a custom domain", async () => {
      // A full custom domain is legitimate — only the network can settle it,
      // so the probe must still ask rather than declaring it broken offline.
      process.env.SUPABASE_URL = "https://api.datiq.app";
      process.env.SUPABASE_ANON_KEY = KEY_FOR("sikkfxysjhirmtwkumpt");
      wire({ keyStatus: 200 });
      const r = await probeSupabaseAuth();
      expect(r.status).not.toBe(HEALTH_STATUS.DOWN);
      expect(fetchMock).toHaveBeenCalled();
    });

    it("reports a service_role key in the anon slot as DOWN", async () => {
      const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({ iss: "supabase", ref: "proj", role: "service_role", exp: 2099946073 }),
      ).toString("base64url");
      process.env.SUPABASE_URL = "https://proj.supabase.co";
      process.env.SUPABASE_ANON_KEY = `${h}.${p}.sig`;
      const r = await probeSupabaseAuth();
      expect(r.status).toBe(HEALTH_STATUS.DOWN);
      expect(r.note).toMatch(/Row Level Security/i);
    });
  });
});
