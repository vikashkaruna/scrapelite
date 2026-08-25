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

import { runChain } from "../aiProviders.js";

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
export function resolveEngine(env = process.env, requested = null) {
  if (requested === "none") return null;
  if (env.PERPLEXITY_API_KEY && (!requested || requested === "perplexity")) return "perplexity";
  if (requested === "perplexity") return null;      // asked for it, no key
  if (env.DISABLE_AI_CITATION_SAMPLING === "1") return null;
  return "ai-chain";                                 // degraded but honest
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

async function askPerplexity(prompt, env, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SAMPLE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(PERPLEXITY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.PERPLEXITY_MODEL || "sonar",
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

async function askAiChain(prompt) {
  const r = await runChain([{
    role: "user",
    content: `${prompt}\n\nAnswer in under 150 words. Name specific companies, products or sources where you know of them. If you do not know of any, say so plainly rather than guessing.`,
  }], 400);
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
  env = process.env, engine = null, fetchImpl = fetch, maxPrompts = MAX_PROMPTS_PER_AUDIT,
} = {}) {
  const chosen = resolveEngine(env, engine);
  if (!chosen) return null;

  const list = (prompts && prompts.length ? prompts : defaultPrompts({ brand, topic, host }))
    .slice(0, maxPrompts);
  if (list.length === 0) return null;

  const runs = [];
  let failures = 0;

  for (const prompt of list) {
    const r = chosen === "perplexity"
      ? await askPerplexity(prompt, env, fetchImpl)
      : await askAiChain(prompt);

    if (!r.ok) { failures += 1; runs.push({ prompt, error: r.error, mention: null, citation: null }); continue; }

    const mention = mentionsBrand(r.text, brand);
    const citation = citesDomain(r.citations, r.text, host);
    runs.push({
      prompt,
      mention,
      citation,
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
      engine: chosen, live: chosen === "perplexity",
      promptCount: 0, mentions: 0, citations: 0, sentiment: null,
      runs, error: runs[0]?.error || "sampling failed",
    };
  }

  const sentiments = answered.map((r) => r.sentiment).filter((s) => Number.isFinite(s));
  return {
    engine: chosen,
    live: chosen === "perplexity",
    promptCount: answered.length,
    mentions: answered.filter((r) => r.mention).length,
    citations: answered.filter((r) => r.citation).length,
    sentiment: sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null,
    runs,
    failures,
    error: null,
  };
}
