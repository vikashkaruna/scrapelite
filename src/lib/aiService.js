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
