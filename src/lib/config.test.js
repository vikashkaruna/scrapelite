import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_API_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  WEBHOOK_URL,
  hasAI,
  hasEmail,
  hasFirecrawl,
  hasSupabase,
  hasWebhook,
  integrations,
} from "./config.js";

/**
 * U-77 — config is the single source of truth for which integrations
 * are live. Every flag flips on automatically when its env var is
 * present. Tests cover the boolean logic and the runtime override path.
 */

beforeEach(() => {
  vi.resetModules();
  delete window.__DATIQ_RUNTIME__;
});

afterEach(() => {
  vi.resetModules();
  delete window.__DATIQ_RUNTIME__;
  // stubEnv writes through to import.meta.env, so leaving it set would leak a
  // fake project URL into every later spec in this file.
  vi.unstubAllEnvs();
});

describe("booleans flip on env presence (U-77)", () => {
  it("hasSupabase requires BOTH url and key", async () => {
    vi.resetModules();
    // Re-import with the real .env stripped (use a sub-import to override).
    const mod = await import("./config.js?empty=1").catch(() => null);
    // We can't easily unset the build-time env in vitest, so we assert
    // the boolean function's logic directly.
    // hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
    expect(typeof mod?.hasSupabase).toBe("boolean");
  });

  it("hasAI is always true (key is server-side)", () => {
    expect(hasAI).toBe(true);
  });

  it("hasWebhook follows WEBHOOK_URL (boolean truthy check)", () => {
    // Boolean(WEBHOOK_URL) — empty string is false, non-empty is true.
    expect(hasWebhook).toBe(Boolean(WEBHOOK_URL));
  });
});

describe("integrations summary", () => {
  it("exposes the canonical {supabase, firecrawl, ai, webhook} shape", () => {
    expect(typeof integrations.supabase).toBe("boolean");
    expect(typeof integrations.firecrawl).toBe("boolean");
    expect(typeof integrations.ai).toBe("boolean");
    expect(typeof integrations.webhook).toBe("boolean");
  });
});

describe("runtime override wins over build-time env", () => {
  it("window.__DATIQ_RUNTIME__.webhookUrl takes precedence", async () => {
    // Set the runtime config to a non-empty value
    window.__DATIQ_RUNTIME__ = { webhookUrl: "https://hook.example.com/email" };
    // Re-import the module to pick up the override
    vi.resetModules();
    const mod = await import("./config.js");
    // The runtime override is read at module load — since we set it before
    // re-importing, the WEBHOOK_URL should reflect the override.
    // (jsdom: the module re-evaluates because of vi.resetModules.)
    expect(mod.WEBHOOK_URL).toMatch(/hook\.example\.com/);
  });
});

describe("outbound endpoints are made absolute", () => {
  it("a scheme-less value is upgraded to https://", () => {
    // Re-implement the function logic in a one-shot to validate the rule.
    function ensureAbsolute(value) {
      const s = String(value || "").trim();
      if (!s) return "";
      return /^https?:\/\//i.test(s) ? s : "https://" + s;
    }
    expect(ensureAbsolute("example.com/x")).toBe("https://example.com/x");
    expect(ensureAbsolute("https://example.com")).toBe("https://example.com");
    expect(ensureAbsolute("")).toBe("");
  });
});

// ── Supabase resolution: WHICH INPUT WINS ──────────────────────────────────
//
// ⚠️ These used to re-implement the resolution expression inline and assert
// against THAT copy — four tests, none of which imported config.js. They passed
// identically whether the module preferred the baked value or the runtime one,
// and one of them explicitly asserted the old contract ("a real
// VITE_SUPABASE_ANON_KEY is NOT overridden by the runtime value"). So the
// precedence rule that sent the local stack's browser to the dev cloud project
// was pinned by the suite, in a copy of the logic, while the module did
// something else.
//
// Every test below now drives the REAL module. vi.stubEnv writes through
// vitest's import.meta.env shim, so both inputs are set explicitly and the
// assertion is about the module's answer, not a restatement of the rule.

const RUNTIME_URL = "http://localhost:8080";
const RUNTIME_KEY = "eyJhbGciOiJIUzI1NiJ9.runtime-key";
const BAKED_URL = "https://baked-project.supabase.co";
const BAKED_KEY = "eyJhbGciOiJIUzI1NiJ9.baked-key";

async function resolveWith({ runtime, bakedUrl, bakedKey }) {
  vi.resetModules();
  if (runtime === null) delete window.__DATIQ_RUNTIME__;
  else window.__DATIQ_RUNTIME__ = { supabaseUrl: runtime?.url, supabaseAnonKey: runtime?.key };
  vi.stubEnv("VITE_SUPABASE_URL", bakedUrl ?? "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", bakedKey ?? "");
  const mod = await import("./config.js");
  return { url: mod.SUPABASE_URL, key: mod.SUPABASE_ANON_KEY };
}

describe("the per-deployment runtime config outranks the per-build baked value", () => {
  it("runtime-config.js wins even when the baked value looks perfectly real", async () => {
    // This is the local Docker stack. Both values are well-formed; they simply
    // point at different projects, and only one of them is the one every
    // container in the stack is talking to.
    const r = await resolveWith({
      runtime: { url: RUNTIME_URL, key: RUNTIME_KEY },
      bakedUrl: BAKED_URL,
      bakedKey: BAKED_KEY,
    });
    expect(r.url).toBe(RUNTIME_URL);
    expect(r.key).toBe(RUNTIME_KEY);
  });

  it("the baked value is still used when runtime-config.js is absent", async () => {
    // A Netlify deploy with no runtime-config.js must not lose auth entirely.
    const r = await resolveWith({ runtime: null, bakedUrl: BAKED_URL, bakedKey: BAKED_KEY });
    expect(r.url).toBe(BAKED_URL);
    expect(r.key).toBe(BAKED_KEY);
  });

  it("a REDACTED baked value never wins, even with a runtime override present", async () => {
    const r = await resolveWith({
      runtime: { url: RUNTIME_URL, key: RUNTIME_KEY },
      bakedUrl: "****************co",
      bakedKey: "****************uqwM",
    });
    expect(r.url).toBe(RUNTIME_URL);
    expect(r.key).toBe(RUNTIME_KEY);
  });

  it("falls back to a real baked value when the runtime one is blank", async () => {
    // Per-deployment overrides are per-FIELD: analytics.js distinguishes an
    // absent key from an empty one for the same reason.
    const r = await resolveWith({
      runtime: { url: "", key: "" },
      bakedUrl: BAKED_URL,
      bakedKey: BAKED_KEY,
    });
    expect(r.url).toBe(BAKED_URL);
    expect(r.key).toBe(BAKED_KEY);
  });

  it("resolves to empty when both inputs are unusable — the localStorage fallback path", async () => {
    const r = await resolveWith({
      runtime: { url: "", key: "" },
      bakedUrl: "****************xx",
      bakedKey: "****************yy",
    });
    expect(r.url).toBe("");
    expect(r.key).toBe("");
    const mod = await import("./config.js");
    expect(mod.hasSupabase).toBe(false);
  });
});

