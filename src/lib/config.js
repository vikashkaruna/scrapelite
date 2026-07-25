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

export const SUPABASE_URL = env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || "";
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
// Web3Forms is the primary delivery path for /contact. Access keys are public by
// design (they ship in the form markup), so a default is baked in and any env or
// runtime value overrides it.
//
// A Web3Forms access key delivers to the single address it was registered with,
// so today both inboxes share one key and the submission carries `route_to` +
// a subject prefix for mailbox-side filtering. Register a second key for the
// admin inbox and set VITE_WEB3FORMS_ACCESS_KEY_ADMIN to split delivery for real
// — contactService picks the admin key up automatically, no code change needed.
const WEB3FORMS_DEFAULT_KEY = "d7378b9e-dce4-4f18-804a-3b6e8dc51719";
export const WEB3FORMS_ACCESS_KEY =
  String(runtime.web3formsAccessKey || "").trim() ||
  env.VITE_WEB3FORMS_ACCESS_KEY ||
  WEB3FORMS_DEFAULT_KEY;
export const WEB3FORMS_ACCESS_KEY_ADMIN =
  String(runtime.web3formsAccessKeyAdmin || "").trim() ||
  env.VITE_WEB3FORMS_ACCESS_KEY_ADMIN ||
  "";
export const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

// Optional CRM/automation webhook fired in parallel with the Web3Forms email.
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
export const hasWeb3Forms = Boolean(WEB3FORMS_ACCESS_KEY);
export const hasContactWebhook = Boolean(CONTACT_WEBHOOK_URL);

// Convenience summary used by the UI to show the current backend mode.
export const integrations = {
  supabase: hasSupabase,
  firecrawl: hasFirecrawl,
  ai: hasAI,
  webhook: hasWebhook,
};
