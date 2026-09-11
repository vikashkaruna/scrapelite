// citationSampling.js — is this brand actually being cited by answer engines?
//
// The GEO pillar's hardest signal, because it cannot be read off the page: it
// has to be observed by ASKING an answer engine and seeing whether the brand
// comes back.
//
// ── TWO ENGINES, HONESTLY LABELLED ─────────────────────────────────────────
// They do not measure the same thing, and conflating them would be the most
// misleading number in the product:
//
//   "perplexity"  A live answer engine with web retrieval that returns real
//                 citation URLs. This is genuine GEO evidence. `live: true`.
//
//   "ai-chain"    The Gemini/Anthropic/OpenAI chain this app already runs.
//                 These are language models WITHOUT live retrieval, so what
//                 they return is TRAINING-DATA RECALL — whether the brand is
//                 well enough known to be recalled unprompted. That is a real
//                 and useful signal, and it is NOT the same as being cited in
//                 a live answer. `live: false`, and the UI must say so.
//
// With neither configured, sampling returns null. The citation_footprint signal
// then drops out of the Entity Authority pillar and the other four re-weight.
// An unsampled brand is UNKNOWN, never uncited.

import { runChain, resolveProvider, callGeminiGrounded } from "../aiProviders.js";
import { generatePrompts, classifyPromptKind } from "../../../../src/lib/discoverability/promptTaxonomy.js";

// "discoverability" is the pillar key this module's runChain()/resolveProvider()
// calls pass — see PILLAR_KEYS in aiProviders.js and /admin/ai's pillar switcher.
// Both the ai-chain fallback and the Perplexity model id below resolve through
// that one shared, admin-configurable config now, instead of a raw env read.
// Citation sampling now has its OWN configurable area, separate from the
// audit's evaluator chain. They want different things: the evaluator wants a
// fast, cheap judgement under a hard deadline, while this wants a LIVE
// retrieval engine whose citation URLs are the entire point. Sharing one
// chain meant an operator could not put Perplexity first here without also
// putting it first in the evaluator, where it is the wrong tool.
const PILLAR = "citations";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const SAMPLE_TIMEOUT_MS = 15_000;

/** Cap the prompts per audit. Each is a paid call against a slow API. */
export const MAX_PROMPTS_PER_AUDIT = 10;

/**
 * Default prompts, derived from the page rather than hard-coded.
 *
 * A generic "what is <brand>" set tests brand recall and nothing else. Building
 * prompts from the page's own subject tests the thing the user actually wants
 * to know: when somebody asks about THIS TOPIC, does this brand come up?
 */
export function defaultPrompts({ brand = "", topic = "", host = "" } = {}) {
  const subject = topic || brand || host;
  const out = [];
  if (subject) {
    out.push(`What is ${subject}?`);
    out.push(`Which companies or tools are best for ${subject}?`);
    out.push(`How do I get started with ${subject}?`);
  }
  if (brand) {
    out.push(`What is ${brand} and who is it for?`);
    out.push(`Is ${brand} a credible source on ${subject || "this topic"}?`);
  }
  return out.slice(0, MAX_PROMPTS_PER_AUDIT);
}

/** Which engine can we actually use here? */
/**
 * Engines that actually retrieve from the live web, in preference order.
 *
 * Perplexity leads because retrieval-with-citations is the product rather than
 * a mode of it. Grounded Gemini is the second live engine D4 chose, and having
 * two matters more than the ordering does: with one, a lapsed key takes the
 * whole feature to `live: false` and every citation metric silently becomes a
 * statement about a model's memory.
 */
export const LIVE_ENGINES = Object.freeze(["perplexity", "gemini"]);

/** Does this engine read the live web, or answer from its own weights? */
export function isLiveEngine(engine) {
  return LIVE_ENGINES.includes(engine);
}

export function resolveEngine(env = process.env, requested = null) {
  if (requested === "none") return null;
  if (env.PERPLEXITY_API_KEY && (!requested || requested === "perplexity")) return "perplexity";
  if (requested === "perplexity") return null;      // asked for it, no key
  if (env.GEMINI_API_KEY && (!requested || requested === "gemini")) return "gemini";
  if (requested === "gemini") return null;          // asked for it, no key
  if (env.DISABLE_AI_CITATION_SAMPLING === "1") return null;
  return "ai-chain";                                 // degraded but honest
}

/**
 * Ask grounded Gemini, and treat an ungrounded reply as NOT live.
 *
 * 🔴 THIS IS THE LINE THAT KEEPS THE METRIC HONEST. Gemini answers from its own
 * weights whenever Search returns nothing useful, and says so only by omitting
 * groundingMetadata. Counting that as a live citation would credit the open web
 * for a brand the model merely remembers — which is exactly the measurement
 * this module exists to replace.
 */
async function askGemini(prompt, { signal } = {}) {
  const r = await callGeminiGrounded(prompt, { signal, pillar: PILLAR });
  if (!r.ok) return { ok: false, error: r.error || "Gemini grounding unavailable" };
  return { ok: true, text: r.text, citations: r.citations || [], live: Boolean(r.grounded) };
}

/** Does an answer name the brand? Word-boundary matched to avoid substring hits. */
export function mentionsBrand(text, brand) {
  if (!text || !brand) return false;
  const escaped = String(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try { return new RegExp(`\\b${escaped}\\b`, "i").test(text); } catch { return false; }
}

/** Does the answer cite this domain, in its citation list or inline? */
export function citesDomain(citations, text, host) {
  if (!host) return false;
  const bare = String(host).replace(/^www\./, "").toLowerCase();
  for (const c of citations || []) {
    const url = typeof c === "string" ? c : c?.url || "";
    if (url.toLowerCase().includes(bare)) return true;
  }
  return typeof text === "string" && text.toLowerCase().includes(bare);
}

/** A coarse tone read on the sentences that name the brand. */
export function estimateSentiment(text, brand) {
  if (!text || !brand) return null;
  const sentences = String(text).split(/(?<=[.!?])\s+/).filter((s) => mentionsBrand(s, brand));
  if (sentences.length === 0) return null;
  const joined = sentences.join(" ").toLowerCase();
  const pos = (joined.match(/\b(best|leading|trusted|reliable|popular|recommended|strong|excellent|robust|comprehensive)\b/g) || []).length;
  const neg = (joined.match(/\b(limited|lacks|poor|expensive|outdated|unreliable|criticis|complaint|drawback|weak)\w*\b/g) || []).length;
  if (pos + neg === 0) return 0.7;                   // neutral mention, still positive for discovery
  return Math.max(0, Math.min(1, 0.5 + (pos - neg) / (2 * (pos + neg))));
}

async function askPerplexity(prompt, env, fetchImpl, { signal, timeoutMs, model } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || SAMPLE_TIMEOUT_MS);
  // The audit's own budget can cut a prompt short before its per-call timeout.
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetchImpl(PERPLEXITY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `Perplexity ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      text: data?.choices?.[0]?.message?.content || "",
      citations: data?.citations || data?.search_results || [],
    };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err?.message || "Perplexity request failed" };
  }
}

async function askAiChain(prompt, { signal } = {}) {
  // The signal matters more here than anywhere else in the pipeline: runChain
  // walks up to three providers in series and, before it learned to take one,
  // had no timeout at ANY layer. This is the default engine whenever no
  // Perplexity key is set, so the common configuration was the unbounded one.
  const r = await runChain([{
    role: "user",
    content: `${prompt}\n\nAnswer in under 150 words. Name specific companies, products or sources where you know of them. If you do not know of any, say so plainly rather than guessing.`,
  }], 400, { signal, pillar: PILLAR });
  if (!r.ok) return { ok: false, error: r.error || "AI chain unavailable" };
  return { ok: true, text: r.text, citations: [] };
}

/**
 * Sample an engine across a prompt set.
 *
 * @returns {Promise<null|{engine,live,promptCount,mentions,citations,sentiment,runs,error}>}
 *          null when no engine is available — the caller turns that into
 *          `citation_footprint: null` rather than a zero.
 */
export async function sampleCitations({
  brand = "", host = "", topic = "", prompts = null,
  // Declared dimensions. Absent ones are simply not crossed — see
  // promptTaxonomy.js for why none of them is ever guessed.
  competitors = [], geography = null, industries = [],
  env = process.env, engine = null, fetchImpl = fetch, maxPrompts = MAX_PROMPTS_PER_AUDIT,
  // The audit's wall-clock budget, if it has one. `signal` cuts every in-flight
  // prompt short together; `timeoutMs` lowers the per-call ceiling to fit.
  signal = null, timeoutMs = null,
} = {}) {
  const chosen = resolveEngine(env, engine);
  if (!chosen) return null;

  // ── What we ask ──────────────────────────────────────────────────────────
  // A caller-supplied list is text somebody wrote, so its intent has to be
  // guessed; a generated set carries its kind by construction. Both arrive here
  // as records so everything downstream reads one shape, and `kindConfidence`
  // records which of the two this was.
  const list = (prompts && prompts.length
    ? prompts.map((p) => {
        if (p && typeof p === "object" && p.prompt) {
          return { prompt: String(p.prompt), kind: p.kind || null, commercial: Boolean(p.commercial), kindConfidence: 100 };
        }
        const guess = classifyPromptKind(p);
        return { prompt: String(p), kind: guess.kind, commercial: guess.commercial, kindConfidence: guess.confidence };
      })
    : generatePrompts({ brand, subject: topic || brand || host, competitors, geography, industries, limit: maxPrompts })
        .map((p) => ({ ...p, kindConfidence: 100 }))
  ).slice(0, maxPrompts);
  if (list.length === 0) return null;

  // Resolved once per sampling run, not once per prompt: the model id comes
  // from the shared, admin-configurable chain config (/admin/ai's
  // "Discoverability & citation sampling" pillar) rather than a hardcoded
  // literal — this is the one place a Perplexity model id used to be
  // duplicated outside DEFAULT_MODELS in aiProviders.js.
  const perplexityModel = chosen === "perplexity"
    ? (await resolveProvider("perplexity", PILLAR)).model
    : null;

  // ── The prompts run CONCURRENTLY ─────────────────────────────────────────
  //
  // They were awaited one at a time in a `for` loop, which made this stage cost
  // the SUM of its prompts rather than the slowest of them: five default
  // prompts at a 15s ceiling each is 75 seconds of wall clock, against a
  // function that is killed at 10. Measured, not inferred — the five requests
  // went out at t+0.1s, t+15.1s, t+30.1s, t+45.1s and t+60.1s.
  //
  // Nothing about the sampling needs an ordering: each prompt is independent,
  // every result is reduced by counting, and `runs` is rebuilt in list order
  // below so the stored evidence is unchanged. This alone takes the stage from
  // 75s to ~15s.
  const settled = await Promise.all(list.map(async (entry) => {
    const prompt = entry.prompt;
    try {
      const r = chosen === "perplexity"
        ? await askPerplexity(prompt, env, fetchImpl, { signal, timeoutMs, model: perplexityModel })
        : chosen === "gemini"
          ? await askGemini(prompt, { signal })
          : await askAiChain(prompt, { signal });
      return { entry, r };
    } catch (err) {
      return { entry, r: { ok: false, error: err?.message || "sampling threw" } };
    }
  }));

  const runs = [];
  let failures = 0;

  for (const { entry, r } of settled) {
    const prompt = entry.prompt;
    if (!r.ok) {
      failures += 1;
      runs.push({ prompt, kind: entry.kind, commercial: entry.commercial, error: r.error, mention: null, citation: null });
      continue;
    }

    const mention = mentionsBrand(r.text, brand);
    const citation = citesDomain(r.citations, r.text, host);
    runs.push({
      prompt,
      kind: entry.kind,
      commercial: entry.commercial,
      kindConfidence: entry.kindConfidence,
      mention,
      citation,
      // ⚠️ PER-RUN, NOT PER-ENGINE. Grounded Gemini falls back to its own
      // weights whenever Search returns nothing useful, so within one sampling
      // run some answers are retrieved and others remembered. A single
      // engine-level flag would label the whole set by whichever it was called,
      // and the two are different measurements.
      live: r.live !== undefined ? Boolean(r.live) : isLiveEngine(chosen),
      sentiment: mention ? estimateSentiment(r.text, brand) : null,
      citedDomains: (r.citations || [])
        .map((c) => (typeof c === "string" ? c : c?.url || ""))
        .map((u) => { try { return new URL(u).hostname; } catch { return null; } })
        .filter(Boolean)
        .slice(0, 10),
      excerpt: String(r.text || "").slice(0, 300),
    });
  }

  const answered = runs.filter((r) => !r.error);
  if (answered.length === 0) {
    // Every prompt failed. That is an outage, not evidence of no citations —
    // the difference between "we asked and you were absent" and "we could not
    // ask", which must never be scored the same way.
    return {
      engine: chosen, live: isLiveEngine(chosen),
      promptCount: 0, mentions: 0, citations: 0, sentiment: null,
      runs, error: runs[0]?.error || "sampling failed",
    };
  }

  const sentiments = answered.map((r) => r.sentiment).filter((s) => Number.isFinite(s));
  // The run is live only where the answers were. A grounded engine that fell
  // back to recall on every prompt produced a non-live sample, whatever it is
  // called, and `liveAnswers` is what a reader needs to judge the rest by.
  const liveAnswers = answered.filter((r) => r.live).length;
  return {
    engine: chosen,
    live: isLiveEngine(chosen) && liveAnswers > 0,
    liveAnswers,
    promptCount: answered.length,
    mentions: answered.filter((r) => r.mention).length,
    citations: answered.filter((r) => r.citation).length,
    sentiment: sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null,
    runs,
    failures,
    error: null,
  };
}
