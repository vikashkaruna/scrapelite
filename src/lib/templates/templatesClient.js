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
import { getAuthToken, apiClient } from "../apiClient.js";
import { CAPABILITY_SCHEMAS } from "../extractionSchemas.js";

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
/**
 * Run a template's SYNTHESIS prompt over the facts we just extracted.
 *
 * ⚠️ THIS STEP DID NOT EXIST. Every seed template ships a `prompt_bundle` with
 * `summarize` and `talking_points` prompts, and a grep of the whole repository
 * found no consumer for either — the runner used only `.extract`, then set
 * `summary = scraped?.ai_summary`, a field extractStructure() never returns.
 * So the AI-call branch was dead code, `output_schema.blocks` declared a
 * `summary` block and a `talking_points` list that could never be populated,
 * and an "Intelligence Workflow" was in practice one scrape plus a JSON dump.
 */
async function synthesise(prompt, { facts, target, title, pageText, label }) {
  if (!prompt) return null;
  const body =
    `${prompt}\n\n` +
    `Ground every statement in the material below. Where it does not support a claim, say so ` +
    `rather than inventing one — this output is read as research, and an invented fact is worse ` +
    `than an acknowledged gap.\n\n` +
    `TARGET: ${target}\n` +
    `TITLE: ${title || "(untitled)"}\n\n` +
    `EXTRACTED FACTS (schema-validated, evidence-backed):\n${JSON.stringify(facts ?? {}, null, 2).slice(0, 12000)}\n` +
    (pageText ? `\nSOURCE PAGE CONTENT:\n${String(pageText).slice(0, 20000)}\n` : "");
  try {
    const res = await apiClient.ai({
      messages: [{ role: "user", content: body }],
      max_tokens: 2048,
      area: "synthesis",
    });
    const text = (res?.content || []).map((b) => b.text).filter(Boolean).join("\n").trim();
    return text || null;
  } catch (err) {
    // A failed synthesis must not fail the RUN — the extracted facts are still
    // worth persisting and the user is still charged only for what happened.
    console.warn(`[DatIQ] template synthesis (${label}) failed:`, err?.message);
    return null;
  }
}

/**
 * Execute a started run.
 *
 * `events` accumulates what we ACTUALLY did, so the ledger charges for real
 * work and nothing else. A cache hit, a skipped unchanged page, or a provider
 * failure is recorded with its flag and creditModel drops it — the user is
 * never billed for a page we did not read, or an AI call that did not land.
 */
// ── Multi-company runs ───────────────────────────────────────────────────────
// The AI Visibility Brief reads your site AND up to four competitors under the
// SAME capability schema. That sameness is the whole point: four differently
// shaped summaries are not a comparison, they are four summaries. Reading them
// like-for-like is what lets the synthesis say "you and Competitor B both
// claim the mid-market; only they price for it."

const COMPARISON_CAPABILITY = "mission";

/** Read one company's positioning + pricing. Never throws — a competitor we
 *  could not read is reported as unread, not as having nothing. */
async function readCompany(domain, promptExtra) {
  const target = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    const scraped = await extractStructure(target, {
      customPrompt: promptExtra,
      enrichKey: COMPARISON_CAPABILITY,
    });
    return {
      domain, target, ok: true,
      facts: scraped?.custom_extraction ?? null,
      title: scraped?.page_title || domain,
      pageText: scraped?.page_text || "",
      pagesRead: [target, ...(scraped?.related_pages_scanned || [])],
      reason: scraped?.custom_extraction_reason || null,
      meta: scraped?.enrichment_meta || null,
    };
  } catch (err) {
    return { domain, target, ok: false, error: err?.message || "Could not read this site", pagesRead: [] };
  }
}

/**
 * Execute the AI Visibility Brief: read every company, then synthesise a
 * comparison, a positioning brief and a prioritised change list from the
 * combined facts.
 */
async function executeVisibilityBrief({ template, input, onProgress }) {
  const say = (msg, pct) => onProgress?.({ message: msg, percent: pct });
  const events = [];
  const sources = [];

  const own = String(input.domain || "").trim();
  if (!own) throw new Error("This brief needs your own domain to run against.");
  const competitors = (Array.isArray(input.competitors) ? input.competitors : [])
    .map((d) => String(d).trim()).filter(Boolean).slice(0, 4);

  say(competitors.length
    ? `Reading ${competitors.length + 1} companies…`
    : "Reading your site…", 15);

  const extra = template.prompt_bundle?.extract;
  // Concurrent: five independent sites, and a serial walk would put a
  // five-company brief well past any reasonable wait.
  const companies = await Promise.all([own, ...competitors].map((d) => readCompany(d, extra)));
  const [self, ...rivals] = companies;

  for (const c of companies) {
    events.push({ unit: "page", credits: Math.max(1, c.pagesRead.length), quantity: Math.max(1, c.pagesRead.length), failed: !c.ok });
    for (const url of c.pagesRead) {
      sources.push({ url, canonical_url: c.domain, fetched_at: new Date().toISOString(), http_status: 200 });
    }
  }

  if (!self.ok || !self.facts) {
    // Without our own positioning there is nothing to compare AGAINST, and a
    // brief built on competitors alone would be a different (and unrequested)
    // deliverable.
    throw new Error(
      self.reason
        ? `We could not read enough from ${own} to build a brief (${self.reason}).`
        : `We could not read ${own}.`
    );
  }

  say("Comparing positioning…", 55);

  const factsBlock = companies
    .filter((c) => c.ok && c.facts)
    .map((c) => `### ${c.domain}${c.domain === own ? " (YOUR COMPANY)" : " (competitor)"}\n${JSON.stringify(c.facts, null, 2).slice(0, 7000)}`)
    .join("\n\n");
  const unread = companies.filter((c) => !c.ok || !c.facts).map((c) => c.domain);
  const unreadNote = unread.length
    ? `\n\nNOT READ (do not invent facts for these, and say they were not read if they matter): ${unread.join(", ")}`
    : "";

  const bundle = template.prompt_bundle || {};
  const audienceLine = {
    gtm: "a go-to-market team deciding where to focus next quarter",
    founder: "a founder deciding what to change about how the company presents itself",
    marketing: "a marketing team about to rewrite the site's core pages",
  }[input.audience] || "a go-to-market team";

  const synthCtx = {
    facts: null, target: own, title: self.title,
    pageText: `Written for ${audienceLine}.\n\nCOMPANY FACTS:\n${factsBlock}${unreadNote}`,
  };

  const [summary, points, comparisonRaw] = await Promise.all([
    synthesise(bundle.summarize, { ...synthCtx, label: "summarize" }),
    synthesise(bundle.talking_points, { ...synthCtx, label: "talking_points" }),
    // The comparison is asked for as JSON so it renders as a real grid rather
    // than prose that happens to mention several companies.
    synthesiseJson(bundle.comparison, synthCtx),
  ]);
  for (const r of [summary, points, comparisonRaw]) if (r) events.push({ unit: "ai_call", credits: 2, quantity: 1 });

  say("Done", 100);

  const output = {
    target: own,
    title: self.title,
    fields: self.facts,
    evidence: Array.isArray(self.facts?.evidence) ? self.facts.evidence : null,
    extraction: self.meta,
    comparison: comparisonRaw || null,
    companies: companies.map((c) => ({
      domain: c.domain, ok: c.ok, pagesRead: c.pagesRead,
      reason: c.reason || (c.ok ? null : c.error),
    })),
    unread,
  };
  if (points) output.talking_points = splitPoints(points);

  return {
    output, summary,
    talking_points: output.talking_points || null,
    events, sources,
    // Honest about a competitor we could not read: the brief is real, but it
    // is not the brief the user asked for if a competitor is missing from it.
    partial: !summary || unread.length > 0,
    needsReview: unread.length > 0,
  };
}

/** Synthesis that must come back as JSON (the comparison grid). */
async function synthesiseJson(prompt, ctx) {
  const text = await synthesise(
    prompt
      ? `${prompt}\n\nReturn ONLY a JSON object: {"axes": string[], "rows": [{"company": string, "values": {"<axis>": string|null}}]}. No prose, no markdown fences.`
      : null,
    { ...ctx, label: "comparison" },
  );
  if (!text) return null;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed?.rows) && parsed.rows.length ? parsed : null;
  } catch {
    // A comparison we cannot parse is dropped, not shown as broken JSON — the
    // rest of the brief is still worth reading.
    return null;
  }
}

export async function executeRun({ template, input, onProgress }) {
  // Multi-company templates take their own path — one target cannot produce a
  // comparison, and bolting competitors onto the single-target flow would make
  // both harder to follow.
  if (template.template_key === "ai_visibility_brief") {
    return executeVisibilityBrief({ template, input, onProgress });
  }

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
      // A template whose key matches a first-class capability gets that
      // capability's JSON Schema and its related-page gathering for free.
      enrichKey: CAPABILITY_SCHEMAS[template.template_key] ? template.template_key : undefined,
    });
  } catch (e) {
    events.push({ unit: "page", credits: 1, failed: true });
    throw e;
  }

  const pagesRead = Array.isArray(scraped?.related_pages_scanned)
    ? 1 + scraped.related_pages_scanned.length
    : 1;
  events.push({ unit: "page", credits: pagesRead, quantity: pagesRead, cached: !!scraped?._cached });
  sources.push({
    url: target,
    canonical_url: input.domain || null,
    fetched_at: new Date().toISOString(),
    provider: scraped?.enrichment_meta?.provider || scraped?._provider || null,
    http_status: 200,
  });
  // Every related page we actually read is a source in its own right — a brief
  // that quotes a /pricing page must be able to say where the quote came from.
  for (const url of scraped?.related_pages_scanned || []) {
    sources.push({ url, canonical_url: input.domain || null, fetched_at: new Date().toISOString(), http_status: 200 });
  }

  say("Structuring what we found…", 45);

  const facts = scraped?.custom_extraction ?? scraped?.structured ?? null;
  const output = {
    target,
    title: scraped?.page_title || scraped?.title || input.domain || target,
    fields: facts,
    // The evidence quotes behind each fact, lifted out so a report renderer
    // can show "where this came from" per field rather than per run.
    evidence: facts && Array.isArray(facts.evidence) ? facts.evidence : null,
    headings: scraped?.headings ?? [],
    links: scraped?.links ?? [],
    extraction: scraped?.enrichment_meta ?? null,
    raw: scraped ?? null,
  };

  say("Writing the brief…", 70);

  const bundle = template.prompt_bundle || {};
  const ctx = {
    facts, target, title: output.title,
    pageText: scraped?.page_text || "",
  };
  // Concurrent: they read the same facts and neither depends on the other.
  const [summary, talkingPoints] = await Promise.all([
    synthesise(bundle.summarize, { ...ctx, label: "summarize" }),
    synthesise(bundle.talking_points, { ...ctx, label: "talking_points" }),
  ]);

  // Charge per AI call that actually LANDED. A failed synthesis is free.
  if (summary) events.push({ unit: "ai_call", credits: 2, quantity: 1 });
  if (talkingPoints) events.push({ unit: "ai_call", credits: 2, quantity: 1 });

  if (talkingPoints) output.talking_points = splitPoints(talkingPoints);

  // The run is PARTIAL when the facts came back empty or the synthesis the
  // template promised could not be produced — saying so is what stops a thin
  // report being read as a complete one.
  const wantedSummary = Boolean(bundle.summarize);
  const partial = !facts || (wantedSummary && !summary);
  const needsReview = Boolean(
    scraped?.custom_extraction_reason || (facts && Array.isArray(facts.not_found) && facts.not_found.length)
  );

  say("Done", 100);
  return { output, summary, events, sources, partial, needsReview };
}

/**
 * Turn a numbered/bulleted synthesis reply into a list the report can render.
 * Falls back to the whole string as one item — losing the text because it did
 * not match a bullet pattern would be worse than an unsplit list.
 */
export function splitPoints(text) {
  const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const points = lines
    .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, "").trim())
    .filter(Boolean);
  if (points.length) return points;
  return lines.length ? lines : [String(text || "").trim()].filter(Boolean);
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
