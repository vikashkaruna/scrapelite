// aiProviders.js — Multi-provider LLM adapters + server-authoritative config.
//
// The app's enrichment AI (summaries, link categorization, content generation)
// is provider-agnostic. /api/ai walks an ordered fallback chain and uses the
// first provider that (a) is enabled, (b) has a key configured server-side, and
// (c) returns a successful response. Every adapter NORMALIZES its reply back to
// Anthropic's messages shape — { content: [{ type:"text", text }] } — so the
// browser (aiService.js) never needs to know which provider answered.
//
// Provider keys are SERVER-ONLY (never VITE_ prefix):
//   GEMINI_API_KEY      — Google Gemini (generativelanguage API)
//   AI_API_KEY          — Anthropic Claude (existing)
//   OPENAI_API_KEY      — OpenAI chat-completions
//
// Default model per provider may be overridden by env (GEMINI_MODEL, AI_MODEL,
// OPENAI_MODEL) or, in production, by the admin-managed Supabase `app_config`
// row (key 'ai'). Resolution order — operator config PREVAILS, env/static is the
// fallback — mirrors lib/pricingSource.js so the codebase has one pattern.

// ── Provider registry ──────────────────────────────────────────────────────────
// Each provider declares: default model, the env var holding its key, and a
// `call(messages, model, maxTokens, apiKey)` that returns { ok, status, text, error }.

const DEFAULT_MODELS = {
  gemini:    "gemini-2.5-flash",
  anthropic: "claude-3-5-haiku-20241022",
  openai:    "gpt-4o-mini",
};

// Cost-first default chain (no OpenRouter): Gemini → Anthropic → OpenAI.
export const DEFAULT_ORDER = ["gemini", "anthropic", "openai"];

export const PROVIDER_META = {
  gemini:    { label: "Google Gemini",   keyEnv: "GEMINI_API_KEY",          modelEnv: "GEMINI_MODEL" },
  anthropic: { label: "Anthropic Claude", keyEnv: "AI_API_KEY",             modelEnv: "AI_MODEL"     },
  openai:    { label: "OpenAI",           keyEnv: "OPENAI_API_KEY",         modelEnv: "OPENAI_MODEL" },
};

// Anthropic also accepts the legacy VITE_AI_API_KEY fallback (local `netlify dev`).
function keyFor(provider) {
  if (provider === "anthropic") {
    return process.env.AI_API_KEY || process.env.VITE_AI_API_KEY || "";
  }
  return process.env[PROVIDER_META[provider]?.keyEnv] || "";
}

// ── Adapters ─────────────────────────────────────────────────────────────────────

async function callAnthropic(messages, model, maxTokens, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.content || []).map((b) => b.text).filter(Boolean).join("\n").trim();
  return { ok: true, status: 200, text };
}

// OpenAI chat-completions. (OpenRouter — if re-added later — is wire-compatible.)
async function callOpenAI(messages, model, maxTokens, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return { ok: true, status: 200, text };
}

// Google Gemini generateContent. Anthropic-style messages → Gemini `contents`.
async function callGemini(messages, model, maxTokens, apiKey) {
  const contents = [];
  let systemText = "";
  for (const m of messages) {
    const text = typeof m.content === "string"
      ? m.content
      : (m.content || []).map((c) => c.text || "").join("\n");
    if (m.role === "system") { systemText += (systemText ? "\n" : "") + text; continue; }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n").trim();
  return { ok: true, status: 200, text };
}

const ADAPTERS = { gemini: callGemini, anthropic: callAnthropic, openai: callOpenAI };

// ── Server config (Supabase app_config 'ai' row → env → static defaults) ─────────
// Schema of the stored value:
//   { order: string[], models: { [provider]: string }, enabled: { [provider]: bool }, maxTokens: number }

async function fetchConfigRow() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_config?key=eq.ai&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.value || null;
  } catch {
    return null;
  }
}

function envOrder() {
  const raw = process.env.AI_PROVIDER_ORDER;
  if (!raw) return null;
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter((p) => PROVIDER_META[p]);
  return list.length ? list : null;
}

function defaults() {
  const models = {};
  const enabled = {};
  for (const p of Object.keys(PROVIDER_META)) {
    models[p] = process.env[PROVIDER_META[p].modelEnv] || DEFAULT_MODELS[p];
    enabled[p] = true;
  }
  return {
    order: envOrder() || DEFAULT_ORDER.slice(),
    models,
    enabled,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 1024,
  };
}

function merge(base, ov) {
  if (!ov || typeof ov !== "object") return base;
  const order = Array.isArray(ov.order)
    ? ov.order.map((s) => String(s).toLowerCase()).filter((p) => PROVIDER_META[p])
    : base.order;
  return {
    order: order.length ? order : base.order,
    models: { ...base.models, ...(ov.models || {}) },
    enabled: { ...base.enabled, ...(ov.enabled || {}) },
    maxTokens: Number(ov.maxTokens) > 0 ? Number(ov.maxTokens) : base.maxTokens,
  };
}

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

/** Resolve effective AI config (cached 60s per warm container). Never throws. */
export async function loadAiConfig() {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  const ov = await fetchConfigRow();
  _cache = merge(defaults(), ov);
  _cacheAt = now;
  return _cache;
}

/** Which providers have a key configured server-side (no secrets exposed). */
export function keyPresence() {
  const out = {};
  for (const p of Object.keys(PROVIDER_META)) out[p] = Boolean(keyFor(p));
  return out;
}

export const SUPABASE_CONFIGURED = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

/**
 * Run the fallback chain. Returns the first successful provider's normalized text.
 * @returns {Promise<{ ok, provider?, model?, text?, attempts, error? }>}
 */
export async function runChain(messages, clientMaxTokens) {
  const cfg = await loadAiConfig();
  const maxTokens = Number(clientMaxTokens) > 0 ? Number(clientMaxTokens) : cfg.maxTokens;
  const attempts = [];

  for (const provider of cfg.order) {
    if (cfg.enabled[provider] === false) continue;
    const apiKey = keyFor(provider);
    if (!apiKey) { attempts.push({ provider, skipped: "no-key" }); continue; }

    const model = cfg.models[provider] || DEFAULT_MODELS[provider];
    try {
      const r = await ADAPTERS[provider](messages, model, maxTokens, apiKey);
      if (r.ok && r.text) return { ok: true, provider, model, text: r.text, attempts };
      attempts.push({ provider, status: r.status, error: r.error || "empty response" });
    } catch (err) {
      attempts.push({ provider, error: err?.message || "fetch failed" });
    }
  }

  return { ok: false, attempts, error: "All AI providers failed or are unconfigured." };
}
