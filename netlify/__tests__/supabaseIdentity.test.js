// decodeSupabaseKey / projectRefFromUrl / diagnoseSupabaseIdentity —
// the offline check that answers "does this key belong to this URL?".
//
// Both live faults are pinned here with their real shapes:
//   - staging    : anon key issued for a project one character off the URL
//   - production : SUPABASE_URL set to the custom AUTH domain, which fronts
//                  /auth/v1 only and leaves every /rest/v1 call with nothing
//                  behind it
// Neither was visible from Supabase's own error, which is only ever the string
// "Invalid API key" — it names neither side of the comparison.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  decodeSupabaseKey,
  projectRefFromUrl,
  diagnoseSupabaseIdentity,
} from "../functions/lib/supabaseServerClient.js";

/** Build a Supabase-shaped anon key with the given claims. */
function makeKey({ ref, role = "anon", exp = 2099946073 }) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: "supabase", ref, role, iat: 1784370073, exp }),
  ).toString("base64url");
  return `${header}.${payload}.signaturenotverified`;
}

// The real production pair from public/runtime-config.js — these agree.
const PROD_REF = "sikkfxysjhirmtwkumpt";
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const PROD_KEY = makeKey({ ref: PROD_REF });

// The real staging pair. One character apart at position 11 (r vs y).
const STAGING_URL_REF = "aubwooslkkrprdxuiyvj";
const STAGING_KEY_REF = "aubwooslkkyprdxuiyvj";

const ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("decodeSupabaseKey", () => {
  it("reads ref, role and exp out of a legacy JWT key", () => {
    const c = decodeSupabaseKey(makeKey({ ref: "abc123", role: "anon", exp: 2099946073 }));
    expect(c).toMatchObject({ format: "jwt", ref: "abc123", role: "anon", exp: 2099946073 });
  });

  it("recognises the newer publishable format without trying to decode it", () => {
    expect(decodeSupabaseKey("sb_publishable_abc123").format).toBe("publishable");
    expect(decodeSupabaseKey("sb_secret_abc123").format).toBe("publishable");
  });

  it("never throws on junk", () => {
    for (const v of ["", null, undefined, 42, "not.a.jwt", "eyJ.brokenbase64.x", "a.b"]) {
      expect(() => decodeSupabaseKey(v)).not.toThrow();
    }
    expect(decodeSupabaseKey("").format).toBe("missing");
    expect(decodeSupabaseKey("a.b").format).toBe("unknown");
  });
});

describe("projectRefFromUrl", () => {
  it("extracts the ref from a project URL", () => {
    expect(projectRefFromUrl(PROD_URL)).toBe(PROD_REF);
  });

  it("returns null for a custom domain — a ref it cannot see is not a mismatch", () => {
    expect(projectRefFromUrl("https://api.datiq.app")).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(projectRefFromUrl("not a url")).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe("diagnoseSupabaseIdentity", () => {
  it("is clean when the key and URL agree", () => {
    const r = diagnoseSupabaseIdentity({ SUPABASE_URL: PROD_URL, SUPABASE_ANON_KEY: PROD_KEY });
    expect(r.problem).toBeNull();
    expect(r.detail).toMatchObject({ urlRef: PROD_REF, keyRef: PROD_REF, keyRole: "anon" });
  });

  // THE STAGING FAULT, with the exact refs that shipped.
  it("catches the one-character project mismatch and names BOTH projects", () => {
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: `https://${STAGING_URL_REF}.supabase.co`,
      SUPABASE_ANON_KEY: makeKey({ ref: STAGING_KEY_REF }),
    });
    expect(r.problem).toBe("ref_mismatch");
    // The whole point: say which is which, so the operator does not re-paste
    // the same wrong value a third time.
    expect(r.message).toContain(STAGING_URL_REF);
    expect(r.message).toContain(STAGING_KEY_REF);
    expect(r.detail).toMatchObject({ urlRef: STAGING_URL_REF, keyRef: STAGING_KEY_REF });
  });

  // THE PRODUCTION FAULT.
  it("flags a non-project SUPABASE_URL and explains the /rest/v1 consequence", () => {
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: "https://api.datiq.app",
      SUPABASE_ANON_KEY: PROD_KEY,
    });
    expect(r.problem).toBe("custom_domain");
    expect(r.message).toMatch(/rest\/v1/);
    expect(r.message).toMatch(/auth\/v1/);
  });

  it("treats a service_role key in an anon slot as the top-priority fault", () => {
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: PROD_URL,
      SUPABASE_ANON_KEY: makeKey({ ref: PROD_REF, role: "service_role" }),
    });
    expect(r.problem).toBe("service_role_in_anon_slot");
    expect(r.message).toMatch(/Row Level Security/i);
  });

  it("reports service_role even when the ref ALSO mismatches", () => {
    // Ordering matters: an RLS bypass shipped to browsers outranks a
    // connectivity problem.
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: `https://${STAGING_URL_REF}.supabase.co`,
      SUPABASE_ANON_KEY: makeKey({ ref: PROD_REF, role: "service_role" }),
    });
    expect(r.problem).toBe("service_role_in_anon_slot");
  });

  it("catches an expired key and prints the date", () => {
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: PROD_URL,
      SUPABASE_ANON_KEY: makeKey({ ref: PROD_REF, exp: 1600000000 }), // 2020
    });
    expect(r.problem).toBe("key_expired");
    expect(r.message).toContain("2020-09");
  });

  it("does not invent a mismatch for a publishable-format key", () => {
    // sb_publishable_… carries no ref, so there is nothing to compare. Claiming
    // a mismatch here would be a false alarm on a perfectly valid setup.
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: PROD_URL,
      SUPABASE_ANON_KEY: "sb_publishable_abc123",
    });
    expect(r.problem).toBeNull();
  });

  it("diagnoses whichever key the functions would actually use", () => {
    // A redacted server var must lose to a healthy VITE_ one — and the
    // diagnosis has to follow that same choice, or it reports on a key the
    // app never sends.
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: `https://${STAGING_URL_REF}.supabase.co`,
      SUPABASE_ANON_KEY: "****************aB3d",
      VITE_SUPABASE_ANON_KEY: makeKey({ ref: STAGING_KEY_REF }),
    });
    expect(r.problem).toBe("ref_mismatch");
    expect(r.detail.keySource).toBe("VITE_SUPABASE_ANON_KEY");
  });

  it("never puts the key itself in the message or detail", () => {
    const key = makeKey({ ref: STAGING_KEY_REF });
    const r = diagnoseSupabaseIdentity({
      SUPABASE_URL: `https://${STAGING_URL_REF}.supabase.co`,
      SUPABASE_ANON_KEY: key,
    });
    expect(JSON.stringify(r)).not.toContain(key);
  });
});
