// supabaseServerClient — the shared env resolution + bearer authentication
// that eight functions used to hand-roll.
//
// These tests pin the two defects behind the 2026-08-13 outage, where every
// integration connect returned "Invalid or expired session (Invalid API key)":
//   1. a redacted SUPABASE_ANON_KEY beat a healthy VITE_SUPABASE_ANON_KEY
//   2. a server-side key/URL mismatch was reported to the user as a bad login
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockGetUser = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

const {
  looksStrippedByNetlify,
  maskKey,
  resolveSupabaseEnv,
  isInvalidApiKeyError,
  authenticateBearer,
  bearerToken,
} = await import("../functions/lib/supabaseServerClient.js");

// A realistic anon key shape: JWTs start with the base64 of {"alg"...
const GOOD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpayloadpayload.sig";
const OTHER_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.differentdifferent.sig";
// Netlify's secret scanner redaction fingerprint.
const STRIPPED = "****************aB3d";

const ENV_KEYS = [
  "SUPABASE_URL", "VITE_SUPABASE_URL",
  "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY",
];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  mockGetUser.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("looksStrippedByNetlify", () => {
  it("detects the scanner's redaction fingerprint", () => {
    expect(looksStrippedByNetlify(STRIPPED)).toBe(true);
    expect(looksStrippedByNetlify("*".repeat(32) + "9f2c")).toBe(true);
  });

  it("never flags a real key, URL, or non-string", () => {
    expect(looksStrippedByNetlify(GOOD_KEY)).toBe(false);
    expect(looksStrippedByNetlify("https://abc.supabase.co")).toBe(false);
    expect(looksStrippedByNetlify("")).toBe(false);
    expect(looksStrippedByNetlify(undefined)).toBe(false);
    expect(looksStrippedByNetlify(12345)).toBe(false);
    // Too few stars to be the fingerprint.
    expect(looksStrippedByNetlify("****abcd")).toBe(false);
  });
});

describe("maskKey", () => {
  it("fingerprints without leaking the key", () => {
    const masked = maskKey(GOOD_KEY);
    expect(masked).toContain(GOOD_KEY.slice(0, 3));
    expect(masked).toContain(GOOD_KEY.slice(-4));
    expect(masked).not.toContain(GOOD_KEY);
  });

  it("calls out a redacted value explicitly", () => {
    expect(maskKey(STRIPPED)).toMatch(/redacted/i);
  });

  it("reports an unset key as unset", () => {
    expect(maskKey("")).toBe("(unset)");
    expect(maskKey(undefined)).toBe("(unset)");
  });
});

describe("resolveSupabaseEnv", () => {
  it("prefers the server-side vars when both are healthy", () => {
    const r = resolveSupabaseEnv({
      SUPABASE_URL: "https://server.supabase.co",
      SUPABASE_ANON_KEY: GOOD_KEY,
      VITE_SUPABASE_URL: "https://browser.supabase.co",
      VITE_SUPABASE_ANON_KEY: OTHER_KEY,
    });
    expect(r.problem).toBeNull();
    expect(r.anonKey).toBe(GOOD_KEY);
    expect(r.keySource).toBe("SUPABASE_ANON_KEY");
  });

  // THE REGRESSION. The old `A || B` gave a redacted A precedence over a
  // healthy B, which is how a working anon key sat unused in the same
  // environment as the outage.
  it("skips a REDACTED SUPABASE_ANON_KEY in favour of a healthy VITE_ one", () => {
    const r = resolveSupabaseEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: STRIPPED,
      VITE_SUPABASE_ANON_KEY: GOOD_KEY,
    });
    expect(r.problem).toBeNull();
    expect(r.anonKey).toBe(GOOD_KEY);
    expect(r.keySource).toBe("VITE_SUPABASE_ANON_KEY");
  });

  it("reports key_stripped when EVERY candidate is redacted, naming them", () => {
    const r = resolveSupabaseEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: STRIPPED,
      VITE_SUPABASE_ANON_KEY: STRIPPED,
    });
    expect(r.problem).toBe("key_stripped");
    expect(r.message).toContain("SUPABASE_ANON_KEY");
    expect(r.message).toContain("SECRETS_SCAN_OMIT_KEYS");
  });

  it("distinguishes a missing key from a redacted one", () => {
    const r = resolveSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co" });
    expect(r.problem).toBe("missing_key");
    expect(r.message).toContain("SUPABASE_ANON_KEY");
  });

  it("reports a missing URL", () => {
    const r = resolveSupabaseEnv({ SUPABASE_ANON_KEY: GOOD_KEY });
    expect(r.problem).toBe("missing_url");
  });

  it("treats whitespace-only values as absent", () => {
    const r = resolveSupabaseEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "   ",
      VITE_SUPABASE_ANON_KEY: GOOD_KEY,
    });
    expect(r.anonKey).toBe(GOOD_KEY);
  });
});

describe("isInvalidApiKeyError", () => {
  it("matches GoTrue's wording, case-insensitively", () => {
    expect(isInvalidApiKeyError({ message: "Invalid API key" })).toBe(true);
    expect(isInvalidApiKeyError({ message: "invalid api key" })).toBe(true);
  });

  it("does not match a genuine session failure", () => {
    expect(isInvalidApiKeyError({ message: "JWT expired" })).toBe(false);
    expect(isInvalidApiKeyError({ message: "Auth session missing!" })).toBe(false);
    expect(isInvalidApiKeyError(null)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the JWT and tolerates casing/whitespace", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer   abc.def.ghi  ")).toBe("abc.def.ghi");
  });
  it("returns empty for a non-bearer header", () => {
    expect(bearerToken("Basic xyz")).toBe("");
    expect(bearerToken("")).toBe("");
  });
});

describe("authenticateBearer", () => {
  const evt = (auth) => ({ headers: auth ? { authorization: auth } : {} });

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = GOOD_KEY;
  });

  it("401s with no Authorization header", async () => {
    const r = await authenticateBearer(evt(null));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("401s when the header has no Bearer prefix", async () => {
    const r = await authenticateBearer(evt("just-a-token"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("passes the JWT EXPLICITLY to getUser (never the bare call)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe("u1");
    expect(mockGetUser).toHaveBeenCalledWith("jwt-123");
    expect(mockGetUser).not.toHaveBeenCalledWith();
  });

  // THE HEADLINE FIX. A key/URL mismatch is an operator fault; telling the
  // user their session expired sent three debugging sessions down the wrong
  // path while the token was valid every time.
  it("returns 503 — not 401 — when Supabase rejects the API key", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid API key" },
    });
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe("invalid_api_key");
    expect(r.body.error).toMatch(/SUPABASE_ANON_KEY/);
    expect(r.body.error).not.toMatch(/expired session/i);
  });

  it("never leaks the key in the 503 body", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null }, error: { message: "Invalid API key" },
    });
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.body.error).not.toContain(GOOD_KEY);
  });

  it("still 401s for a genuinely expired session, with the reason attached", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null }, error: { message: "JWT expired" },
    });
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("Invalid or expired session");
    expect(r.body.reason).toBe("JWT expired");
  });

  it("503s when the anon key is redacted, before any network call", async () => {
    process.env.SUPABASE_ANON_KEY = STRIPPED;
    process.env.VITE_SUPABASE_ANON_KEY = STRIPPED;
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe("key_stripped");
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("treats a THROWN getUser the same as a returned error", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    const r = await authenticateBearer(evt("Bearer jwt-123"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});
