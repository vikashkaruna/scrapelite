// src/lib/templates/templatesClient.js — the browser side of PRD 1.
//
// Orchestrates a template run using the extraction + AI endpoints that ALREADY
// work and are already gated (/api/extract, /api/ai — the same path Home and
// Preview use). templates.js owns validation, entitlement, the estimate,
// persistence and the ledger; this module owns "actually do the work".
//
// See netlify/functions/templates.js's header for why the run is driven from
// here in Phase 1 rather than server-side: a synchronous Netlify function is
// killed at 10s and a run is 2-4 scrapes plus 1-2 AI calls. Phase 4 introduces
// a durable server runner because a 500-row list genuinely cannot be driven
// from a browser tab — but a single-target run can, and already is.

import { extractStructure } from "../firecrawlService.js";
import { getAuthToken } from "../apiClient.js";

const BASE = "/api/templates";

async function call(path = "", { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export function listTemplates() {
  return call();
}

export function getTemplate(key) {
  return call(`?key=${encodeURIComponent(key)}`);
}

export function listRuns() {
  return call("?runs=1");
}

export function getRun(runId) {
  return call(`?runId=${encodeURIComponent(runId)}`);
}

export function estimateRun(templateKey, input) {
  return call("", { method: "POST", body: { action: "estimate", templateKey, input } });
}

export function startRun(templateKey, input, workspaceId = null) {
  return call("", { method: "POST", body: { action: "start", templateKey, input, workspaceId } });
}

/**
 * Execute a started run.
 *
 * `events` accumulates what we ACTUALLY did, so the ledger charges for real
 * work and nothing else. A cache hit, a skipped unchanged page, or a provider
 * failure is recorded with its flag and creditModel drops it — the user is
 * never billed for a page we did not read.
 */
export async function executeRun({ template, input, onProgress }) {
  const events = [];
  const sources = [];
  const say = (msg, pct) => onProgress?.({ message: msg, percent: pct });

  const target = input.domain ? `https://${input.domain}` : input.url;
  if (!target) throw new Error("This template needs a domain or URL to run against.");

  say("Reading the page…", 10);

  let scraped;
  try {
    scraped = await extractStructure(target, {
      customPrompt: template.prompt_bundle?.extract,
      enrichKey: template.template_key,
    });
  } catch (e) {
    events.push({ unit: "page", credits: 1, failed: true });
    throw e;
  }

  const pagesRead = Math.max(1, scraped?._providerAttempts?.length ? 1 : 1);
  events.push({ unit: "page", credits: pagesRead, quantity: pagesRead, cached: !!scraped?._cached });
  sources.push({
    url: target,
    canonical_url: input.domain || null,
    fetched_at: new Date().toISOString(),
    provider: scraped?._provider || null,
    http_status: 200,
  });

  say("Structuring what we found…", 55);

  const output = {
    target,
    title: scraped?.page_title || scraped?.title || input.domain || target,
    fields: scraped?.custom_extraction ?? scraped?.structured ?? null,
    headings: scraped?.headings ?? [],
    links: scraped?.links ?? [],
    raw: scraped ?? null,
  };

  let summary = scraped?.ai_summary || null;
  if (summary) {
    events.push({ unit: "ai_call", credits: 2, quantity: 1 });
  }

  say("Done", 100);
  return { output, summary, events, sources };
}

export function finishRun(runId, { output, summary, events, sources, partial, needsReview }) {
  return call("", {
    method: "POST",
    body: { action: "finish", runId, output, summary, events, sources, partial, needsReview },
  });
}

export function failRun(runId, error) {
  return call("", { method: "POST", body: { action: "fail", runId, error: String(error).slice(0, 500) } });
}
