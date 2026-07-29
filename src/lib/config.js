// config.js — single source of truth for which integrations are live.
// Each flag flips on automatically when its env var is present.

const env = import.meta.env;

// Runtime overrides from public/runtime-config.js (read when the app loads, NOT
// baked in at build time). A non-empty value here wins over the matching VITE_*.
const runtime = (typeof window !== "undefined" && window.__DATIQ_RUNTIME__) || {};

// Outbound endpoints must be absolute. A scheme-less value (e.g. "host.com/hook")
// would be fetched relative to the app's own origin and hit our 404 page instead
// of the real service, so we prepend https:// when the scheme is missing.
function ensureAbsolute(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

// Prefer the runtime override, fall back to the build-time .env value.
function endpoint(runtimeValue, envValue) {
  return ensureAbsolute(String(runtimeValue || "").trim() || envValue || "");
}

// The Netlify secret scanner's "smart detection" replaces JWT-shaped
// values with `****************<last4>` even when those values are
// supposed to be public (the Supabase anon key is the documented
// publishable key). Detect that redaction and prefer the runtime-config
// value (which the scanner never touches) so a stripped build still works.
// The check is purely structural — no real key ever matches the pattern.
function looksStrippedByNetlify(value) {
  if (typeof value !== "string") return false;
  // 16+ stars + 2-6 word chars = Netlify redaction fingerprint. Real anon
  // keys start with `eyJ` (base64 of `{"alg"...`), webhook URLs start with
  // `http`. A real value will never be a run of 16+ stars.
  return /^\*{16,}[A-Za-z0-9]{2,6}$/.test(value);
}

// Supabase project. Runtime config wins when the build-time value is the
// scanner's redaction pattern (defense in depth — the primary fix is in
// netlify.toml `SECRETS_SCAN_OMIT_KEYS`).
const _runtimeSupabaseUrl = String(runtime.supabaseUrl || "").trim();
const _envSupabaseUrl = String(env.VITE_SUPABASE_URL || "").trim();
export const SUPABASE_URL =
  (_envSupabaseUrl && !looksStrippedByNetlify(_envSupabaseUrl) ? _envSupabaseUrl : "") ||
  _runtimeSupabaseUrl ||
  "";

const _runtimeSupabaseAnon = String(runtime.supabaseAnonKey || "").trim();
const _envSupabaseAnon = String(env.VITE_SUPABASE_ANON_KEY || "").trim();
export const SUPABASE_ANON_KEY =
  (_envSupabaseAnon && !looksStrippedByNetlify(_envSupabaseAnon) ? _envSupabaseAnon : "") ||
  _runtimeSupabaseAnon ||
  "";
export const FIRECRAWL_API_KEY = env.VITE_FIRECRAWL_API_KEY || "";
// AI_API_KEY intentionally NOT exported from the browser bundle.
// The key lives server-side in the Netlify Function (AI_API_KEY env var, no VITE_ prefix).
// In production: set AI_API_KEY in Netlify dashboard (no VITE_ prefix).
// In local dev via `netlify dev`: VITE_AI_API_KEY in .env still works as a fallback in the function.
export const AI_MODEL = env.VITE_AI_MODEL || "claude-haiku-4-5-20251001";
// Scraping fallback provider keys (browser-side presence flags only — actual keys are server-side).
// Set VITE_SPIDER_API_KEY or VITE_JINA_API_KEY in Netlify env when using these providers.
// Set VITE_ENABLE_EXTRACT=true to force real extraction when only Jina/Direct is available.
const SPIDER_KEY_SET  = Boolean(env.VITE_SPIDER_API_KEY);
const JINA_KEY_SET    = Boolean(env.VITE_JINA_API_KEY);
const ENABLE_EXTRACT  = Boolean(env.VITE_ENABLE_EXTRACT);
export const WEBHOOK_URL = endpoint(runtime.webhookUrl, env.VITE_WEBHOOK_URL);
export const EMAIL_API_URL = endpoint(runtime.emailApiUrl, env.VITE_EMAIL_API_URL);

// Contact form delivery ──────────────────────────────────────────────────────
// /contact posts to POST /api/contact-email, which sends through Resend using
// the server-only RESEND_API_KEY — the same provider that already sends welcome,
// re-engagement, and schedule-alert mail. There is deliberately no browser-side
// key or endpoint config here: the destination inbox is resolved server-side
// from the enquiry type, so the client can't address the mail.

// Optional CRM/automation webhook fired in parallel with the contact email.
// Falls back to the generic n8n webhook so contact events flow there today; the
// dedicated endpoint gets wired in when the CRM pipeline is built.
export const CONTACT_WEBHOOK_URL = endpoint(
  runtime.contactWebhookUrl,
  env.VITE_CONTACT_WEBHOOK_URL
) || WEBHOOK_URL;

// Optional footer page links. When unset, the corresponding nav item is hidden.
export const LINK_ABOUT     = env.VITE_LINK_ABOUT     || "";
export const LINK_BLOG      = env.VITE_LINK_BLOG      || "";
export const LINK_PRICING   = env.VITE_LINK_PRICING   || "";
export const LINK_CHANGELOG = env.VITE_LINK_CHANGELOG || "";

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
// hasFirecrawl signals that real extraction is available (any provider will do).
// True when Firecrawl, Spider, or Jina keys are configured, or VITE_ENABLE_EXTRACT=true.
// The Netlify Function always falls back to Direct fetch (no key required), so set
// VITE_ENABLE_EXTRACT=true in Netlify env to enable real extraction without paid API keys.
export const hasFirecrawl = Boolean(
  FIRECRAWL_API_KEY || SPIDER_KEY_SET || JINA_KEY_SET || ENABLE_EXTRACT
);
// hasAI is always true — the actual key lives in the Netlify Function, not the browser.
// aiService.js will call /api/ai; the function returns 503 if AI_API_KEY is not set server-side.
export const hasAI = true;
export const hasWebhook = Boolean(WEBHOOK_URL);
export const hasEmail = Boolean(EMAIL_API_URL);
export const hasContactWebhook = Boolean(CONTACT_WEBHOOK_URL);

// Convenience summary used by the UI to show the current backend mode.
export const integrations = {
  supabase: hasSupabase,
  firecrawl: hasFirecrawl,
  ai: hasAI,
  webhook: hasWebhook,
};
