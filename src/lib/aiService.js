// aiService.js — produces a plain-language summary of an extraction.
//
// • No VITE_AI_API_KEY → mocked: a simulated delay + a short dummy summary.
// • Key present        → real Anthropic (Claude) call.
//
// SECURITY NOTE: a browser-side key is visible to end users. The real path is
// provided so engineering can drop in a backend proxy later; for production,
// route this through a server / edge function instead of shipping the key.

import { hasAI, AI_API_KEY, AI_MODEL } from "./config.js";
import { hostOf } from "./utils.js";
import { categoryOf, isCategory, CATEGORY_KEYS } from "./linkCategorizer.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MOCK_DELAY_MS = 1200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock path ────────────────────────────────────────────────────────────────
async function mockSummary(extraction) {
  await delay(MOCK_DELAY_MS);
  // If the fixture already carries a summary (the Lumio demo does), keep it.
  if (extraction.ai_summary) return extraction.ai_summary;

  const host = hostOf(extraction.url);
  const h = extraction.headings?.length || 0;
  const l = extraction.links?.length || 0;
  const topic = extraction.headings?.[0]?.text || extraction.page_title || host;
  return (
    `This page from ${host} centers on “${topic}”, organized across ${h} headings that move from ` +
    `the main message into supporting detail. It surfaces ${l} links that guide visitors toward ` +
    `related content and clear next steps.`
  );
}

// ── Real path ────────────────────────────────────────────────────────────────
function buildPrompt(extraction) {
  const headings = (extraction.headings || []).map((h) => `${h.tag}: ${h.text}`).join("\n");
  const links = (extraction.links || []).map((l) => `- ${l.text} → ${l.href}`).join("\n");
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

async function realSummary(extraction) {
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_API_KEY,
      "anthropic-version": "2023-06-01",
      // Required to call the API directly from a browser context.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: buildPrompt(extraction) }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI summary request failed (${res.status}). ${detail}`.trim());
  }

  const json = await res.json();
  const text = json?.content?.map((b) => b.text).filter(Boolean).join("\n").trim();
  return text || (await mockSummary(extraction));
}

/**
 * Summarize an extraction.
 * @param {{url:string, page_title:string, headings:Array, links:Array, ai_summary?:string}} extraction
 * @returns {Promise<string>}
 */
export async function summarize(extraction) {
  return hasAI ? realSummary(extraction) : mockSummary(extraction);
}

// ── AI link categorization ────────────────────────────────────────────────────
// Tags each link with one category (internal/external/social/email/document/media).
// Heuristics run always as a reliable baseline; when VITE_AI_API_KEY is set, a single
// batched Claude call refines the labels. Any failure falls back to the heuristics,
// so categorization can never break an extraction.

const MAX_AI_LINKS = 60; // keep the prompt (and cost) bounded on link-heavy pages

function buildCategorizePrompt(links, baseUrl) {
  const list = links.map((l, i) => `${i}. ${l.text || "(no text)"} -> ${l.href}`).join("\n");
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
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: Math.min(1024, links.length * 6 + 60),
      messages: [{ role: "user", content: buildCategorizePrompt(links, baseUrl) }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI categorization request failed (${res.status}). ${detail}`.trim());
  }
  const json = await res.json();
  const text = json?.content?.map((b) => b.text).filter(Boolean).join("\n") || "";
  return parseCategoryArray(text);
}

/**
 * Tag each link with a category. Always returns links with a valid `category`.
 * @param {Array<{text:string, href:string}>} links
 * @param {string} baseUrl
 * @returns {Promise<Array<{text:string, href:string, category:string}>>}
 */
export async function categorizeLinks(links, baseUrl) {
  const base = (links || []).map((l) => ({ ...l, category: categoryOf(l.href, baseUrl) }));
  if (!hasAI || base.length === 0 || base.length > MAX_AI_LINKS) return base;

  try {
    const aiCats = await aiCategorize(base, baseUrl);
    return base.map((l, i) => (isCategory(aiCats[i]) ? { ...l, category: aiCats[i] } : l));
  } catch (err) {
    console.warn("[ScrapeLite] AI link categorization failed; using heuristics.", err);
    return base;
  }
}

// Re-export so callers can import categorization helpers from one place.
export { CATEGORY_KEYS };
