// scripts/netlify-toml.test.mjs
//
// Guard tests for netlify.toml — these are the lines that, if removed or
// mis-edited, silently break production. They're cheap to run, catch
// regressions in seconds, and document WHY each line exists. Add to
// this file as we discover more "if this line is wrong, prod is down"
// invariants.
//
// Run with: npx vitest run scripts/netlify-toml.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const netlifyTomlPath = resolve(__dirname, "..", "netlify.toml");
const netlifyToml = readFileSync(netlifyTomlPath, "utf8");

describe("netlify.toml — secret scanner config", () => {
  it("has SECRETS_SCAN_OMIT_PATHS that includes runtime-config.js", () => {
    // public/runtime-config.js carries the env-override values that the
    // Supabase client reads at startup. If the scanner ever starts
    // scanning it, every value in there becomes `****************<last4>`
    // and the app falls back to the (also-stripped) build-time env vars.
    expect(netlifyToml).toMatch(/SECRETS_SCAN_OMIT_PATHS\s*=/);
    expect(netlifyToml).toMatch(/public\/runtime-config\.js/);
  });

  it("has SECRETS_SCAN_OMIT_KEYS that whitelists VITE_SUPABASE_ANON_KEY", () => {
    // Without this, the Netlify scanner's "smart detection" treats the
    // Supabase anon key as a JWT-shaped secret and replaces the value
    // with `****************<last4>`, which silently breaks OAuth login
    // in production. The anon key is the documented *publishable* key
    // (RLS protects data, not the key itself), so it's safe to ship.
    expect(netlifyToml).toMatch(/SECRETS_SCAN_OMIT_KEYS\s*=/);
    expect(netlifyToml).toMatch(/VITE_SUPABASE_ANON_KEY/);
  });

  it("whitelists the n8n webhook URL too (same false positive class)", () => {
    // The scanner also flags the n8n webhook URL because the path
    // contains token-shaped segments. Public endpoint, not a secret.
    expect(netlifyToml).toMatch(/VITE_WEBHOOK_URL/);
  });

  it("does NOT add [context.*.environment] blocks with placeholder values", () => {
    // Historical incident: the `5ca1345` commit added
    // `[context.production.environment]` with `https://PROD_REF.supabase.co`
    // placeholders. Netlify's precedence is UI < toml, so the toml
    // OVERRODE the UI values, shipping placeholder URLs to prod. We
    // learned that the hard way; this guard keeps us from re-adding it.
    expect(netlifyToml).not.toMatch(/\[context\.(production|staging|deploy-preview)\.environment\]/);
  });
});
