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

import { record as meterRecord } from "./creditMeter.js";
import {
  PROVIDERS, AI_PROVIDERS, AI_AREA_KEYS, FUNCTION_AREAS, MODEL_TIER,
  readKey, defaultModel, keyEnvNames, isRetiredGeminiModel,
} from "../../../src/lib/providerRegistry.js";

// ── Back-compat surface ──────────────────────────────────────────────────────
// PROVIDER_META / DEFAULT_MODELS / PILLAR_KEYS were the old public names. They
// are now DERIVED from the registry rather than hand-maintained beside it, so
// the two can no longer drift.
export const PROVIDER_META = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, {
    label: PROVIDERS[p].label,
    // The admin UI and the health probe both print this ("No key set (…)"), so
    // it must stay a STRING. A provider declaring `keyEnvList` instead of
    // `keyEnv` used to render "undefined" there.
    keyEnv: keyEnvNames(p).join(" / "),
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

// Gemini's responseSchema is NOT JSON Schema. It is a proto message whose
// `type` is a single enum and whose `items` is a single message, so every
// standard-JSON-Schema construct that uses a LIST in either position is a
// guaranteed 400. We translate rather than reject, because the alternative is
// losing the entire structured extraction to a shape difference.
//
// ── WHAT ACTUALLY BROKE ─────────────────────────────────────────────────────
// The shipped translation special-cased `properties`/`items`/`anyOf` and copied
// everything else through verbatim. So `type: ["string", "null"]` — the way
// every nullable field in src/lib/extractionSchemas.js is written, 44 times —
// went to Gemini as a list, and proto answered:
//
//   Invalid JSON payload received. Unknown name "type" at
//   'generation_config.response_schema.properties[0].value.items…'
//   Proto field is not repeating, cannot start list.
//
// That 400 is not a warning: it is the ONLY response, so the provider is
// dropped from the chain and the run loses its structured facts. It is also
// invisible to the health dashboard, because pingProvider() calls each adapter
// with NO schema — the probe proves the key and model work and says nothing
// about whether the schema we actually send in production is acceptable.
//
// A second, quieter hazard lived in the same function: `properties` was
// converted with Object.entries() unconditionally. Given an ARRAY, that
// silently yields `{"0": …, "1": …}` — numeric keys that look like a map to
// every reader until the API rejects them.
const GEMINI_DROP = [
  "additionalProperties", "$schema", "definitions", "$defs", "examples", "default", "title",
  // No responseSchema equivalent; the instruction still rides in the prompt.
  "anyOf", "oneOf", "allOf", "not", "const", "patternProperties", "dependencies",
];

/**
 * JSON Schema `type` accepts an array of types (`["string", "null"]` is the
 * idiomatic nullable). Gemini accepts exactly one. Collapse to the first
 * member that actually carries information — a field declared
 * `["string", "null"]` is a string field that may be absent, and Gemini models
 * absence with the absence of the property, not with a null literal.
 */
function collapseGeminiType(type) {
  if (Array.isArray(type)) {
    const meaningful = type.find((t) => String(t).toLowerCase() !== "null");
    return collapseGeminiType(meaningful ?? type[0]);
  }
  return type;
}

export function toGeminiSchema(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (GEMINI_DROP.includes(k)) continue;
    if (k === "type") { out[k] = collapseGeminiType(v); continue; }
    // `items` is a single message in Gemini. JSON Schema's tuple form makes it
    // a list; keeping the first entry preserves the "shape of the element"
    // information instead of failing the call.
    if (k === "items") {
      out[k] = toGeminiSchema(Array.isArray(v) ? v[0] : v);
      continue;
    }
    if (k === "properties") {
      // A map in JSON Schema. An ARRAY here is malformed input, and the old
      // Object.entries() path turned it into numeric keys rather than
      // dropping it — see the header.
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      continue;
    }
    out[k] = v;
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
  if (!text && data?.stop_reason === "max_tokens") {
    return {
      ok: false, status: 200, code: "truncated",
      error: `Anthropic produced no text — the ${maxTokens}-token output budget was spent before any answer (stop_reason: max_tokens).`,
    };
  }
  return { ok: true, status: 200, text, structured: false };
}

// OpenAI renamed the output budget: `max_tokens` is deprecated on Chat
// Completions and REJECTED OUTRIGHT by every reasoning-era model —
//
//   "Unsupported parameter: 'max_tokens' is not supported with this model.
//    Use 'max_completion_tokens' instead."
//
// — which is a 400 on a perfectly healthy, funded key, and reads on
// /admin/ai as "the provider rejected the request". `max_completion_tokens`
// is accepted by every model OpenAI currently serves, so it is what we send.
// The one-shot retry below exists for the reverse case (an older deployment
// or an OpenAI-compatible proxy that only knows the old name): a parameter
// rename must not be able to take the chain down in either direction.
const OPENAI_BUDGET_PARAM_RE = /max_completion_tokens/i;

async function callOpenAI(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal, schema } = opts;
  let structured = false;
  const base = { model, messages };
  if (schema) {
    base.response_format = {
      type: "json_schema",
      json_schema: { name: "extraction", strict: false, schema },
    };
    structured = true;
  }

  const post = (budgetKey) => fetch("https://api.openai.com/v1/chat/completions", {
    signal, method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...base, [budgetKey]: maxTokens }),
  });

  let res = await post("max_completion_tokens");
  let data = await res.json().catch(() => ({}));
  if (!res.ok && res.status === 400 && isUnsupportedParam(data?.error, OPENAI_BUDGET_PARAM_RE)) {
    res = await post("max_tokens");
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };

  const choice = data?.choices?.[0];
  const text = (choice?.message?.content || "").trim();
  if (!text && choice?.finish_reason === "length") {
    // A reasoning model spends hidden reasoning tokens out of the SAME budget
    // as the answer, so a tight max_completion_tokens returns an empty
    // message with finish_reason "length" — a truncation, not a refusal.
    return {
      ok: false, status: 200, code: "truncated",
      error: `OpenAI produced no text — the ${maxTokens}-token output budget was spent before any answer (finish_reason: length).`,
    };
  }
  return { ok: true, status: 200, text, structured };
}

/** Is this a "that parameter is not supported" 400 about the named field? */
function isUnsupportedParam(err, field) {
  if (!err) return false;
  const blob = `${err.param || ""} ${err.code || ""} ${err.message || ""}`;
  return field.test(blob) && /unsupported|unrecognized|unknown|not supported|invalid/i.test(blob);
}

// ── Gemini thinking budgets ──────────────────────────────────────────────────
// Gemini 2.5 and later are THINKING models: hidden reasoning tokens are drawn
// from the SAME maxOutputTokens budget as the visible answer, and they are
// spent FIRST. So a tight budget comes back as candidates[0] with an EMPTY
// parts[] and finishReason MAX_TOKENS — no text, no error, and nothing wrong
// with the key, the prompt or the account. That is exactly what /admin/ai's
// ping produced against a healthy, funded key: "Gemini returned no text
// (MAX_TOKENS)", classified as "the provider rejected the request".
//
// Two rules, because model ids move faster than deploys:
//
//   1. RESERVE, DON'T SHARE. Any thinking budget we allow is added ON TOP of
//      the caller's maxTokens, so `maxTokens: 64` means 64 tokens of ANSWER
//      rather than 64 tokens the model may spend entirely on thinking.
//   2. TURN IT OFF WHERE THE ANSWER IS A WORD. Below THINK_OFF_BELOW the
//      output is a label, a tag or a yes/no — reasoning buys nothing there and
//      truncation costs everything — so we disable it in the families that
//      allow it (2.5 Flash and Flash-Lite accept 0; 2.5 Pro's floor is 128 and
//      cannot be disabled at all).
//
// A model family we do not recognise gets NO thinkingConfig (an unknown field
// is a 400, and Gemini 3 uses `thinkingLevel`, not a budget) but DOES get
// headroom — the failure mode we are fixing must not return the day a newer
// model id is typed into /admin/ai.
const GEMINI_THINK_OFF_BELOW = 512;
const GEMINI_THINK_MIN = 128;   // 2.5 Pro's documented floor
const GEMINI_THINK_MAX = 8192;
const clampTokens = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Decide Gemini's thinking config and the real maxOutputTokens to send.
 * Pure, and exported through `_internal` so the rule is testable without a
 * network call.
 * @returns {{config: object|null, outputTokens: number, reserved: number}}
 */
function geminiThinkingPlan(model, maxTokens) {
  const m = String(model || "").toLowerCase();
  const answer = Math.max(1, Math.round(Number(maxTokens) || 1));

  // Pre-2.5 families do no thinking and reject thinkingConfig outright.
  if (/^gemini-(1\.0|1\.5|2\.0)/.test(m)) {
    return { config: null, outputTokens: answer, reserved: 0 };
  }

  if (/^gemini-2\.5-/.test(m)) {
    // Flash and Flash-Lite accept thinkingBudget 0; Pro does not.
    if (/flash/.test(m) && answer < GEMINI_THINK_OFF_BELOW) {
      return { config: { thinkingBudget: 0 }, outputTokens: answer, reserved: 0 };
    }
    const reserved = clampTokens(answer, GEMINI_THINK_MIN, GEMINI_THINK_MAX);
    return { config: { thinkingBudget: reserved }, outputTokens: answer + reserved, reserved };
  }

  // Unknown / newer family: headroom only, no config we cannot verify.
  const reserved = clampTokens(Math.max(answer, 1024), GEMINI_THINK_MIN, GEMINI_THINK_MAX);
  return { config: null, outputTokens: answer + reserved, reserved };
}

/**
 * Which tool name this model family uses for Google Search grounding.
 *
 * ⚠️ THE NAME CHANGED BETWEEN FAMILIES AND THE OLD ONE IS REJECTED, NOT
 * IGNORED. 1.5 takes `google_search_retrieval`; 2.0 and later take
 * `google_search`. Sending the wrong one 400s every call, which reads as "the
 * key is bad" rather than "the tool is misnamed" — the same class of misread
 * that made a wrong PageSpeed key look like a quota problem for months.
 */
export function geminiSearchTool(model = "") {
  return /gemini-1\.5/i.test(String(model)) ? "google_search_retrieval" : "google_search";
}

/**
 * Pull the sources a grounded answer actually retrieved.
 *
 * These ARE the citations. Without them a grounded call is just a slower
 * ungrounded one — the point of grounding, here, is learning which pages the
 * engine read in order to answer.
 */
export function geminiGroundingCitations(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const out = [];
  for (const c of chunks) {
    const uri = c?.web?.uri || c?.retrievedContext?.uri;
    if (uri) out.push({ url: uri, title: c?.web?.title || c?.retrievedContext?.title || null });
  }
  return out;
}

async function callGemini(messages, model, maxTokens, apiKey, opts = {}) {
  const { signal, schema, grounded } = opts;
  const contents = [];
  let systemText = "";
  for (const m of messages) {
    const text = typeof m.content === "string"
      ? m.content
      : (m.content || []).map((c) => c.text || "").join("\n");
    if (m.role === "system") { systemText += (systemText ? "\n" : "") + text; continue; }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  const plan = geminiThinkingPlan(model, maxTokens);
  const generationConfig = { maxOutputTokens: plan.outputTokens };
  if (plan.config) generationConfig.thinkingConfig = plan.config;
  let structured = false;
  // ⚠️ GROUNDING AND A RESPONSE SCHEMA ARE MUTUALLY EXCLUSIVE. Gemini rejects a
  // request carrying both, so when a caller asks for grounding we drop the
  // schema rather than send a request we know will 400. Grounding wins because
  // a caller that asks for it wants CITATIONS, and a grounded answer in prose
  // is useful where a schema-shaped answer with no sources is not.
  if (schema && !grounded) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(schema);
    structured = true;
  }
  const body = { contents, generationConfig };
  if (grounded) body.tools = [{ [geminiSearchTool(model)]: {} }];
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
    if (reason === "MAX_TOKENS") {
      const thoughts = data?.usageMetadata?.thoughtsTokenCount;
      return {
        ok: false, status: 200, code: "truncated",
        error: `Gemini produced no text — the ${plan.outputTokens}-token output budget was spent before any answer (finishReason MAX_TOKENS`
          + `${Number.isFinite(thoughts) ? `, ${thoughts} of it on internal reasoning` : ""}). Raise max tokens or pick a lighter model.`,
      };
    }
    return { ok: false, status: 200, error: `Gemini returned no text (${reason})` };
  }
  const citations = grounded ? geminiGroundingCitations(data) : [];
  // 🔴 GROUNDED BUT UNSOURCED IS A REAL STATE, AND IT IS NOT AN ERROR.
  // Gemini answers from its own weights when Search returns nothing useful, and
  // signals that only by the ABSENCE of groundingMetadata. Reporting it as a
  // failure would discard a perfectly good answer; reporting it as grounded
  // would credit sources that were never read. `grounded` on the result is what
  // the citation layer branches on to decide whether this counts as live.
  return { ok: true, status: 200, text, structured, citations, grounded: grounded ? citations.length > 0 : false };
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
  if (raw.models && typeof raw.models === "object") {
    out.models = { ...raw.models };
    if (out.models.gemini && isRetiredGeminiModel(out.models.gemini)) delete out.models.gemini;
  }
  if (raw.modelsFast && typeof raw.modelsFast === "object") {
    out.modelsFast = { ...raw.modelsFast };
    if (out.modelsFast.gemini && isRetiredGeminiModel(out.modelsFast.gemini)) delete out.modelsFast.gemini;
  }
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
  // Filter out retired Gemini models from stored overrides so a stale database
  // row cannot resurrect an invalid model ID that returns 404 from Google.
  const rawModels = ov.models && typeof ov.models === "object" ? { ...ov.models } : {};
  const rawModelsFast = ov.modelsFast && typeof ov.modelsFast === "object" ? { ...ov.modelsFast } : {};
  for (const [k, v] of Object.entries(rawModels)) {
    if (k === "gemini" && isRetiredGeminiModel(v)) delete rawModels[k];
  }
  for (const [k, v] of Object.entries(rawModelsFast)) {
    if (k === "gemini" && isRetiredGeminiModel(v)) delete rawModelsFast[k];
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
  const storedModels = Object.keys(rawModels).length > 0;
  const storedFast = Object.keys(rawModelsFast).length > 0;

  return {
    // Surfaced by /admin/ai so an operator can confirm which write is live.
    updatedAt: ov.updatedAt || base.updatedAt || null,
    // True when the stored row predates tiering — see above. The UI turns this
    // into a banner and a migration button; nothing acts on it automatically.
    legacyModelConfig: Boolean(storedModels && !storedFast),
    order: order.length ? order : base.order,
    models:     { ...base.models,     ...rawModels },
    // A stored `models` map also lands on the FAST tier unless `modelsFast` is
    // set explicitly. Every config written before tiering existed has one map
    // and one meaning ("use this model here"); making it apply to only half
    // the tiers would silently retire live operator settings — precisely the
    // "the fix shipped and nothing changed" failure mode this codebase has
    // already hit once, where a stored app_config row quietly outranked code.
    modelsFast: { ...base.modelsFast, ...rawModels, ...rawModelsFast },
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
 * One grounded Gemini call, for callers that need SOURCES and not just text.
 *
 * Deliberately not part of `runChain`: the chain's job is to get an answer from
 * whichever provider is up, and a grounded answer from one provider is not
 * interchangeable with an ungrounded answer from another. A citation sample
 * that silently fell back to a model's own recall would report a brand as
 * "cited by a live engine" on the strength of its training data.
 */
export async function callGeminiGrounded(prompt, { pillar = "citations", tier, signal, maxTokens = 500 } = {}) {
  const { model, enabled, apiKey } = await resolveProvider("gemini", pillar, tier);
  if (!enabled) return { ok: false, error: "Gemini is disabled in the provider chain." };
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set." };
  const r = await callGemini(
    [{ role: "user", content: prompt }], model, maxTokens, apiKey, { signal, grounded: true },
  );
  if (!r.ok) return { ok: false, error: r.error, code: r.code || null };
  return { ok: true, text: r.text, citations: r.citations || [], grounded: Boolean(r.grounded), model };
}

/**
 * LIVE check that an answer engine returns SOURCES, not just text.
 *
 * 🔴 THIS IS THE CHECK `pingProvider` CANNOT MAKE. A ping proves the key is
 * valid and the model answers. It says nothing about grounding — a perfectly
 * good Gemini key returns prose with no `groundingMetadata` whenever the search
 * tool is misconfigured, the model family takes the other tool name, or the
 * account lacks grounding entitlement. Every one of those degrades citation
 * sampling to a model's own recall while the provider card stays green, which
 * is the exact failure this repo already shipped once with a PageSpeed key that
 * measured nothing for months.
 *
 * Asks something no model could answer from memory alone, so an answer with no
 * sources is strong evidence grounding did not run rather than evidence the
 * question was easy.
 */
export async function probeAnswerEngine(provider, { signal } = {}) {
  const PROMPT = "Name two companies that published something about web data extraction in the last month, with links.";

  if (provider === "gemini") {
    const r = await callGeminiGrounded(PROMPT, { signal, maxTokens: 300 });
    if (!r.ok) return { ok: false, provider, error: r.error, code: r.code || null };
    return {
      ok: true, provider, model: r.model,
      grounded: r.grounded,
      citationCount: (r.citations || []).length,
      sample: (r.citations || []).slice(0, 3).map((c) => c.url),
      // The distinction the whole citation metric rests on.
      verdict: r.grounded
        ? "Grounded — answers are retrieved from the live web and count as live."
        : "NOT grounded. The key works and the model answered, but no sources came back, so every citation sample through this engine would be the model's own recall labelled live:false. Check that Google Search grounding is enabled for this key and that the model family matches the tool name.",
    };
  }

  if (provider === "perplexity") {
    const key = keyFor("perplexity");
    if (!key) return { ok: false, provider, error: "PERPLEXITY_API_KEY is not set." };
    const { model } = await resolveProvider("perplexity", "citations");
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        signal, method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }], max_tokens: 300 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, provider, error: data?.error?.message || `Perplexity ${res.status}` };
      }
      const citations = data?.citations || data?.search_results || [];
      return {
        ok: true, provider, model,
        grounded: citations.length > 0,
        citationCount: citations.length,
        sample: citations.slice(0, 3).map((c) => (typeof c === "string" ? c : c?.url)).filter(Boolean),
        verdict: citations.length > 0
          ? "Returning citations — samples through this engine count as live."
          : "Answered with no citations. Retrieval is what this provider is for, so an empty citation list here usually means the model id is not a search model.",
      };
    } catch (err) {
      return { ok: false, provider, error: err?.message || "Perplexity request failed" };
    }
  }

  return { ok: false, provider, error: `${provider} is not an answer engine.` };
}

export const PING_TOKENS = 64;          // enough for "ok" on any non-reasoning model
export const PING_RETRY_TOKENS = 2048;  // enough for a reasoning pass plus "ok"

/**
 * The schema the liveness probe sends, which is the one thing that made the
 * probe lie.
 *
 * The probe used to call each adapter with NO schema at all, so it proved the
 * key was funded and the model id was alive and said NOTHING about whether the
 * schema we actually send in production is acceptable to that provider's
 * structured-output mechanism. Gemini rejected every nullable field in
 * src/lib/extractionSchemas.js (`type: ["string","null"]` — 44 occurrences) with
 * a 400, dropped out of the chain, and /admin/health kept reporting it green,
 * because a plain "reply ok" needs no schema.
 *
 * So the probe now sends a real one, and deliberately includes the two shapes
 * that actually broke: a union `type`, and a nullable nested object. A
 * provider whose structured-output path rejects either now reports DOWN at the
 * moment it breaks, instead of failing every extraction run silently for days.
 */
export const PING_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    note: { type: ["string", "null"] },
    detail: {
      type: ["object", "null"],
      properties: { seen: { type: "string" }, score: { type: ["number", "null"] } },
    },
  },
  required: ["ok"],
};

/**
 * LIVE reachability + credit check for one provider. This is the thing key
 * presence could never tell us: all three of DatIQ's AI keys were PRESENT and
 * all three were dead (invalid key, no credit, no credit) while /admin/health
 * reported "operational". One tiny completion is the only honest answer.
 *
 * Deliberately cheap: a 6-word prompt, a small output budget and a hard
 * timeout. Never throws.
 *
 * ⚠️ THE BUDGET IS PART OF THE TEST, NOT AN AFTERTHOUGHT. This ping used to
 * ask for 16 output tokens, which a reasoning model spends on hidden thinking
 * before it writes a word — so Gemini 2.5 and the GPT-5-era models came back
 * empty and the console reported a working, funded key as a failure. A test
 * that cries wolf is worse than no test: it is indistinguishable from the real
 * outage it exists to catch. So a truncation is RETRIED ONCE with a budget
 * generous enough for any reasoning pass, and if that answers, the provider is
 * reported as WORKING with a note about how much room the model needs.
 */
export async function pingProvider(provider, { model, timeoutMs = 12_000, withSchema = true } = {}) {
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
  // Only providers with NATIVE structured output get the schema — sending it
  // to one without would just prove nothing (runChain inlines the schema as
  // prompt text for those instead, so the shape is still exercised, just not
  // through a mechanism that can reject it).
  const schema = withSchema && meta.structured ? PING_SCHEMA : null;
  const ask = (budget) => ADAPTERS[provider](
    [{ role: "user", content: "Reply with the single word: ok" }],
    useModel, budget, apiKey,
    schema ? { signal: ctrl.signal, schema } : { signal: ctrl.signal }
  );
  try {
    let r = await ask(PING_TOKENS);
    let note = "";
    if (!r.ok && classifyProviderError(r) === "truncated") {
      // The key and the model are fine; the budget was not. Prove which.
      r = await ask(PING_RETRY_TOKENS);
      note = r.ok
        ? `Working, but this model reasons before answering: it needed more than ${PING_TOKENS} output tokens to reply "ok". Keep max tokens generous wherever it runs.`
        : "";
    }
    const latencyMs = Date.now() - startedAt;
    if (r.ok) return { provider, ok: true, code: "ok", model: useModel, latencyMs, configured: true, note, sample: (r.text || "").slice(0, 40) };
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
  // An adapter that already KNOWS the cause says so. Regex-matching prose is a
  // fallback for vendor text we do not control, never a way to re-derive
  // something the call site established for certain.
  if (r?.code && PROVIDER_ERROR_COPY[r.code]) return r.code;
  const msg = String(r?.error || "").toLowerCase();
  const status = Number(r?.status);
  if (/credit|billing|quota exceeded|insufficient|balance/.test(msg)) return "no_credit";
  if (/api key not valid|invalid api key|incorrect api key|unauthor|authentication/.test(msg)) return "bad_key";
  if (status === 401 || status === 403) return "bad_key";
  if (status === 429) return /credit|billing|balance/.test(msg) ? "no_credit" : "rate_limited";
  if (/not found|does not exist|unsupported model|unknown model/.test(msg)) return "bad_model";
  // OUR OWN deadline, not the provider's verdict. The abort surfaces as a
  // returned message rather than a thrown AbortError whenever an adapter
  // catches it internally, and "This operation was aborted" matches none of
  // the patterns above — so it used to land on `error`, i.e. "the provider
  // rejected the request", about a provider that had merely been slow.
  if (/\baborted\b|\babort\b|timed out|timeout/.test(msg)) return "timeout";
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
  truncated:     "The model spent its whole output budget on internal reasoning before answering — raise max tokens, or use a model that is not a reasoning model for this area.",
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
        // ── CHOKE POINT 1 of 4 ────────────────────────────────────────────
        // Every AI call the product makes arrives here, so metering here is
        // what makes a NEW module cost-bearing on the day it lands rather
        // than on the day somebody notices. `opts.meter` carries the caller;
        // without one the call is recorded as unattributed and reported,
        // never silently free. Synchronous — the write happens at flush().
        meterRecord(opts.meter, {
          kind: tier === MODEL_TIER.FAST ? "ai_fast" : "ai_deep",
          meta: { provider, model, area: area || null },
        });
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
  // A chain that produced nothing charges nothing. The customer got no value
  // and we eat the cost — chargeableEvents() states the same rule for runs.
  meterRecord(opts.meter, { kind: "ai_fast", failed: true });
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

export const _internal = { toGeminiSchema, appendSchemaInstruction, defaults, merge, geminiThinkingPlan, isUnsupportedParam };
