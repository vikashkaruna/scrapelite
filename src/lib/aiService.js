// aiService.js — AI summarization, link categorization, and content generation.
//
// Architecture (V2 API layer):
//   UI → aiService → /api/ai (Netlify Function) → Anthropic Claude
//
// The VITE_AI_API_KEY is now a feature flag only. The actual key lives in the
// Netlify Function and is never bundled or sent from the browser.
// The "anthropic-dangerous-direct-browser-access" header is no longer needed.
//
// ── MOCK MODE IS NOW EXPLICIT, NOT A FAILURE HANDLER ─────────────────────────
// Every AI call used to `catch` and silently return locally-generated fixture
// prose. That meant a dead provider account produced text that LOOKED like a
// real AI summary — "This page from acme.com centers on …, organized across 16
// headings" — with a provenance badge saying ai_generated. The product was
// asserting things about a customer's page that nothing had read.
//
// Mocks now run ONLY in mock mode (extraction itself mocked, i.e.
// VITE_ENABLE_EXTRACT unset). In live mode a failure is REPORTED: the
// *Detailed() functions return { ok:false, code, hint } and the UI shows a
// degraded state naming the cause. Degrading the experience is fine.
// Fabricating a claim about someone's data is not.


import { hasAI, hasFirecrawl, AI_MODEL } from "./config.js";
import { apiClient } from "./apiClient.js";
import { hostOf } from "./utils.js";
import { categoryOf, isCategory, CATEGORY_KEYS } from "./linkCategorizer.js";
import { PERSONA_BY_ID } from "./personaConfig.js";

// True when the whole pipeline is in fixture mode. Tied to the extraction flag
// because a mocked summary of a real page is the failure this file exists to
// prevent, while a mocked summary of a mocked page is coherent.
const MOCK_MODE = !hasFirecrawl;

const MOCK_DELAY_MS = 1200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shared helper — calls /api/ai and extracts the text content ───────────────
async function callAI(messages, max_tokens = 1024, opts = {}) {
  const data = await apiClient.ai({
    model: AI_MODEL, max_tokens, messages,
    ...(opts.area ? { area: opts.area } : {}),
    ...(opts.tier ? { tier: opts.tier } : {}),
  });
  const text = (data?.content?.map((b) => b.text).filter(Boolean).join("\n").trim()) || "";
  return { text, provider: data?._provider, model: data?._model, tier: data?._tier };
}

/**
 * Normalise a thrown apiClient error into the same { code, hint } vocabulary
 * /api/ai returns, so the UI has one thing to render whether the failure was a
 * 502 with a body or a network drop with none.
 */
function describeAiFailure(err) {
  // apiClient lifts the server's `code`/`hint` onto the Error itself.
  const code = err?.code || (err?.status === 503 ? "no_key" : "error");
  const hint = err?.hint || AI_FAILURE_HINTS[code] || AI_FAILURE_HINTS.error;
  return { ok: false, code, hint, status: err?.status ?? null };
}

// Mirrors PROVIDER_ERROR_COPY server-side. Duplicated rather than imported
// because this file must stay importable in the browser bundle without
// pulling in the Netlify function tree.
export const AI_FAILURE_HINTS = {
  no_key:        "AI is not configured on this server. An administrator needs to set an AI provider key.",
  bad_key:       "The AI provider rejected the API key. An administrator needs to reissue it.",
  no_credit:     "The AI provider account is out of credit. An administrator needs to top up billing.",
  rate_limited:  "The AI provider is rate-limiting requests. Try again in a moment.",
  bad_model:     "The configured AI model is unavailable. An administrator needs to change it.",
  provider_down: "The AI provider is having an outage. Try again shortly.",
  timeout:       "The AI provider did not respond in time. Try again.",
  network:       "Could not reach the AI provider.",
  error:         "The AI request failed.",
};

// ── Summarize ─────────────────────────────────────────────────────────────────

// Per-intent focus clause so the summary leans toward what the user actually
// asked for, without turning it into a duplicate of the dedicated Quick
// Enrichment extraction (which is a separate, structured-data call).
const INTENT_FOCUS = {
  contacts: " Prioritize anything relevant to leadership, founders, or how to contact the company.",
  pricing: " Prioritize anything relevant to pricing, plans, or cost.",
};

function intentFocusLine(intent) {
  return INTENT_FOCUS[intent] || "";
}

// Frames WHO the summary is for. Falls back to the original generic wording
// when no persona is known (anonymous/guest users, or callers that don't
// pass context) — this keeps existing behavior byte-identical in that case.
function audienceLine(personaId) {
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  if (!persona) return "a non-technical researcher";
  return `a ${persona.label} professional — ${persona.tagline.replace(/\.$/, "").toLowerCase()}`;
}

/**
 * @param {object} extraction
 * @param {{personaId?: string, intent?: string}} [context] - who the summary
 *   is for (persona) and what they asked for (intent), so the prompt reads
 *   contextually instead of one generic wording for every user and mode.
 */
// How much page body to put in a prompt. The body is the ONLY reason these
// summaries can say anything specific; before it existed, every summary was
// written from a heading list and a link dump, which is why they read like a
// table of contents and why "Competitor Summary" was an LLM guessing about a
// company from its navigation menu.
const SUMMARY_BODY_CHARS = 18_000;
const CONTENT_BODY_CHARS = 24_000;

/** The page body, if the server sent one. Falls back to pasted raw text. */
function bodyTextOf(extraction, limit) {
  const text = extraction?.page_text || extraction?.raw_text || "";
  return String(text).slice(0, limit);
}

function buildSummaryPrompt(extraction, context = {}) {
  const audience = audienceLine(context.personaId);
  const focus = intentFocusLine(context.intent);
  const body = bodyTextOf(extraction, SUMMARY_BODY_CHARS);
  const headings = (extraction.headings || []).slice(0, 60).map((h) => `${h.tag}: ${h.text}`).join("\n");

  // Paste-anything keeps its own framing — there is no URL or structure to
  // describe, only the content the user handed us.
  if (extraction.raw_text && !extraction.page_text) {
    return (
      `You are summarizing pasted content for ${audience}.\n` +
      `Write a single concise paragraph (3–5 sentences) describing what the content is about, ` +
      `its key points, and its apparent intent.${focus} Do not use markdown.\n\n` +
      `Content:\n${body}\n`
    );
  }

  if (!body) {
    // Degraded input: structure only. Say so in the prompt rather than letting
    // the model invent specifics it has no basis for — an unsupported claim in
    // a summary gets copied into a deck and never questioned again.
    return (
      `You are summarizing a web page for ${audience}.\n` +
      `You have ONLY the page's structure (title, headings, links) — not its body text. ` +
      `Write 2–3 sentences describing what the page appears to cover and how it is organised. ` +
      `Do not state specific facts, figures, names or claims you cannot see.${focus} Do not use markdown.\n\n` +
      `URL: ${extraction.url}\nTitle: ${extraction.page_title}\n\nHeadings:\n${headings}\n`
    );
  }

  return (
    `You are a research analyst writing for ${audience}.\n\n` +
    `Write a substantive 4–6 sentence brief on this page. Cover, in this order and only where the ` +
    `content supports it: what the organisation or page actually offers; who it is for; how it is ` +
    `positioned or priced; and the single most notable specific detail on the page (a named customer, ` +
    `a figure, a differentiator, a constraint).${focus}\n\n` +
    `Rules:\n` +
    `- Be specific. Name things. A summary that would fit any company in the category is a failed summary.\n` +
    `- Every claim must be supported by the content below. Do not use outside knowledge of this company.\n` +
    `- If the page is thin, say what it is and stop. Do not pad.\n` +
    `- Plain prose, no markdown, no headings, no bullet points.\n\n` +
    `URL: ${extraction.url}\n` +
    `Title: ${extraction.page_title}\n\n` +
    `PAGE CONTENT:\n${body}\n`
  );
}

async function mockSummary(extraction) {
  await delay(MOCK_DELAY_MS);
  if (extraction.ai_summary) return extraction.ai_summary;
  const host = hostOf(extraction.url);
  const h = extraction.headings?.length || 0;
  const l = extraction.links?.length || 0;
  const topic = extraction.headings?.[0]?.text || extraction.page_title || host;
  return (
    `This page from ${host} centers on "${topic}", organized across ${h} headings that move from ` +
    `the main message into supporting detail. It surfaces ${l} links that guide visitors toward ` +
    `related content and clear next steps.`
  );
}

/**
 * Summarize an extraction, reporting HOW it went.
 * @returns {Promise<{ok:boolean, text:string, code?:string, hint?:string, provider?:string, model?:string, mocked?:boolean}>}
 */
export async function summarizeDetailed(extraction, context = {}) {
  if (MOCK_MODE) {
    return { ok: true, text: await mockSummary(extraction), mocked: true };
  }
  try {
    const r = await callAI(
      [{ role: "user", content: buildSummaryPrompt(extraction, context) }],
      700,
      { area: "synthesis" },
    );
    if (r.text) return { ok: true, text: r.text, provider: r.provider, model: r.model };
    // A 200 with no text is still a failure — it must not become fixture prose.
    return { ok: false, text: "", code: "empty", hint: "The AI returned an empty summary." };
  } catch (err) {
    const failure = describeAiFailure(err);
    console.warn("[DatIQ] AI summary failed:", failure.code, err?.message);
    return { ...failure, text: "" };
  }
}

/**
 * Summarize an extraction.
 *
 * Returns "" when AI is unavailable in live mode — deliberately, so a caller
 * that ignores the failure renders nothing rather than fabricated prose. Use
 * summarizeDetailed() when you can surface the reason (every UI caller should).
 * @returns {Promise<string>}
 */
export async function summarize(extraction, context = {}) {
  return (await summarizeDetailed(extraction, context)).text;
}

// Exposed for tests — not part of the public summarization API.
export { buildSummaryPrompt as _buildSummaryPrompt };

// ── Link categorization ───────────────────────────────────────────────────────

const MAX_AI_LINKS = 60;

function buildCategorizePrompt(links, baseUrl) {
  const list = links
    .map((l, i) => `${i}. ${l.text || "(no text)"} -> ${l.href}`)
    .join("\n");
  return (
    `Classify each link found on the page at ${baseUrl} into exactly ONE category:\n` +
    `- internal: same website as the page\n` +
    `- external: a different website\n` +
    `- social: a social-media or community platform (e.g. Twitter/X, LinkedIn, YouTube, GitHub)\n` +
    `- email: a mailto link\n` +
    `- document: a downloadable file (pdf, doc, xls, ppt, csv, zip…)\n` +
    `- media: an image, video, or audio file\n\n` +
    `Return ONLY a JSON array of lowercase category strings — one per link, in the same order. ` +
    `No explanations, no markdown.\n\nLinks:\n${list}\n`
  );
}

function parseCategoryArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array in AI response");
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error("AI response was not an array");
  return arr.map((v) => String(v).trim().toLowerCase());
}

async function aiCategorize(links, baseUrl) {
  // Deliberately the FAST tier: this is bulk classification with a fixed
  // six-way answer space. Frontier pricing buys nothing here, and the budget
  // is better spent on synthesis.
  const { text } = await callAI(
    [{ role: "user", content: buildCategorizePrompt(links, baseUrl) }],
    Math.min(2048, links.length * 8 + 120),
    { area: "classification", tier: "fast" },
  );
  return parseCategoryArray(text);
}

/**
 * Tag each link with a category. Always returns links with a valid `category`.
 * @param {Array<{text:string, href:string}>} links
 * @param {string} baseUrl
 * @returns {Promise<Array<{text:string, href:string, category:string}>>}
 */
export async function categorizeLinks(links, baseUrl) {
  const base = (links || []).map((l) => ({
    ...l,
    category: categoryOf(l.href, baseUrl),
  }));
  // Unlike summaries, falling back here is honest: `categoryOf()` is a real
  // deterministic classifier, not fixture prose, and every link keeps a valid
  // category either way. This is a refinement that may be skipped, not a
  // claim that may be fabricated.
  if (!hasAI || MOCK_MODE || base.length === 0 || base.length > MAX_AI_LINKS) return base;

  try {
    const aiCats = await aiCategorize(base, baseUrl);
    return base.map((l, i) =>
      isCategory(aiCats[i]) ? { ...l, category: aiCats[i] } : l
    );
  } catch (err) {
    console.warn("[DatIQ] AI link categorization failed; using heuristics.", err);
    return base;
  }
}

// ── Content generation ────────────────────────────────────────────────────────

export const CONTENT_FORMATS = [
  {
    key: "seo-outline",
    label: "SEO Blog Outline",
    icon: "list-tree",
    desc: "A ready-to-write blog structure with H2/H3 sections.",
    instruction:
      "Produce an SEO-optimized blog post outline. Include a working title, a meta " +
      "description (≤155 chars), 4–6 H2 sections each with 2–3 H3 sub-points, and a " +
      "short list of target keywords. Use markdown headings.",
  },
  {
    key: "competitor-summary",
    label: "Competitor Summary",
    icon: "search",
    desc: "A concise competitive brief on this page's company.",
    instruction:
      "Write a competitor summary brief for a sales/strategy audience. Cover: what " +
      "the company does, positioning & value proposition, apparent target customers, " +
      "notable strengths, and likely gaps. Keep it tight and scannable with markdown.",
  },
  {
    key: "social-posts",
    label: "Social Posts",
    icon: "share",
    desc: "Three short promotional posts for social channels.",
    instruction:
      "Write 3 short, punchy social media posts (LinkedIn tone) promoting the value " +
      "of this page's offering. Number them. Each ≤ 3 sentences with a light hook.",
  },
  {
    key: "compare",
    label: "Compare",
    icon: "git-compare",
    desc: "5-axis competitive comparison framework from this page.",
    instruction:
      "From the page content, derive a competitive comparison framework with 5 axes " +
      "(e.g. pricing model, target customer, key strength, key gap, distribution channel). " +
      "For each axis, give the position inferred from this page in 1–2 sentences. Use a " +
      "markdown table. Be precise — only state things supported by the material.",
  },
  {
    key: "explain",
    label: "Explain",
    icon: "help-circle",
    desc: "Plain-language explanation of what this page offers.",
    instruction:
      "Explain the page in plain language as if to a smart non-expert. Start with a " +
      "one-sentence summary, then 3 short sections: (1) what the offering is, (2) who " +
      "it is for, (3) why someone would choose it. Use markdown headings. Avoid jargon. " +
      "Base everything strictly on the material — do not invent facts.",
  },
];

function buildContentPrompt(extraction, format) {
  const body = bodyTextOf(extraction, CONTENT_BODY_CHARS);
  const headings = (extraction.headings || []).slice(0, 60).map((h) => `${h.tag}: ${h.text}`).join("\n");
  // Structured enrichment already extracted from this page is the highest-
  // confidence material available — it was schema-validated and evidence-backed.
  // Feeding it back in stops the generator re-deriving (and re-guessing) facts
  // the extractor already established.
  const facts = extraction.custom_extraction
    ? `\nVERIFIED EXTRACTED FACTS (schema-validated from this page — prefer these over your own reading):\n${
        JSON.stringify(extraction.custom_extraction).slice(0, 6000)}\n`
    : "";

  return (
    `You are a senior analyst producing a deliverable a client will read.\n\n` +
    `${format.instruction}\n\n` +
    `Non-negotiable rules:\n` +
    `- Ground every statement in the material below. Do not use outside knowledge of this company.\n` +
    `- Be concrete: name products, plans, prices, customers and figures where the material gives them.\n` +
    `- Where the material does not support a section, write "Not stated on this page" rather than inventing.\n` +
    `- No hedging filler ("leverages cutting-edge solutions"). Every sentence must carry information.\n\n` +
    `URL: ${extraction.url}\n` +
    `Title: ${extraction.page_title}\n` +
    (extraction.ai_summary ? `\nAnalyst summary of the page:\n${extraction.ai_summary}\n` : "") +
    facts +
    (body
      ? `\nPAGE CONTENT:\n${body}\n`
      : `\nPage structure only (no body text was captured — stay descriptive, claim nothing specific):\n${headings || "(none)"}\n`)
  );
}

async function mockContent(extraction, format) {
  await delay(MOCK_DELAY_MS);
  const title = extraction.page_title || hostOf(extraction.url);
  const topics = (extraction.headings || [])
    .filter((h) => /H[123]/.test(h.tag))
    .slice(0, 5);
  if (format.key === "seo-outline") {
    const lines = [
      `# ${title}: The Complete Guide`,
      ``,
      `*Meta description:* Everything you need to know about ${title} — features, benefits, and how to get started.`,
      ``,
      `**Target keywords:** ${hostOf(extraction.url)}, ${title.split(" ").slice(0, 3).join(" ")}, guide, overview`,
      ``,
    ];
    (
      topics.length
        ? topics
        : [
            { text: "Overview" },
            { text: "Key benefits" },
            { text: "Getting started" },
          ]
    ).forEach((h, i) => {
      lines.push(`## ${i + 1}. ${h.text}`);
      lines.push(`- What it means for the reader`);
      lines.push(`- Why it matters`);
      lines.push(``);
    });
    return lines.join("\n");
  }
  if (format.key === "competitor-summary") {
    return (
      `## Competitor brief: ${title}\n\n` +
      `**What they do.** ${extraction.ai_summary || `${title} positions itself around its core offering.`}\n\n` +
      `**Positioning.** Messaging centers on ${topics[0]?.text || "their primary value proposition"}.\n\n` +
      `**Strengths.** Clear structure across ${extraction.headings?.length || 0} sections; strong calls to action.\n\n` +
      `**Likely gaps.** Limited public detail on pricing depth and technical specifics.\n`
    );
  }
  if (format.key === "compare") {
    const axis = (n) => topics[n]?.text || `Dimension ${n + 1}`;
    return [
      `## Competitive comparison: ${title}\n`,
      `| Axis | Position from this page |`,
      `| --- | --- |`,
      `| **${axis(0)}** | Implied by the page's primary positioning. |`,
      `| **${axis(1)}** | ${topics[1]?.text ? `Centered on ${topics[1].text.toLowerCase()}.` : "Centered on the core value prop."} |`,
      `| **Key strength** | Clear section structure across ${extraction.headings?.length || 0} headings. |`,
      `| **Apparent gap** | Limited public detail on pricing depth & technical specifics. |`,
      `| **Distribution** | Direct web presence; relies on organic search traffic. |`,
      ``,
      `_Inferred from the page content — verify before using in a strategy doc._`,
    ].join("\n");
  }
  if (format.key === "explain") {
    return [
      `# ${title} — explained\n`,
      `${title} is a ${(extraction.ai_summary || "web offering").split(/[.!?]/)[0].toLowerCase()}.\n`,
      `## What it is`,
      `${extraction.ai_summary || `${title} provides a focused offering around ${topics[0]?.text || "its core value proposition"}.`}\n`,
      `## Who it is for`,
      `Visitors who care about ${topics[0]?.text || "the core problem"} and want a clear path to ${topics[1]?.text || "the outcome"}.\n`,
      `## Why someone would choose it`,
      `It goes straight to the point — no fluff, ${extraction.headings?.length || 0} focused sections, every page element earns its place.`,
    ].join("\n");
  }
  return (
    `1. ${title} just caught our eye — ${topics[0]?.text || "worth a look"}. Here's why it matters. 🚀\n\n` +
    `2. Stop guessing. ${title} turns ${topics[1]?.text || "complexity"} into clarity. 👇\n\n` +
    `3. If ${topics[2]?.text || "growth"} is on your roadmap, this one's for you. Link in comments.`
  );
}

/**
 * Generate marketing/analysis content, reporting HOW it went.
 * @returns {Promise<{ok:boolean, text:string, code?:string, hint?:string, mocked?:boolean}>}
 */
export async function generateContentDetailed(extraction, format) {
  if (MOCK_MODE) {
    return { ok: true, text: await mockContent(extraction, format), mocked: true };
  }
  try {
    const r = await callAI(
      [{ role: "user", content: buildContentPrompt(extraction, format) }],
      // Raised from 1024: a competitive brief or SEO outline truncated
      // mid-sentence reads as a broken product, and the tokens are cheap
      // relative to a deliverable somebody forwards to a client.
      4096,
      { area: "synthesis" },
    );
    if (r.text) return { ok: true, text: r.text, provider: r.provider, model: r.model };
    return { ok: false, text: "", code: "empty", hint: "The AI returned no content." };
  } catch (err) {
    const failure = describeAiFailure(err);
    console.warn("[DatIQ] AI content generation failed:", failure.code, err?.message);
    return { ...failure, text: "" };
  }
}

/**
 * Generate content from a saved extraction.
 *
 * THROWS in live mode when AI is unavailable, because every caller of this
 * function renders its result as the user's requested deliverable — silently
 * substituting fixture prose there is the fabrication this refactor removes.
 * Callers already have try/catch around it.
 * @param {object} extraction
 * @param {{key:string, instruction:string}} format - one of CONTENT_FORMATS
 * @returns {Promise<string>} markdown content
 */
export async function generateContent(extraction, format) {
  const r = await generateContentDetailed(extraction, format);
  if (!r.ok) {
    const err = new Error(r.hint || "AI content generation is unavailable.");
    err.code = r.code;
    err.aiUnavailable = true;
    throw err;
  }
  return r.text;
}

// Re-export so callers can import categorization helpers from one place.
export { CATEGORY_KEYS };
