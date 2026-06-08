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
export const AI_API_KEY = env.VITE_AI_API_KEY || "";
export const AI_MODEL = env.VITE_AI_MODEL || "claude-haiku-4-5-20251001";
export const WEBHOOK_URL = endpoint(runtime.webhookUrl, env.VITE_WEBHOOK_URL);
export const EMAIL_API_URL = endpoint(runtime.emailApiUrl, env.VITE_EMAIL_API_URL);

// Optional footer page links. When unset, the corresponding nav item is hidden.
export const LINK_ABOUT     = env.VITE_LINK_ABOUT     || "";
export const LINK_BLOG      = env.VITE_LINK_BLOG      || "";
export const LINK_PRICING   = env.VITE_LINK_PRICING   || "";
export const LINK_CHANGELOG = env.VITE_LINK_CHANGELOG || "";

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const hasFirecrawl = Boolean(FIRECRAWL_API_KEY);
export const hasAI = Boolean(AI_API_KEY);
export const hasWebhook = Boolean(WEBHOOK_URL);
export const hasEmail = Boolean(EMAIL_API_URL);

// Convenience summary used by the UI to show the current backend mode.
export const integrations = {
  supabase: hasSupabase,
  firecrawl: hasFirecrawl,
  ai: hasAI,
  webhook: hasWebhook,
};
