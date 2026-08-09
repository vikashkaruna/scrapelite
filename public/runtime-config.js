// runtime-config.js — RUNTIME endpoint overrides (read when the app loads, not
// baked in at build time like the VITE_* vars in .env).
//
// Why this exists: Vite inlines import.meta.env.VITE_* as string literals at
// BUILD time, so changing .env requires a rebuild/redeploy (and a restart in dev).
// Values set here are read at RUNTIME from this static file, so you can change an
// endpoint by editing this one file and reloading (dev) or redeploying just this
// file (prod) — no rebuild required.
//
// Precedence: a non-empty value here OVERRIDES the matching VITE_* value.
// Leave a value as "" to fall back to the build-time .env value.
// Auto-select the n8n MCP server URI based on environment.
// localhost → test endpoint (mcp-test); any other host → production endpoint (mcp).
// This file is read at runtime, so no rebuild is needed to switch environments.
//
// Why supabaseUrl / supabaseAnonKey live here too:
// The Netlify secret scanner's "smart detection" treats a Supabase anon key
// as a JWT-shaped secret and replaces the value with `****************<last4>`
// in the build output. This silently breaks OAuth login in production (the
// `supabase` client can't validate the JWT, no session is created, the user
// appears unlogged). The same is true of the n8n webhook URL.
//
// The runtime-config.js file is NOT scanned the same way — it's a static
// asset, not a build artifact, and the scanner's omit list already includes
// it (see netlify.toml SECRETS_SCAN_OMIT_PATHS). So we read the public-by-
// design Supabase anon key from here at runtime, falling back to the build-
// time VITE_SUPABASE_ANON_KEY if the runtime value is empty.
//
// The anon key is documented as "publishable" by Supabase — it's safe to
// commit; RLS protects data, not the key.
//
// See: docs/SESSION-HANDOFF-2026-07-29-OAUTH-CALLBACK-FIX.md.
var _isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
var _isStaging = location.hostname.startsWith("staging.");
window.__DATIQ_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://vkaruna.app.n8n.cloud/webhook-test/datiq"
    : "https://vkaruna.app.n8n.cloud/webhook/datiq",
  emailApiUrl: "",
  // Supabase project. The same env-aware pattern as webhookUrl above.
  // staging.datiq.app → DEV project, anything else → PROD project.
  supabaseUrl: _isStaging
    ? "https://aubwooslkkrprdxuiyvj.supabase.co"
    : "https://sikkfxysjhirmtwkumpt.supabase.co",
  // Supabase anon key (publishable JWT). One per project. These are public
  // by Supabase's own design — they identify the project, RLS enforces
  // authorization. If you ever rotate either project, update the matching
  // value here AND the Netlify env's VITE_SUPABASE_ANON_KEY.
  supabaseAnonKey: _isStaging
    ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1Yndvb3Nsa2tycHJkeHVpeXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2Mzc3MTAsImV4cCI6MjA5NjIxMzcxMH0.FJdHk7iwkFaz5m87kRQBHUh691RVAUkhgAoPXwJxcG4"
    : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpa2tmeHlzamhpcm10d2t1bXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzAwNzMsImV4cCI6MjA5OTk0NjA3M30.z5XQxnmOqgVpPhUPRkIl5QIz932IRRj-ihkTVMfuqwM",
};

