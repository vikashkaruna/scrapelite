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
//
// ── Environment routing (2026-08-10) ──────────────────────────────────────────
//
// THREE classes of deployment are recognized, mapped to TWO Supabase projects:
//
//   1. Main (production)  — datiq.app, www.datiq.app, main--datiqapp.netlify.app
//                          → PRODUCTION Supabase (sikkfxysjhirmtwkumpt)
//                          Uses the api.datiq.app custom auth domain.
//
//   2. Staging           — staging.datiq.app, staging--datiqapp.netlify.app
//                          → DEV/STAGING Supabase (aubwooslkkrprdxuiyvj)
//                          No custom auth domain (uses the project URL directly).
//
//   3. Branch deploys    — anything ending in `--datiqapp.netlify.app` that isn't
//                          the main or staging slot (e.g. feature--datiqapp.netlify.app,
//                          integration-with-outside-ecosystem--datiqapp.netlify.app)
//                          → DEV/STAGING Supabase (aubwooslkkrprdxuiyvj)
//                          Uses the project URL directly.
//
// Why this matters: before this change, the rule was "staging.* → dev, anything else
// → prod". A branch deploy like `integration-with-outside-ecosystem--datiqapp.netlify.app`
// didn't match `staging.*`, so it silently fell through to the PRODUCTION Supabase
// project. The production project uses a custom auth domain (api.datiq.app) whose
// OAuth callback redirects to the production primary (datiq.app) — so the user
// clicked "Sign in with Google" on the branch URL and got dumped on datiq.app.
// New rule: only `main` (datiq.app / main--datiqapp.netlify.app) uses production;
// everything else uses the dev/staging project, which has no custom auth domain,
// so OAuth callbacks land the user on whatever branch they came from.
//
// ── Why supabaseUrl / supabaseAnonKey live here too:
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

// "Main" is the only deployment that uses the PRODUCTION Supabase project.
// Recognised on:
//   - https://datiq.app (custom primary)
//   - https://www.datiq.app (alternate)
//   - https://main--datiqapp.netlify.app (Netlify branch-deploy for main)
var _isMain =
  location.hostname === "datiq.app" ||
  location.hostname === "www.datiq.app" ||
  location.hostname === "main--datiqapp.netlify.app";

// "Staging" gets its own explicit branch so future tooling (badges,
// feature flags, billing) can branch on it without re-deriving.
var _isStaging =
  location.hostname === "staging.datiq.app" ||
  location.hostname === "staging--datiqapp.netlify.app";

// Supabase project selection: ONLY main → production. Everything else
// (staging, branch deploys, localhost) → the dev/staging project.
window.__DATIQ_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://vkaruna.app.n8n.cloud/webhook-test/datiq"
    : "https://vkaruna.app.n8n.cloud/webhook/datiq",
  emailApiUrl: "",
  supabaseUrl: _isMain
    ? "https://sikkfxysjhirmtwkumpt.supabase.co"
    : "https://aubwooslkkrprdxuiyvj.supabase.co",
  // Supabase anon key (publishable JWT). One per project. These are public
  // by Supabase's own design — they identify the project, RLS enforces
  // authorization. If you ever rotate either project, update the matching
  // value here AND the Netlify env's VITE_SUPABASE_ANON_KEY.
  //
  // ⚠️ A key must belong to the project in `supabaseUrl` directly above.
  // The dev/staging value that used to sit here was issued for project
  // `aubwooslkkyprdxuiyvj` while the URL says `aubwooslkkrprdxuiyvj` — ONE
  // character apart, at position 11. Supabase answers "Invalid API key" and
  // names neither side, and since a project ref only appears base64-encoded
  // inside the JWT, no amount of reading this file revealed it. That cost
  // three debugging sessions across both environments.
  //
  // It is left EMPTY rather than guessed: `src/lib/config.js` then falls back
  // to the build-time VITE_SUPABASE_ANON_KEY, making the Netlify env the
  // single source for staging. To restore the belt-and-braces copy here,
  // paste the anon key from Supabase → project `aubwooslkkrprdxuiyvj` →
  // Settings → API. `src/lib/runtimeConfigIdentity.test.js` verifies any
  // value you put here actually belongs to its project.
  supabaseAnonKey: _isMain
    ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpa2tmeHlzamhpcm10d2t1bXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzAwNzMsImV4cCI6MjA5OTk0NjA3M30.z5XQxnmOqgVpPhUPRkIl5QIz932IRRj-ihkTVMfuqwM"
    : "",
  // The OAuth / email-confirmation / password-reset return URL for this
  // branch. The Supabase client passes this as `redirectTo` so the OAuth
  // provider (Google, Microsoft, GitHub) and the Supabase email-link
  // callbacks land the user on the SAME branch they started from.
  //
  //   - main → https://datiq.app (production primary — explicit exact URL)
  //   - staging → window.location.origin (staging.datiq.app or staging--…)
  //   - branch deploys → window.location.origin (e.g. integration-with-outside-ecosystem--…)
  //   - localhost → http://localhost:5173
  //
  // The Supabase project’s "Additional Redirect URLs" allowlist (configured
  // separately in the Supabase Dashboard) must include every value this can
  // take. See docs/SUPABASE-AUTH-REDIRECT-URLS.md for the master list.
  authReturnUrl: _isMain
    ? "https://datiq.app"
    : window.location.origin,
  // Boolean flags for feature gating (e.g. "disable billing on staging/branch deploys").
  isProduction: _isMain,
  isStaging: _isStaging,
};
