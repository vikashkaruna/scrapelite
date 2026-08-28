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
  gemini:     "gemini-2.5-flash",
  anthropic:  "claude-3-5-haiku-20241022",
  openai:     "gpt-4o-mini",
  perplexity: "sonar",
};

// Cost-first default chain (no OpenRouter): Gemini → Anthropic → OpenAI.
// Perplexity is deliberately NOT in the default/global order — it's a live
// retrieval engine, priced and rate-limited differently, and its real value
// (citation URLs) only shows up through the discoverability pillar's own
// citation-sampling call (see lib/audit/citationSampling.js). It is still a
// full PROVIDER_META/ADAPTERS member so it can be added to any pillar's own
// `order` from /admin/ai — see PILLARS below.
export const DEFAULT_ORDER = ["gemini", "anthropic", "openai"];

export const PROVIDER_META = {
  gemini:     { label: "Google Gemini",   keyEnv: "GEMINI_API_KEY",     modelEnv: "GEMINI_MODEL" },
  anthropic:  { label: "Anthropic Claude", keyEnv: "AI_API_KEY",        modelEnv: "AI_MODEL"     },
  openai:     { label: "OpenAI",           keyEnv: "OPENAI_API_KEY",    modelEnv: "OPENAI_MODEL" },
  perplexity: { label: "Perplexity",       keyEnv: "PERPLEXITY_API_KEY", modelEnv: "PERPLEXITY_MODEL" },
};

// Named "pillars" a module can request its own chain override for. An
// override is entirely optional per pillar — omit it and that module falls
// back to the global/default chain above (see resolvePillarChain()). Keep
// this allowlist in sync with admin-ai-config.js's sanitize(), which rejects
// any pillar key not in this list rather than storing arbitrary keys.
export const PILLAR_KEYS = ["discoverability"];

// Anthropic also accepts the legacy VITE_AI_API_KEY fallback (local `netlify dev`).
function keyFor(provider) {
  if (provider === "anthropic") {
    return process.env.AI_API_KEY || process.env.VITE_AI_API_KEY || "";
  }
  return process.env[PROVIDER_META[provider]?.keyEnv] || "";
}

// ── Adapters ─────────────────────────────────────────────────────────────────────

async function callAnthropic(messages, model, maxTokens, apiKey, { signal } = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    signal,
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
async function callOpenAI(messages, model, maxTokens, apiKey, { signal } = {}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    signal,
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
async function callGemini(messages, model, maxTokens, apiKey, { signal } = {}) {
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
    { signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n").trim();
  return { ok: true, status: 200, text };
}

// Perplexity chat-completions — normalized to the same { ok, status, text }
// shape as every other adapter, for generic chain membership (runChain()).
// This drops the `citations` array Perplexity also returns; the
// discoverability pillar's own askPerplexity() (lib/audit/citationSampling.js)
// calls Perplexity directly instead of through this adapter specifically to
// keep those citation URLs, since that is the whole point of using a live
// retrieval engine there. Both paths now resolve their model the same way —
// via this file's config, not a raw env var — so there is one place a
// Perplexity model id is hardcoded, and it is `DEFAULT_MODELS` above.
async function callPerplexity(messages, model, maxTokens, apiKey, { signal } = {}) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return { ok: true, status: 200, text };
}

const ADAPTERS = { gemini: callGemini, anthropic: callAnthropic, openai: callOpenAI, perplexity: callPerplexity };

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
    // Per-pillar overrides — empty until an admin sets one via /admin/ai.
    // Each entry is a PARTIAL {order?, models?, enabled?}; unset fields on a
    // pillar fall back to the global values above field-by-field (see
    // resolvePillarChain), not all-or-nothing, so setting only `order` for a
    // pillar doesn't strand its models/enabled maps.
    pillars: {},
  };
}

function sanitizePillarEntry(base, raw) {
  if (!raw || typeof raw !== "object") return {};
  const order = Array.isArray(raw.order)
    ? raw.order.map((s) => String(s).toLowerCase()).filter((p) => PROVIDER_META[p])
    : null;
  const out = {};
  if (order && order.length) out.order = order;
  if (raw.models && typeof raw.models === "object") out.models = { ...raw.models };
  if (raw.enabled && typeof raw.enabled === "object") out.enabled = { ...raw.enabled };
  return out;
}

function merge(base, ov) {
  if (!ov || typeof ov !== "object") return base;
  const order = Array.isArray(ov.order)
    ? ov.order.map((s) => String(s).toLowerCase()).filter((p) => PROVIDER_META[p])
    : base.order;
  const pillars = { ...base.pillars };
  if (ov.pillars && typeof ov.pillars === "object") {
    for (const key of PILLAR_KEYS) {
      if (ov.pillars[key] !== undefined) pillars[key] = sanitizePillarEntry(base, ov.pillars[key]);
    }
  }
  return {
    order: order.length ? order : base.order,
    models: { ...base.models, ...(ov.models || {}) },
    enabled: { ...base.enabled, ...(ov.enabled || {}) },
    maxTokens: Number(ov.maxTokens) > 0 ? Number(ov.maxTokens) : base.maxTokens,
    pillars,
  };
}

/**
 * Resolve one pillar's effective {order, models, enabled}, merging its
 * (possibly partial, possibly absent) override onto the global chain
 * field-by-field. Pure — takes an already-loaded config, never fetches.
 */
export function resolvePillarChain(cfg, pillar) {
  const ov = pillar ? cfg.pillars?.[pillar] : null;
  if (!ov) return { order: cfg.order, models: cfg.models, enabled: cfg.enabled };
  return {
    order: ov.order?.length ? ov.order : cfg.order,
    models: { ...cfg.models, ...(ov.models || {}) },
    enabled: { ...cfg.enabled, ...(ov.enabled || {}) },
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
 * Resolve one provider's effective model id for a given pillar (or the
 * global default when `pillar` is omitted), and its server-side key. Used by
 * callers that need to talk to a provider directly instead of through
 * runChain() — currently only citationSampling.js's askPerplexity(), which
 * needs Perplexity's `citations` field and so can't go through the
 * normalized runChain() adapter. This is what removes the last hardcoded
 * `env.PERPLEXITY_MODEL || "sonar"` read: both paths now resolve the model
 * through this one function.
 */
export async function resolveProvider(provider, pillar) {
  const cfg = await loadAiConfig();
  const { models, enabled } = resolvePillarChain(cfg, pillar);
  return {
    model: models[provider] || DEFAULT_MODELS[provider],
    enabled: enabled[provider] !== false,
    apiKey: keyFor(provider),
  };
}

/**
 * Run the fallback chain. Returns the first successful provider's normalized text.
 * @returns {Promise<{ ok, provider?, model?, text?, attempts, error? }>}
 */
/**
 * @param {Array}  messages
 * @param {number} [clientMaxTokens]
 * @param {{signal?: AbortSignal, pillar?: string}} [opts]
 *   `signal` bounds the WHOLE chain, not one provider. Optional and unset by
 *   default, so /api/ai and extract.js are unchanged — but the chain walks up
 *   to three providers in series with no timeout of its own at any layer, so
 *   any caller working to a deadline (the discoverability audit) must pass one
 *   or it can be held open indefinitely by a single slow provider.
 *   `pillar` selects a named override (see PILLAR_KEYS/resolvePillarChain) —
 *   e.g. the discoverability audit passes `pillar: "discoverability"` so its
 *   own admin-configured order/models/enabled apply instead of the default
 *   enrichment chain, with an automatic per-field fallback to the default
 *   chain wherever the pillar hasn't overridden something.
 */
export async function runChain(messages, clientMaxTokens, opts = {}) {
  const cfg = await loadAiConfig();
  const { order, models, enabled } = resolvePillarChain(cfg, opts.pillar);
  const requested = Number(clientMaxTokens);
  const maxTokens = Number.isFinite(requested) && requested > 0
    ? Math.min(8192, Math.round(requested))
    : Math.min(8192, Math.max(1, Number(cfg.maxTokens) || 1024));
  const attempts = [];

  for (const provider of order) {
    if (enabled[provider] === false) continue;
    // Once the caller's deadline has fired, the remaining providers cannot
    // answer in time either. Trying them anyway spends the budget of whatever
    // runs after this chain, for a result that will be discarded.
    if (opts.signal?.aborted) { attempts.push({ provider, skipped: "deadline" }); continue; }
    const apiKey = keyFor(provider);
    if (!apiKey) { attempts.push({ provider, skipped: "no-key" }); continue; }

    const model = models[provider] || DEFAULT_MODELS[provider];
    try {
      const r = await ADAPTERS[provider](messages, model, maxTokens, apiKey, { signal: opts.signal });
      if (r.ok && r.text) return { ok: true, provider, model, text: r.text, attempts };
      attempts.push({ provider, status: r.status, error: r.error || "empty response" });
    } catch (err) {
      attempts.push({ provider, error: err?.message || "fetch failed" });
    }
  }

  return { ok: false, attempts, error: "All AI providers failed or are unconfigured." };
}
