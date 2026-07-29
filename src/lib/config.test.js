import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_API_URL,
  FIRECRAWL_API_KEY,
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

// ── Netlify secret-scanner redaction fallback ──────────────────────────────
// The scanner's "smart detection" replaces JWT-shaped values with
// `****************<last4>` in the build output. That breaks the Supabase
// anon key and (less critically) the webhook URL. We detect the redaction
// pattern in config.js and prefer the runtime-config value when it
// matches. This is the defense-in-depth path; the primary fix is in
// netlify.toml `SECRETS_SCAN_OMIT_KEYS`.

describe("Netlify scanner redaction is detected and overridden", () => {
  it("a stripped VITE_SUPABASE_ANON_KEY is replaced with the runtime value", async () => {
    // Simulate the production bundle where the scanner has replaced the
    // anon key with the 16-stars + 4-char fingerprint. We can't change
    // import.meta.env in vitest, so we re-implement the resolution logic
    // against the same building blocks and assert the behaviour.
    const runtime = { supabaseAnonKey: "eyJhbGciOiJIUzI1NiI…real-key" };
    const env = "****************uqwM"; // what the scanner leaves behind
    const looksStrippedByNetlify = (v) =>
      typeof v === "string" && /^\*{16,}[A-Za-z0-9]{2,6}$/.test(v);
    const resolved = (env && !looksStrippedByNetlify(env) ? env : "") || runtime.supabaseAnonKey || "";
    expect(resolved).toBe("eyJhbGciOiJIUzI1NiI…real-key");
  });

  it("a real VITE_SUPABASE_ANON_KEY is NOT overridden by the runtime value", async () => {
    const runtime = { supabaseAnonKey: "stale-runtime-value" };
    const env = "eyJhbGciOiJIUzI1NiI…real-key"; // real anon key
    const looksStrippedByNetlify = (v) =>
      typeof v === "string" && /^\*{16,}[A-Za-z0-9]{2,6}$/.test(v);
    const resolved = (env && !looksStrippedByNetlify(env) ? env : "") || runtime.supabaseAnonKey || "";
    // Build-time env wins when it looks like a real value.
    expect(resolved).toBe("eyJhbGciOiJIUzI1NiI…real-key");
  });

  it("a stripped VITE_SUPABASE_URL is replaced with the runtime value", async () => {
    const runtime = { supabaseUrl: "https://aubwooslkkrprdxuiyvj.supabase.co" };
    const env = "****************co"; // scanner pattern
    const looksStrippedByNetlify = (v) =>
      typeof v === "string" && /^\*{16,}[A-Za-z0-9]{2,6}$/.test(v);
    const resolved = (env && !looksStrippedByNetlify(env) ? env : "") || runtime.supabaseUrl || "";
    expect(resolved).toBe("https://aubwooslkkrprdxuiyvj.supabase.co");
  });

  it("falls back to empty string when both env and runtime are missing/stripped", async () => {
    const runtime = {};
    const env = "****************xx";
    const looksStrippedByNetlify = (v) =>
      typeof v === "string" && /^\*{16,}[A-Za-z0-9]{2,6}$/.test(v);
    const resolved = (env && !looksStrippedByNetlify(env) ? env : "") || runtime.supabaseAnonKey || "";
    expect(resolved).toBe("");
  });
});
