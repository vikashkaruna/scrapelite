// aiEvaluator.js — the contextual half of the hybrid engine.
//
// The functional spec calls for a hybrid: deterministic rules for headings,
// schema, bots, canonicals and performance thresholds; a model for the
// judgements that genuinely need reading comprehension — does this passage
// stand alone, does the H1 match what the page is actually about.
//
// ── THREE RULES THIS MODULE OBEYS ──────────────────────────────────────────
// 1. IT IS ALWAYS OPTIONAL. Every function returns null on any failure and the
//    audit proceeds on its deterministic scores. An AI outage must never take
//    an audit down; the deterministic pre-screens in htmlParse.js exist exactly
//    so there is always a number.
// 2. IT REFINES, IT DOES NOT REPLACE. The model adjusts a score the rules
//    already produced, within a bounded range. A model that hallucinated "your
//    heading tree is perfect" must not be able to overwrite a measured count of
//    skipped levels.
// 3. IT IS MARKED DOWN. Findings it originates carry lower confidence, so a
//    fluent guess cannot outrank a measured fact in the recommendation queue.

import { runChain } from "../aiProviders.js";

/** Confidence ceiling for anything the model originated. */
export const AI_CONFIDENCE = 70;
/** The most the model may move a deterministic score, in points. */
export const MAX_ADJUSTMENT = 30;

function clampAdjustment(base, proposed) {
  if (!Number.isFinite(base)) return proposed;
  if (!Number.isFinite(proposed)) return base;
  const lo = Math.max(0, base - MAX_ADJUSTMENT);
  const hi = Math.min(100, base + MAX_ADJUSTMENT);
  return Math.max(lo, Math.min(hi, proposed));
}

/** Pull the first JSON object out of a model reply that may be wrapped in prose. */
export function extractJson(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : String(text);
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

/**
 * Judge whether the primary answer passage survives being quoted alone, and
 * whether the H1 matches what the page is actually about.
 *
 * @returns {Promise<null|{passageIndependence, intentAlignment, notes}>}
 */
export async function evaluatePassage({ answerText = "", heading = "", title = "", h1 = "", baseline = {} } = {}) {
  if (!answerText || answerText.length < 40) return null;

  const prompt = [
    "You are auditing a web page for answer-engine readiness. Reply with ONLY a JSON object, no prose.",
    "",
    `Page title: ${title || "(none)"}`,
    `H1: ${h1 || "(none)"}`,
    `Section heading: ${heading || "(none — this is the page lede)"}`,
    "",
    "Passage:",
    `"""${answerText.slice(0, 1500)}"""`,
    "",
    "Return exactly this shape:",
    "{",
    '  "passage_independence": <0-100, how well the passage stands alone when quoted with no surrounding page>,',
    '  "intent_alignment": <0-100, how well the H1 and title describe what this passage is actually about>,',
    '  "notes": "<one sentence, max 25 words, on the single biggest weakness>"',
    "}",
    "",
    "Score strictly. A passage opening with an unexplained pronoun, or that assumes the reader has read something above it, is not independent.",
  ].join("\n");

  try {
    const r = await runChain([{ role: "user", content: prompt }], 300);
    if (!r.ok) return null;
    const parsed = extractJson(r.text);
    if (!parsed) return null;

    const pi = Number(parsed.passage_independence);
    const ia = Number(parsed.intent_alignment);
    return {
      passageIndependence: Number.isFinite(pi)
        ? clampAdjustment(baseline.passageIndependence, Math.max(0, Math.min(100, pi)))
        : null,
      intentAlignment: Number.isFinite(ia) ? Math.max(0, Math.min(100, ia)) : null,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 200) : null,
      provider: r.provider,
    };
  } catch {
    return null;
  }
}

/**
 * Suggest question-shaped headings for a page that has none.
 *
 * Purely additive: it produces a construct the user may adopt. It touches no
 * score, so a bad suggestion costs a reader ten seconds rather than corrupting
 * their trend line.
 */
export async function suggestQuestionHeadings({ headings = [], topic = "" } = {}) {
  if (headings.length === 0) return null;
  const prompt = [
    "Rewrite these web-page section headings as the questions a reader would actually type or ask.",
    "Keep each under 12 words. Do not invent sections that are not listed.",
    "Reply with ONLY a JSON object: { \"headings\": [{ \"original\": \"...\", \"question\": \"...\" }] }",
    "",
    topic ? `Page topic: ${topic}` : "",
    "",
    ...headings.slice(0, 12).map((h) => `- ${h}`),
  ].filter(Boolean).join("\n");

  try {
    const r = await runChain([{ role: "user", content: prompt }], 500);
    if (!r.ok) return null;
    const parsed = extractJson(r.text);
    if (!parsed || !Array.isArray(parsed.headings)) return null;
    return parsed.headings
      .filter((h) => h && typeof h.original === "string" && typeof h.question === "string")
      .slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * Draft an answer-first block from the section's own content.
 *
 * Anchored to text the page already contains. The model is explicitly forbidden
 * from introducing facts, because a construct the user pastes without reading
 * is the one place a hallucination reaches the open web under their name.
 */
export async function draftAnswerBlock({ question = "", sourceText = "" } = {}) {
  if (!sourceText || sourceText.length < 60) return null;
  const prompt = [
    "Rewrite the source text below into a direct, answer-first passage of 40 to 60 words.",
    "",
    "Hard rules:",
    "- Use ONLY facts present in the source text. Introduce nothing new.",
    "- Open by resolving the question. No preamble, no throat-clearing.",
    "- Name the subject explicitly. Never open with 'this', 'it' or 'as mentioned above'.",
    "- The passage must make complete sense quoted on its own.",
    "- If the source does not actually answer the question, reply with exactly: INSUFFICIENT",
    "",
    `Question: ${question || "(infer it from the source text)"}`,
    "",
    "Source text:",
    `"""${sourceText.slice(0, 2500)}"""`,
    "",
    "Reply with the passage only.",
  ].join("\n");

  try {
    const r = await runChain([{ role: "user", content: prompt }], 300);
    if (!r.ok) return null;
    const text = String(r.text || "").trim();
    // The model reporting insufficiency is a SUCCESS: it means it declined to
    // invent an answer the page does not contain.
    if (!text || /^INSUFFICIENT\b/i.test(text)) return null;
    const words = text.split(/\s+/).length;
    if (words > 120) return null;               // it ignored the brief; discard
    return { text, wordCount: words, provider: r.provider, aiGenerated: true };
  } catch {
    return null;
  }
}

/** Is the AI layer even worth attempting? */
export function aiEvaluationEnabled(env = process.env) {
  if (env.DISABLE_AUDIT_AI === "1") return false;
  return Boolean(env.GEMINI_API_KEY || env.AI_API_KEY || env.OPENAI_API_KEY);
}
