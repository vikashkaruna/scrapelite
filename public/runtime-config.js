// runtime-config.js — RUNTIME endpoint overrides (read when the app loads, not
// baked in at build time like the VITE_* vars in .env).
//
// Why this exists: Vite inlines import.meta.env.VITE_* as string literals at
// BUILD time, so changing .env requires a rebuild/redeploy (and a restart in dev).
// Values set here are read at RUNTIME from this static file, so you can change an
// endpoint by editing this one file and reloading (dev) or redeploying just this
// file (prod) — no rebuild required.
//
// Precedence — ⚠️ THIS FILE WINS, FOR EVERY FIELD. It is the only input that
// can differ per deployment: a VITE_* var is inlined into the artifact at build
// time and is fixed for its whole life, whereas this file is read at load. A
// per-deployment input has to outrank a per-build one, or the environment
// routing below is decoration and editing supabaseUrl here silently does
// nothing on any deployment where a VITE_SUPABASE_URL is also set.
//
//   ⚠️ supabaseUrl / supabaseAnonKey used to be the EXCEPTION: the baked VITE_*
//   won, and this file was only consulted when the env var was missing or had
//   been redacted. That made every host-routing rule below unreachable wherever
//   a build also carried an env var — which is everywhere. The local Docker
//   stack shipped a bundle pointed at the hosted DEV project while its
//   api/jobs containers talked to the local database, so sign-up failed in a
//   foreign project's broken SMTP and every authenticated call 401'd. The
//   exception is gone; these two now behave like webhookUrl below.
//
// Leave a value as "" to fall back to the build-time .env value.
//
// None of this reaches the Netlify Functions: they read process.env only and
// never load this file. If a FUNCTION is using the wrong Supabase URL, the
// value is coming from the Netlify environment (SUPABASE_URL, falling back to
// VITE_SUPABASE_URL) — check /admin/health, which now prints the resolved URL
// and which variable supplied it.
//
// ── Environment routing (2026-08-10) ──────────────────────────────────────────
//
// FOUR classes of deployment are recognized, mapped to TWO Supabase projects:
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
//   4. GCP (2026-09-28)  — Firebase Hosting sites from the Netlify → GCP
//                          migration (docs/plans/gcp-docker-migration/). The
//                          staging site (datiq-vsp-fhs-stg.web.app) → DEV/STAGING
//                          Supabase; the production site (datiq-vsp-fhs-prod
//                          .web.app, listed in _GCP_PROD_HOSTS below) →
//                          PRODUCTION Supabase. Any other *.web.app /
//                          *.firebaseapp.com host falls to the dev project,
//                          exactly like a Netlify branch deploy.
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

// GCP production Firebase Hosting sites. Hosts listed here are served the
// PRODUCTION Supabase project and flagged isProduction. The GCP staging site
// (datiq-vsp-fhs-stg.web.app) is deliberately NOT listed — it behaves like a
// branch deploy. Add a host here ONLY when it serves production traffic.
var _GCP_PROD_HOSTS = ["datiq-vsp-fhs-prod.web.app"];
var _isGcpProd = _GCP_PROD_HOSTS.indexOf(location.hostname) !== -1;
var _isGcpHost =
  _isGcpProd ||
  /(^|\.)web\.app$/.test(location.hostname) ||
  /(^|\.)firebaseapp\.com$/.test(location.hostname);

// "Main" is the only deployment that uses the PRODUCTION Supabase project.
// Recognised on:
//   - https://datiq.app (custom primary)
//   - https://www.datiq.app (alternate)
//   - https://main--datiqapp.netlify.app (Netlify branch-deploy for main)
//   - the GCP production Firebase Hosting site (see _GCP_PROD_HOSTS)
var _isMain =
  location.hostname === "datiq.app" ||
  location.hostname === "www.datiq.app" ||
  location.hostname === "main--datiqapp.netlify.app" ||
  _isGcpProd;

// The production PRIMARY — the host OAuth/email callbacks return to. The GCP
// production twin is NOT the primary while it shadows Netlify: its
// authReturnUrl must be its own origin so callbacks land back on the twin.
var _isPrimary =
  location.hostname === "datiq.app" ||
  location.hostname === "www.datiq.app" ||
  location.hostname === "main--datiqapp.netlify.app";

// "Staging" gets its own explicit branch so future tooling (badges,
// feature flags, billing) can branch on it without re-deriving. GCP staging
// hosts (*.web.app / *.firebaseapp.com that are not the prod site) count.
var _isStaging =
  location.hostname === "staging.datiq.app" ||
  location.hostname === "staging--datiqapp.netlify.app" ||
  (_isGcpHost && !_isGcpProd);

// Supabase project selection: ONLY main → production. Everything else
// (staging, branch deploys, localhost) → the dev/staging project.
window.__DATIQ_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://vkaruna.app.n8n.cloud/webhook-test/datiq"
    : "https://vkaruna.app.n8n.cloud/webhook/datiq",
  emailApiUrl: "",
  // Razorpay publishable key override (runtime). Leave empty to use build-time VITE_RAZORPAY_KEY_ID.
  razorpayKeyId: "",
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
  // The staging key is the public/publishable key for the staging project.
  // Keeping it here makes branch deploys work even when a Netlify branch
  // build does not inherit VITE_SUPABASE_ANON_KEY from the UI environment.
  // `src/lib/runtimeConfigIdentity.test.js` verifies any value here belongs
  // to its paired project (publishable-format keys are accepted as-is).
  supabaseAnonKey: _isMain
    ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpa2tmeHlzamhpcm10d2t1bXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzAwNzMsImV4cCI6MjA5OTk0NjA3M30.z5XQxnmOqgVpPhUPRkIl5QIz932IRRj-ihkTVMfuqwM"
    : "sb_publishable_NXSVmJA_neFWqLGEiCmkEg_j8I03VLG",
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
  authReturnUrl: _isPrimary
    ? "https://datiq.app"
    : window.location.origin,
  // ── Google Analytics 4 ──────────────────────────────────────────────────
  // Read by public/analytics.js at RUNTIME, so the property can be repointed
  // by redeploying this one file — no rebuild.
  //
  // ⚠️ Absent key and empty string mean DIFFERENT things to analytics.js:
  //   - key missing entirely → it falls back to its built-in literal
  //     (the safety net for "runtime-config.js failed to load")
  //   - key present but ""   → deliberately DISABLED, no tag at all
  // So the branch below is what keeps staging and branch-deploy traffic OUT of
  // the production property. To start measuring a non-production environment,
  // create a SECOND GA4 property and put its id in the else-branch — do not
  // reuse the production id, or staging sessions become production sessions.
  gaMeasurementId: _isMain ? "G-B0DZLRWG63" : "",

  // ── PostHog ──────────────────────────────────────────────────────────────
  // Same absent-vs-empty contract as gaMeasurementId (see public/analytics.js):
  // an ABSENT key falls back to the loader's built-in literal, an EMPTY string
  // is a deliberate disable. Until 2026-09-28 the key existed ONLY as that
  // built-in literal, so PostHog fired on staging, branch deploys and
  // localhost. The empty branch below is the fix: only production sends.
  posthogKey: _isMain
    ? "phc_nGVqCMMbixTafmtb46bLZZakeEV2cpmEMQYf8uLVymUs"
    : "",
  posthogHost: "https://us.i.posthog.com",

  // Bumped whenever the cookie/analytics wording in the Privacy Policy changes
  // materially. Stamped onto every consent record so an old consent is
  // distinguishable from one given under the current policy.
  consentPolicyVersion: "2026-08-15",

  // Verification-only: lets analytics.js run against a localhost dev server,
  // which it otherwise skips entirely. Leave false in every committed state —
  // it exists so the consent flow can be observed in a browser, and it cannot
  // re-enable /admin or an empty measurement id.
  gaDebugLocal: false,

  // Boolean flags for feature gating (e.g. "disable billing on staging/branch deploys").
  isProduction: _isMain,
  isStaging: _isStaging,
};
