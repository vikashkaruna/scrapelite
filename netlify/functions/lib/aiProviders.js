// aiProviders.js — Multi-provider LLM adapters + server-authoritative config.
//
// The provider CATALOGUE (labels, key env vars, model tiers, which feature each
// one powers) lives in src/lib/providerRegistry.js and is shared with the
// browser, exactly like entitlementModel.js. This file owns the RUNTIME: the
// wire adapters, the fallback chain, structured-output coercion, and the
// admin-managed config that overrides the registry's defaults.
//
// Every adapter NORMALIZES its reply back to Anthropic's messages shape —
// { content: [{ type:"text", text }] } — so callers never need to know which
// provider answered.
//
// ── THREE THINGS THAT CHANGED, AND WHY ───────────────────────────────────────
//
// 1. TIERS, NOT MODEL IDS. Callers ask for `tier: "fast" | "deep"`, never a
//    model. Tagging 60 links and writing a competitive brief from 24k
//    characters have different quality floors; running both on flash is why
//    briefs read like filler, and running both on a frontier model is waste.
//
// 2. AREAS, NOT ONE GLOBAL CHAIN. `area` (enrichment / synthesis /
//    classification / discoverability / citations) selects an independently
//    configurable chain. `pillar` is kept as an alias so existing callers and
//    stored configs keep working — see resolvePillarChain below.
//
// 3. STRUCTURED OUTPUT IS NATIVE WHERE THE PROVIDER HAS IT. Passing a JSON
//    Schema makes Gemini use responseSchema, OpenAI json_schema, and Anthropic
//    a forced tool call. Previously every structured extraction was "ask for
//    JSON in prose and hope", recovered by a loose parser — which turned a
//    model's chatty preamble into a user-facing "this page has no data".
//
// Provider keys are SERVER-ONLY (never VITE_ prefix). See providerRegistry.js.

import {
  PROVIDERS, AI_PROVIDERS, AI_AREA_KEYS, FUNCTION_AREAS, MODEL_TIER,
  readKey, defaultModel,
} from "../../../src/lib/providerRegistry.js";

// ── Back-compat surface ──────────────────────────────────────────────────────
// PROVIDER_META / DEFAULT_MODELS / PILLAR_KEYS were the old public names. They
// are now DERIVED from the registry rather than hand-maintained beside it, so
// the two can no longer drift.
export const PROVIDER_META = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, {
    label: PROVIDERS[p].label,
    keyEnv: PROVIDERS[p].keyEnv,
    modelEnv: PROVIDERS[p].modelEnv,
    docsUrl: PROVIDERS[p].docsUrl,
    structured: PROVIDERS[p].structured === true,
    models: PROVIDERS[p].models,
  }])
);

export const DEFAULT_MODELS = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, PROVIDERS[p].models.deep])
);

// The GLOBAL fallback chain, used only when a caller names no area. Kept
// cost-first (Gemini → Anthropic → OpenAI) — the per-area defaults in
// FUNCTION_AREAS express the quality-vs-cost intent for each feature, and
// changing this one would silently re-point every caller that predates areas.
export const DEFAULT_ORDER = ["gemini", "anthropic", "openai"];

/** Areas an override may be stored for. Named PILLAR_KEYS for back-compat. */
export const PILLAR_KEYS = AI_AREA_KEYS.slice();

function keyFor(provider) {
  return readKey(provider, process.env);
}

// ── Structured-output helpers ────────────────────────────────────────────────
// A caller passes `schema` (a plain JSON Schema object). Each adapter turns it
// into that provider's native mechanism. When a provider has none, we fall back
// to instructing in the prompt — but we always TELL the caller which happened
// (`structured: true|false` on the result) so it knows whether an unparseable
// reply is a model failure or an expected best-effort.

function schemaInstruction(schema) {
  return (
    "\n\nReturn ONLY a JSON object conforming to this JSON Schema. " +
    "No markdown fences, no prose, no preamble:\n" +
    JSON.stringify(schema)
  );
}

// Gemini's responseSchema rejects several standard JSON Schema keywords.
// Strip them rather than failing the call — the prompt still carries intent.
function toGeminiSchema(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (["additionalProperties", "$schema", "definitions", "$defs", "examples", "default", "title"].includes(k)) continue;
    out[k] = (k === "properties" || k === "items" || k === "anyOf")
      ? (k === "properties"
          ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]))
          : toGeminiSchema(v))
      : v;
  }
  return out;
}

// ── Adapters ─────────────────────────────────────────────────────────────────

async function callAnthropic(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal, schema } = opts;
  const body = { model, max_tokens: maxTokens, messages };
  let structured = false;
  if (schema) {
    // Forced tool use is Anthropic's structured-output mechanism: the model
    // must call the tool, and the tool's input IS the schema-shaped object.
    body.tools = [{ name: "emit", description: "Return the extracted data.", input_schema: schema }];
    body.tool_choice = { type: "tool", name: "emit" };
    structured = true;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    signal, method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const blocks = data?.content || [];
  if (structured) {
    const tool = blocks.find((b) => b.type === "tool_use");
    if (tool?.input) return { ok: true, status: 200, text: JSON.stringify(tool.input), json: tool.input, structured: true };
  }
  const text = blocks.map((b) => b.text).filter(Boolean).join("\n").trim();
  return { ok: true, status: 200, text, structured: false };
}

async function callOpenAI(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal, schema } = opts;
  const body = { model, max_tokens: maxTokens, messages };
  let structured = false;
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "extraction", strict: false, schema },
    };
    structured = true;
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    signal, method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return { ok: true, status: 200, text, structured };
}

async function callGemini(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal, schema } = opts;
  const contents = [];
  let systemText = "";
  for (const m of messages) {
    const text = typeof m.content === "string"
      ? m.content
      : (m.content || []).map((c) => c.text || "").join("\n");
    if (m.role === "system") { systemText += (systemText ? "\n" : "") + text; continue; }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  const generationConfig = { maxOutputTokens: maxTokens };
  let structured = false;
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(schema);
    structured = true;
  }
  const body = { contents, generationConfig };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n").trim();
  if (!text) {
    // An empty parts[] with finishReason MAX_TOKENS is a truncation, not a
    // refusal — reporting it as "empty response" sent callers hunting for a
    // content problem that was really a budget problem.
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || "empty response";
    return { ok: false, status: 200, error: `Gemini returned no text (${reason})` };
  }
  return { ok: true, status: 200, text, structured };
}

async function callPerplexity(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal } = opts; // Perplexity has no structured-output mode; schema goes in the prompt.
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    signal, method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return { ok: true, status: 200, text, structured: false };
}

const ADAPTERS = { gemini: callGemini, anthropic: callAnthropic, openai: callOpenAI, perplexity: callPerplexity };

// ── Server config (Supabase app_config 'ai' row → env → registry defaults) ────
// Stored shape:
//   { order, models:{[p]:string}, modelsFast:{[p]:string}, enabled, maxTokens,
//     pillars: { [area]: { order?, models?, modelsFast?, enabled?, tier? } } }

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
  const models = {};      // deep tier
  const modelsFast = {};
  const enabled = {};
  for (const p of AI_PROVIDERS) {
    models[p]     = defaultModel(p, MODEL_TIER.DEEP, process.env);
    modelsFast[p] = defaultModel(p, MODEL_TIER.FAST, process.env);
    enabled[p]    = true;
  }
  // Each AI area starts from the registry's declared default chain + tier, so
  // the console can render an effective setting before anything is stored.
  const pillars = {};
  for (const area of AI_AREA_KEYS) {
    pillars[area] = { order: FUNCTION_AREAS[area].defaultOrder.slice(), tier: FUNCTION_AREAS[area].defaultTier };
  }
  return {
    order: envOrder() || DEFAULT_ORDER.slice(),
    models, modelsFast, enabled,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 4096,
    pillars,
  };
}

function sanitizePillarEntry(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  const order = Array.isArray(raw.order)
    ? raw.order.map((s) => String(s).toLowerCase()).filter((p) => PROVIDER_META[p])
    : null;
  if (order && order.length) out.order = order;
  if (raw.models && typeof raw.models === "object") out.models = { ...raw.models };
  if (raw.modelsFast && typeof raw.modelsFast === "object") out.modelsFast = { ...raw.modelsFast };
  if (raw.enabled && typeof raw.enabled === "object") out.enabled = { ...raw.enabled };
  if (raw.tier === MODEL_TIER.FAST || raw.tier === MODEL_TIER.DEEP) out.tier = raw.tier;
  return out;
}

function merge(base, ov) {
  if (!ov || typeof ov !== "object") return base;
  const order = Array.isArray(ov.order)
    ? ov.order.map((s) => String(s).toLowerCase()).filter((p) => PROVIDER_META[p])
    : base.order;
  const pillars = { ...base.pillars };
  if (ov.pillars && typeof ov.pillars === "object") {
    for (const key of AI_AREA_KEYS) {
      if (ov.pillars[key] === undefined) continue;
      // Merge onto the registry default for that area rather than replacing
      // it, so storing only `tier` for an area doesn't strand its order.
      pillars[key] = { ...(base.pillars[key] || {}), ...sanitizePillarEntry(ov.pillars[key]) };
    }
  }
  // ── A PRE-TIER STORED CONFIG IS DETECTED, NOT SILENTLY REINTERPRETED ──────
  // Tiering added `modelsFast`. A stored row with `models` and NO `modelsFast`
  // therefore predates it, and in that world there was ONE model per provider
  // — and the shipped defaults were the FAST ones (gemini-2.0-flash,
  // claude-3-5-haiku, gpt-4o-mini).
  //
  // The merge below deliberately applies that single map to BOTH tiers, so a
  // live operator setting is never quietly retired. The cost is that DEEP work
  // — extraction, summaries, briefs — then runs on what used to be the fast
  // model, which is invisible from every screen.
  //
  // Guessing either way is wrong: reinterpreting it as fast-only would discard
  // a setting the operator made, and leaving it silent has already produced a
  // real complaint ("why is my deep tier on gpt-4o-mini?"). So we do neither —
  // the shape is FLAGGED, /admin/ai says so plainly, and the operator gets a
  // one-click split. The decision stays theirs; only the invisibility goes.
  const storedModels = ov.models && Object.keys(ov.models).length > 0;
  const storedFast = ov.modelsFast && Object.keys(ov.modelsFast).length > 0;

  return {
    // Surfaced by /admin/ai so an operator can confirm which write is live.
    updatedAt: ov.updatedAt || base.updatedAt || null,
    // True when the stored row predates tiering — see above. The UI turns this
    // into a banner and a migration button; nothing acts on it automatically.
    legacyModelConfig: Boolean(storedModels && !storedFast),
    order: order.length ? order : base.order,
    models:     { ...base.models,     ...(ov.models || {}) },
    // A stored `models` map also lands on the FAST tier unless `modelsFast` is
    // set explicitly. Every config written before tiering existed has one map
    // and one meaning ("use this model here"); making it apply to only half
    // the tiers would silently retire live operator settings — precisely the
    // "the fix shipped and nothing changed" failure mode this codebase has
    // already hit once, where a stored app_config row quietly outranked code.
    modelsFast: { ...base.modelsFast, ...(ov.models || {}), ...(ov.modelsFast || {}) },
    enabled:    { ...base.enabled,    ...(ov.enabled || {}) },
    maxTokens: Number(ov.maxTokens) > 0 ? Number(ov.maxTokens) : base.maxTokens,
    pillars,
  };
}

/**
 * Resolve one area's effective {order, models, enabled, tier}, merging its
 * override onto the global chain field-by-field. Pure.
 * Named resolvePillarChain for back-compat; `area` and `pillar` are the same key.
 */
export function resolvePillarChain(cfg, pillar) {
  const ov = pillar ? cfg.pillars?.[pillar] : null;
  const areaDefault = pillar ? FUNCTION_AREAS[pillar] : null;
  const tier = ov?.tier || areaDefault?.defaultTier || MODEL_TIER.DEEP;
  if (!ov) {
    return {
      order: areaDefault?.defaultOrder?.length ? areaDefault.defaultOrder : cfg.order,
      models: cfg.models, modelsFast: cfg.modelsFast, enabled: cfg.enabled, tier,
    };
  }
  return {
    order: ov.order?.length ? ov.order : (areaDefault?.defaultOrder?.length ? areaDefault.defaultOrder : cfg.order),
    models:     { ...cfg.models,     ...(ov.models || {}) },
    // Same rule as the global merge: an area override that names a model means
    // "use it for this area", whichever tier the area happens to run at.
    modelsFast: { ...cfg.modelsFast, ...(ov.models || {}), ...(ov.modelsFast || {}) },
    enabled:    { ...cfg.enabled,    ...(ov.enabled || {}) },
    tier,
  };
}

/** Pick the model id for a provider at a tier from an already-resolved chain. */
export function modelForTier(chain, provider, tier) {
  const map = tier === MODEL_TIER.FAST ? chain.modelsFast : chain.models;
  return (map && map[provider]) || defaultModel(provider, tier, process.env);
}

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

/** Resolve effective AI config (cached 60s per warm container). Never throws. */
/**
 * Resolve the effective AI config. Cached 60s per warm container.
 *
 * @param {{fresh?: boolean}} [opts] `fresh` bypasses the cache entirely. The
 *   admin screen passes it, because that screen exists to answer "did my
 *   change land?" — and invalidateAiConfigCache() alone cannot answer it:
 *   it only clears the container that served the POST, while Netlify is free
 *   to route the operator's very next GET to a DIFFERENT warm container whose
 *   own cache is up to a minute stale. The operator then sees their old
 *   settings, concludes the save failed, and saves again. One extra Supabase
 *   read on an admin page is a cheap price for a screen that cannot lie.
 */
export async function loadAiConfig(opts = {}) {
  const now = Date.now();
  if (!opts.fresh && _cache && now - _cacheAt < TTL_MS) return _cache;
  const ov = await fetchConfigRow();
  _cache = merge(defaults(), ov);
  _cacheAt = now;
  return _cache;
}

/** Drop the cached config — used after an admin save so the next call re-reads. */
export function invalidateAiConfigCache() { _cache = null; _cacheAt = 0; }

/** Which providers have a key configured server-side (no secrets exposed). */
export function keyPresence() {
  const out = {};
  for (const p of AI_PROVIDERS) out[p] = Boolean(keyFor(p));
  return out;
}

export const SUPABASE_CONFIGURED = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

/** Resolve one provider's effective model + key for an area. */
export async function resolveProvider(provider, pillar, tier) {
  const cfg = await loadAiConfig();
  const chain = resolvePillarChain(cfg, pillar);
  return {
    model: modelForTier(chain, provider, tier || chain.tier),
    enabled: chain.enabled[provider] !== false,
    apiKey: keyFor(provider),
  };
}

/**
 * LIVE reachability + credit check for one provider. This is the thing key
 * presence could never tell us: all three of DatIQ's AI keys were PRESENT and
 * all three were dead (invalid key, no credit, no credit) while /admin/health
 * reported "operational". One tiny completion is the only honest answer.
 *
 * Deliberately cheap: 1-4 output tokens, a 6-word prompt, and a hard timeout.
 * Never throws.
 */
export async function pingProvider(provider, { model, timeoutMs = 12_000 } = {}) {
  const meta = PROVIDER_META[provider];
  if (!meta) return { provider, ok: false, code: "unknown_provider", error: "Unknown provider" };
  const apiKey = keyFor(provider);
  if (!apiKey) {
    return { provider, ok: false, code: "no_key", error: `No key set (${meta.keyEnv}).`, configured: false };
  }
  const cfg = await loadAiConfig();
  const useModel = model || modelForTier(cfg, provider, MODEL_TIER.FAST);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const r = await ADAPTERS[provider](
      [{ role: "user", content: "Reply with the single word: ok" }],
      useModel, 16, apiKey, { signal: ctrl.signal }
    );
    const latencyMs = Date.now() - startedAt;
    if (r.ok) return { provider, ok: true, code: "ok", model: useModel, latencyMs, configured: true, sample: (r.text || "").slice(0, 40) };
    return { provider, ok: false, code: classifyProviderError(r), model: useModel, latencyMs, configured: true, status: r.status, error: r.error };
  } catch (err) {
    return {
      provider, ok: false, configured: true, model: useModel,
      latencyMs: Date.now() - startedAt,
      code: err?.name === "AbortError" ? "timeout" : "network",
      error: err?.name === "AbortError" ? `No response within ${timeoutMs}ms` : (err?.message || "fetch failed"),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Turn a provider's own error prose into an ACTIONABLE code. The three
 * failures that took DatIQ's AI down in production were "credit balance is too
 * low", "API key not valid", and "no credits remaining" — three different
 * wordings from three vendors for two distinct operator actions (top up vs
 * reissue). Collapsing them into "error" is what made the outage unreadable.
 */
export function classifyProviderError(r) {
  const msg = String(r?.error || "").toLowerCase();
  const status = Number(r?.status);
  if (/credit|billing|quota exceeded|insufficient|balance/.test(msg)) return "no_credit";
  if (/api key not valid|invalid api key|incorrect api key|unauthor|authentication/.test(msg)) return "bad_key";
  if (status === 401 || status === 403) return "bad_key";
  if (status === 429) return /credit|billing|balance/.test(msg) ? "no_credit" : "rate_limited";
  if (/not found|does not exist|unsupported model|unknown model/.test(msg)) return "bad_model";
  if (status >= 500) return "provider_down";
  return "error";
}

/** Human-readable, action-oriented text for a classifyProviderError code. */
export const PROVIDER_ERROR_COPY = {
  ok:            "Responding normally.",
  no_key:        "No API key is set for this provider.",
  bad_key:       "The API key is present but rejected — reissue it and update the env var.",
  no_credit:     "The key is valid but the account is out of credit — top up billing.",
  rate_limited:  "Rate-limited right now. Valid key; retry shortly.",
  bad_model:     "The configured model id is not available to this key.",
  provider_down: "The provider returned a server error.",
  timeout:       "No response before the timeout.",
  network:       "Could not reach the provider.",
  error:         "The provider rejected the request.",
};

/**
 * Run the fallback chain.
 *
 * @param {Array}  messages
 * @param {number} [clientMaxTokens]
 * @param {{signal?:AbortSignal, pillar?:string, area?:string, tier?:string, schema?:object}} [opts]
 *   `area` (alias `pillar`) selects the configurable chain — see FUNCTION_AREAS.
 *   `tier` overrides the area's default fast/deep choice for this one call.
 *   `schema` requests native structured output where the provider supports it.
 *   `signal` bounds the WHOLE chain, not one provider.
 * @returns {Promise<{ok, provider?, model?, text?, json?, structured?, attempts, error?, errorCode?}>}
 */
export async function runChain(messages, clientMaxTokens, opts = {}) {
  const cfg = await loadAiConfig();
  const area = opts.area || opts.pillar;
  const chain = resolvePillarChain(cfg, area);
  const tier = opts.tier || chain.tier || MODEL_TIER.DEEP;
  const requested = Number(clientMaxTokens);
  const maxTokens = Number.isFinite(requested) && requested > 0
    ? Math.min(8192, Math.round(requested))
    : Math.min(8192, Math.max(1, Number(cfg.maxTokens) || 4096));
  const attempts = [];

  for (const provider of chain.order) {
    if (chain.enabled[provider] === false) { attempts.push({ provider, skipped: "disabled" }); continue; }
    if (opts.signal?.aborted) { attempts.push({ provider, skipped: "deadline" }); continue; }
    const apiKey = keyFor(provider);
    if (!apiKey) { attempts.push({ provider, skipped: "no-key" }); continue; }

    const model = modelForTier(chain, provider, tier);
    // A schema only reaches providers that can honour it natively; the others
    // get the instruction inline so the request still has a chance.
    const supportsSchema = PROVIDER_META[provider]?.structured === true;
    const payload = (opts.schema && !supportsSchema)
      ? appendSchemaInstruction(messages, opts.schema)
      : messages;
    try {
      const r = await ADAPTERS[provider](payload, model, maxTokens, apiKey, {
        signal: opts.signal,
        ...(opts.schema && supportsSchema ? { schema: opts.schema } : {}),
      });
      if (r.ok && r.text) {
        return { ok: true, provider, model, tier, text: r.text, json: r.json, structured: Boolean(r.structured), attempts };
      }
      attempts.push({ provider, model, status: r.status, error: r.error || "empty response", code: classifyProviderError(r) });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      attempts.push({ provider, model, error: err?.message || "fetch failed", code: aborted ? "timeout" : "network" });
    }
  }

  // Surface the FIRST real (non-skip) failure code so callers can say
  // "out of credit" instead of "all providers failed".
  const firstReal = attempts.find((a) => a.code);
  return {
    ok: false, attempts,
    errorCode: firstReal?.code || (attempts.every((a) => a.skipped === "no-key") ? "no_key" : "error"),
    error: "All AI providers failed or are unconfigured.",
  };
}

function appendSchemaInstruction(messages, schema) {
  const copy = messages.map((m) => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role !== "user") continue;
    if (typeof copy[i].content === "string") copy[i].content += schemaInstruction(schema);
    else if (Array.isArray(copy[i].content)) {
      copy[i].content = [...copy[i].content, { type: "text", text: schemaInstruction(schema) }];
    }
    break;
  }
  return copy;
}

export const _internal = { toGeminiSchema, appendSchemaInstruction, defaults, merge };
