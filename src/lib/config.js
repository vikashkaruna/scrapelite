// config.js — single source of truth for which integrations are live.
// Each flag flips on automatically when its env var is present.

const env = import.meta.env;

export const SUPABASE_URL = env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || "";
export const FIRECRAWL_API_KEY = env.VITE_FIRECRAWL_API_KEY || "";
export const AI_API_KEY = env.VITE_AI_API_KEY || "";
export const AI_MODEL = env.VITE_AI_MODEL || "claude-haiku-4-5-20251001";
export const WEBHOOK_URL = env.VITE_WEBHOOK_URL || "";

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const hasFirecrawl = Boolean(FIRECRAWL_API_KEY);
export const hasAI = Boolean(AI_API_KEY);
export const hasWebhook = Boolean(WEBHOOK_URL);

// Convenience summary used by the UI to show the current backend mode.
export const integrations = {
  supabase: hasSupabase,
  firecrawl: hasFirecrawl,
  ai: hasAI,
  webhook: hasWebhook,
};
