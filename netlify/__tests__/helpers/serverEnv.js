// netlify/__tests__/helpers/serverEnv.js
//
// One authoritative list of the server-side environment variables the Netlify
// Functions read, plus a helper to clear them.
//
// ── Why this exists ──────────────────────────────────────────────────────
// Vitest loads .env into process.env. A developer with a real .env — which the
// project README tells them to have — therefore runs the contract suite with
// LIVE credentials injected, while CI runs it with none. Three tests failed
// only on a populated machine, and passed in a worktree without .env:
//
//   healthProbes P-03            "reports the GoTrue version"
//   admin-health AH-02           "stays merely degraded …"
//   integrations-notion          "503s with the variable named …"
//
// Each of those files DID clear env vars in beforeEach — just not the same
// ones, and none of them cleared VITE_SUPABASE_URL. supabaseServerClient.js
// resolves `SUPABASE_URL || VITE_SUPABASE_URL` and diagnoseSupabaseIdentity()
// compares the two projects, so a leaked VITE_SUPABASE_URL made the probe
// report an identity mismatch instead of the GoTrue version it was asked for.
//
// Three hand-maintained lists in three files will always drift. This is one
// list, derived from what the code actually reads, imported by all of them.
//
// The rule: a test that exercises env-dependent code owns the env for that
// test. Inheriting the developer's machine is not a fixture.

/**
 * Everything supabaseServerClient.js resolves. Keep in sync with it — the
 * URL/key pairs matter as PAIRS: clearing only one half leaves the resolver
 * comparing a test value against a leaked one.
 */
export const SUPABASE_ENV_KEYS = [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
];

/** Third-party service credentials read by the functions. */
export const SERVICE_ENV_KEYS = [
  "NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID", "SITE_ID",
  "RESEND_API_KEY",
  "GEMINI_API_KEY", "AI_API_KEY", "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY", "VITE_FIRECRAWL_API_KEY", "SPIDER_API_KEY", "JINA_API_KEY",
  "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "ADMIN_PIN", "ADMIN_PIN_HASH", "ADMIN_TOKEN_SECRET",
  "N8N_BASE_URL", "N8N_WEBHOOK_SECRET", "WORKFLOW_ORCHESTRATOR_TOKEN",
];

/** Netlify deploy-context vars that change what a probe reports. */
export const CONTEXT_ENV_KEYS = [
  "CONTEXT", "SITE_NAME", "BRANCH", "DEPLOY_ID", "DEPLOY_PRIME_URL",
  "AWS_REGION", "URL", "SITE_URL",
  "PURGE_ENABLED", "PURGE_DRY_RUN", "OPS_JOBS_DISABLED",
  "SUPABASE_PROJECT_NAME", "OPS_ALERT_EMAIL",
];

export const ALL_SERVER_ENV_KEYS = [
  ...SUPABASE_ENV_KEYS,
  ...SERVICE_ENV_KEYS,
  ...CONTEXT_ENV_KEYS,
];

/**
 * Delete every server env var so the test starts from "nothing configured"
 * and sets only what it means to exercise.
 *
 * @param {string[]} [keys] override the list (defaults to all of them)
 */
export function clearServerEnv(keys = ALL_SERVER_ENV_KEYS) {
  for (const k of keys) delete process.env[k];
}
