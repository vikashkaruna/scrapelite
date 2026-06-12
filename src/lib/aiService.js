// aiService.js — AI summarization, link categorization, and content generation.
//
// Architecture (V2 API layer):
//   UI → aiService → /api/ai (Netlify Function) → Anthropic Claude
//
// The VITE_AI_API_KEY is now a feature flag only. The actual key lives in the
// Netlify Function and is never bundled or sent from the browser.
// The "anthropic-dangerous-direct-browser-access" header is no longer needed.
//
// Mock path: no key configured → simulated delay + fixture content.
// Real path: key configured → POST /api/ai → Claude on the server.

import { hasAI, AI_MODEL } from "./config.js";
import { apiClient } from "./apiClient.js";
import { hostOf } from "./utils.js";
import { categoryOf, isCategory, CATEGORY_KEYS } from "./linkCategorizer.js";

const MOCK_DELAY_MS = 1200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shared helper — calls /api/ai and extracts the text content ───────────────
async function callAI(messages, max_tokens = 1024) {
  const data = await apiClient.ai({ model: AI_MODEL, max_tokens, messages });
  return (
    data?.content
      ?.map((b) => b.text)
      .filter(Boolean)
      .join("\n")
      .trim() || ""
  );
}

// ── Summarize ─────────────────────────────────────────────────────────────────

function buildSummaryPrompt(extraction) {
  const headings = (extraction.headings || [])
    .map((h) => `${h.tag}: ${h.text}`)
    .join("\n");
  const links = (extraction.links || [])
    .map((l) => `- ${l.text} → ${l.href}`)
    .join("\n");
  return (
    `You are summarizing a web page for a non-technical researcher.\n` +
    `Write a single concise paragraph (3–5 sentences) describing what the page is about, ` +
    `how it is structured, and its apparent intent. Do not use markdown.\n\n` +
    `URL: ${extraction.url}\n` +
    `Title: ${extraction.page_title}\n\n` +
    `Headings:\n${headings}\n\n` +
    `Links:\n${links}\n`
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

async function realSummary(extraction) {
  try {
    const text = await callAI(
      [{ role: "user", content: buildSummaryPrompt(extraction) }],
      400
    );
    return text || (await mockSummary(extraction));
  } catch (err) {
    console.warn("[DatIQ] AI summary unavailable, using fallback:", err?.message);
    return mockSummary(extraction);
  }
}

/**
 * Summarize an extraction.
 * @param {object} extraction
 * @returns {Promise<string>}
 */
export async function summarize(extraction) {
  return hasAI ? realSummary(extraction) : mockSummary(extraction);
}

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
  const text = await callAI(
    [{ role: "user", content: buildCategorizePrompt(links, baseUrl) }],
    Math.min(1024, links.length * 6 + 60)
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
  if (!hasAI || base.length === 0 || base.length > MAX_AI_LINKS) return base;

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
];

function buildContentPrompt(extraction, format) {
  const headings = (extraction.headings || [])
    .map((h) => `${h.tag}: ${h.text}`)
    .join("\n");
  return (
    `You are a content marketer working from data scraped from a web page.\n` +
    `${format.instruction}\n\n` +
    `Base everything strictly on the material below — do not invent facts.\n\n` +
    `URL: ${extraction.url}\n` +
    `Title: ${extraction.page_title}\n\n` +
    `AI summary of the page:\n${extraction.ai_summary || "(none)"}\n\n` +
    `Headings:\n${headings || "(none)"}\n`
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
  return (
    `1. ${title} just caught our eye — ${topics[0]?.text || "worth a look"}. Here's why it matters. 🚀\n\n` +
    `2. Stop guessing. ${title} turns ${topics[1]?.text || "complexity"} into clarity. 👇\n\n` +
    `3. If ${topics[2]?.text || "growth"} is on your roadmap, this one's for you. Link in comments.`
  );
}

async function realContent(extraction, format) {
  try {
    const text = await callAI(
      [{ role: "user", content: buildContentPrompt(extraction, format) }],
      1024
    );
    return text || (await mockContent(extraction, format));
  } catch (err) {
    console.warn("[DatIQ] AI content generation unavailable, using fallback:", err?.message);
    return mockContent(extraction, format);
  }
}

/**
 * Generate marketing content from a saved extraction.
 * @param {object} extraction
 * @param {{key:string, instruction:string}} format - one of CONTENT_FORMATS
 * @returns {Promise<string>} markdown content
 */
export async function generateContent(extraction, format) {
  return hasAI ? realContent(extraction, format) : mockContent(extraction, format);
}

// Re-export so callers can import categorization helpers from one place.
export { CATEGORY_KEYS };
