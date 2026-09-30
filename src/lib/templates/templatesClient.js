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
import { buildTemplateSchema } from "./templateSchema.js";

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
async function synthesise(prompt, { facts, target, title, pageText, label, maxTokens = 2048 }) {
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
      max_tokens: maxTokens,
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
    if (scraped?.mock) {
      // Same rule as executeRun: the visibility brief bills per company read;
      // mock "facts" must never be compared, synthesised, or ledgered.
      return { domain, target, ok: false, error: "Extraction is not configured on this deployment (VITE_ENABLE_EXTRACT).", pagesRead: [] };
    }
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
    pageText: `Written for ${audienceLine}.${inputContext(template, input)}\n\nCOMPANY FACTS:\n${factsBlock}${unreadNote}`,
  };

  // ai_depth applies here too (the same Customize panel promise): quick runs
  // extraction-only, so a missing synthesis must never flag the brief as
  // incomplete; deep gives the comparison a bigger budget.
  const depth = input?.ai_depth === "deep" || input?.ai_depth === "quick" ? input.ai_depth : "standard";
  const synthesisTokens = depth === "deep" ? 4096 : 2048;
  const runSynthesis = depth !== "quick";
  const [summary, points, comparisonRaw] = runSynthesis
    ? await Promise.all([
        synthesise(bundle.summarize, { ...synthCtx, label: "summarize", maxTokens: synthesisTokens }),
        synthesise(bundle.talking_points, { ...synthCtx, label: "talking_points", maxTokens: synthesisTokens }),
        // The comparison is asked for as JSON so it renders as a real grid rather
        // than prose that happens to mention several companies.
        synthesiseJson(bundle.comparison, synthCtx),
      ])
    : [null, null, null];
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
    // Quick mode deliberately forgoes the summary — its absence must not flag
    // the brief as incomplete for a choice the user made themselves.
    partial: (runSynthesis && !summary) || unread.length > 0,
    needsReview: unread.length > 0,
    informationAbsent: false,
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

/**
 * Render the template's OWN inputs as prompt context.
 *
 * 🔴 THIS EXISTED NOWHERE, AND THAT WAS A REAL BUG. `account_brief` declares an
 * `angle` input ("Discovery call" / "Displacing an incumbent" / "Expansion") —
 * it is shown, validated, stored on the run, and CHARGED FOR. It was never
 * read. The user picked "Displacing an incumbent", paid 8 credits, and got a
 * brief written as though they had picked nothing, because the model was never
 * told. Nothing failed; the output was simply answering a different question.
 *
 * Driven off `input_schema.fields` rather than a per-template list, so a new
 * template's inputs reach its prompt the day it is seeded. A hand-maintained
 * list is how `angle` came to be forgotten in the first place.
 *
 * `domain`/`url` are excluded: they are the TARGET, already stated in the
 * prompt, and repeating them as "preferences" invites the model to treat the
 * address as a topic.
 */
function inputContext(template, input) {
  const fields = template?.input_schema?.fields;
  if (!Array.isArray(fields) || !input) return "";
  const lines = [];
  for (const f of fields) {
    if (!f?.name || f.name === "domain" || f.name === "url") continue;
    const raw = input[f.name];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!value.trim()) continue;
    // Show the human LABEL for a choice, not the stored value — the model
    // reasons better about "Displacing an incumbent" than about "displacement".
    const opt = Array.isArray(f.options) ? f.options.find((o) => o.value === raw) : null;
    lines.push(`- ${f.label || f.name}: ${opt?.label || value}`);
  }
  return lines.length
    ? `\n\nWHAT THE USER ASKED FOR (shape the output to this — it is why they ran the template):\n${lines.join("\n")}\n`
    : "";
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
    // ── THE TEMPLATE'S OWN SCHEMA DRIVES THE EXTRACTION ─────────────────────
    // Two inputs the user can see and change must actually DO something:
    //   • custom_fields (Customize → Additional Custom Extraction Fields) were
    //     validated and then thrown away — the model never heard about them.
    //   • the template's extraction_schema (the fields the template PROMISES
    //     on its gallery card) were never used server-side at all; templates
    //     whose related_key is not a capability fell back to the loose custom
    //     shape. buildTemplateSchema turns both into a real JSON schema the
    //     server enforces, with per-field not_found reporting.
    const { schema, groups, instruction } = buildTemplateSchema(
      template, Array.isArray(input?.custom_fields) ? input.custom_fields : [],
    );
    scraped = await extractStructure(target, {
      customPrompt: template.prompt_bundle?.extract,
      // A template whose key matches a first-class capability gets that
      // capability's JSON Schema and its related-page gathering for free.
      //
      // ⚠️ `related_key` is the fallback and it is LOAD-BEARING. No seed
      // template key matches a CAPABILITY_SCHEMAS key — the schemas are keyed
      // by capability (contacts/pricing/…), the templates by template key, and
      // the two sets are disjoint — so before this every template fell through
      // to guessRelatedPageHintsKey(), a first-match regex written for
      // free-text prompts typed on Home. Measured, it sent FIVE of seven
      // templates to `pricing` because their extract prompts all mention a
      // price: the Due Diligence Brief went looking for team, founding year
      // and customers on /pricing and never opened /about, and Customer Proof
      // guessed nothing at all and read the homepage alone. A template knows
      // what it needs; it now says so.
      enrichKey: CAPABILITY_SCHEMAS[template.template_key]
        ? template.template_key
        : (template.related_key || undefined),
      // The template's schema + instruction: the fields it promises, plus the
      // operator's free-text addendum and their declared choices (e.g. the
      // recruiter template's target department) — the choices are the reason
      // they ran the template and the extraction must hear them, not only the
      // synthesis.
      schema,
      groups,
      instruction: [
        instruction,
        input?.custom_prompt?.trim() ? `Also honour this specific request: ${input.custom_prompt.trim()}` : null,
        inputContext(template, input) || null,
      ].filter(Boolean).join("\n\n"),
      // The Customize panel's "Additional Subpages to Inspect" (0–4 extra).
      extra_pages: Number(input?.extra_subpages) > 0 ? Math.min(4, Number(input.extra_subpages)) : undefined,
    });
  } catch (e) {
    events.push({ unit: "page", credits: 1, failed: true });
    throw e;
  }

  // 🔴 A paid template run must never be built on demo data. When this
  // deployment runs the browser-side mock scraper (VITE_ENABLE_EXTRACT
  // unset), the "facts" below would be the placeholder from mockData.js —
  // billed, persisted, and rendered as if they were real. Abort BEFORE
  // startRun so no credits are consumed and nothing is ledgered.
  if (scraped?.mock) {
    throw new Error(
      "Extraction is not configured on this deployment, so this run would produce demo data. " +
      "Set VITE_ENABLE_EXTRACT=1 and rebuild (locally: up.sh local web) before running templates."
    );
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
    // The user's own choices come FIRST in the material, before the page text:
    // they are the instruction, the page is the evidence.
    pageText: `${inputContext(template, input)}${scraped?.page_text || ""}`,
  };
  // ai_depth (the Customize panel) decides synthesis: "quick" is extraction
  // only — no summary is wanted, so a missing one can never flag the run as
  // incomplete. "deep" gives the synthesis a bigger budget for rigorous
  // cross-checking; "standard" is the shipped default.
  const depth = input?.ai_depth === "deep" || input?.ai_depth === "quick" ? input.ai_depth : "standard";
  const synthesisTokens = depth === "deep" ? 4096 : 2048;
  // Concurrent: they read the same facts and none depends on the others.
  //
  // ⚠️ `questions` USED TO BE DECLARED AND NEVER RUN. The Due Diligence Brief
  // ships a `questions` prompt and an output block titled "Questions worth
  // asking" that reads `from: "questions"` — and nothing executed the prompt or
  // populated the key, so the block could never appear. Exactly the defect this
  // file already fixed once for `summarize`/`talking_points`; `questions` was
  // missed because only that template declares it. A prompt in a seed is a
  // promise on a screen — if it is not run, do not ship it in the bundle.
  const runSynthesis = depth !== "quick";
  const [summary, talkingPoints, questions] = runSynthesis
    ? await Promise.all([
        synthesise(bundle.summarize, { ...ctx, label: "summarize", maxTokens: synthesisTokens }),
        synthesise(bundle.talking_points, { ...ctx, label: "talking_points", maxTokens: synthesisTokens }),
        synthesise(bundle.questions, { ...ctx, label: "questions", maxTokens: synthesisTokens }),
      ])
    : [null, null, null];

  // Charge per AI call that actually LANDED. A failed synthesis is free.
  if (summary) events.push({ unit: "ai_call", credits: 2, quantity: 1 });
  if (talkingPoints) events.push({ unit: "ai_call", credits: 2, quantity: 1 });
  if (questions) events.push({ unit: "ai_call", credits: 2, quantity: 1 });

  if (talkingPoints) output.talking_points = splitPoints(talkingPoints);
  if (questions) output.questions = splitPoints(questions);

  // 🔴 "WE FAILED" AND "THIS SITE DOES NOT PUBLISH THAT" ARE DIFFERENT
  // ANSWERS, AND ONLY ONE OF THEM IS OUR FAULT.
  //
  // This used to be `partial = !facts || …`, so a Competitor Pricing Tracker
  // run against a company that simply does not publish pricing was labelled
  // "some of what this template promises could not be produced from the pages
  // we could read" — telling the user the tool had fallen short when it had in
  // fact done its job and returned a true, useful finding: this company keeps
  // its pricing off its website. The report even SAID so, immediately above a
  // banner contradicting it.
  //
  // The reason vocabulary already draws this line (see ENRICH_REASON in
  // netlify/functions/extract.js and the note in aiFailureCopy.js: "`no_match`
  // is a real finding"). `no_match` means we read the pages fine and the
  // information is not there. Everything else — an unreadable page, an AI
  // fault — is genuinely incomplete and retrying may help.
  const reason = scraped?.custom_extraction_reason || null;
  // An `ai_*` code or an unreadable page is OUR fault and retrying may help.
  // Everything else is either a stated finding (`no_match`) or no reason at all.
  const operatorFault = /^ai_/.test(reason || "") || reason === "page_no_content";
  //
  // THREE INDEPENDENT SIGNALS THAT THE INFORMATION SIMPLY IS NOT PUBLISHED:
  //
  //   1. The server said so outright (`no_match`).
  //   2. The SYNTHESIS SUCCEEDED. This one matters because the server does not
  //      always record a reason, and a coherent, specific summary about the
  //      company is proof we read the page perfectly well. If we could write
  //      about it and only the STRUCTURED extraction came back empty, the
  //      template's fields are not on that site — a finding, not a failure.
  //      Without this, a Customer Proof Extractor run against a company with
  //      no published case studies produced an accurate summary saying exactly
  //      that, directly above a banner claiming we had fallen short.
  //   3. The schema-driven extraction ANSWERED and named the specific fields
  //      it could not verify in `not_found` (the templateSchema contract).
  //      A partially-populated run whose missing fields are NAMED is a
  //      finding about the site, not an incomplete run.
  const absentFields = Array.isArray(facts?.not_found)
    ? facts.not_found.map((s) => String(s)).filter(Boolean)
    : [];
  const informationAbsent =
    (!facts && !operatorFault && Boolean(summary)) || (Boolean(facts) && absentFields.length > 0);
  const wantedSummary = runSynthesis && Boolean(bundle.summarize);
  const partial = (!facts && !informationAbsent) || (wantedSummary && !summary);
  const needsReview = Boolean(
    (reason && !informationAbsent) || absentFields.length
  );

  say("Done", 100);
  // Surfaced separately from `partial` so the UI can say the true thing:
  // "this site does not publish that" instead of "we could not produce it".
  // `absentFields` lets the UI name the EXACT fields the schema-driven
  // extraction could not verify (including operator-added custom fields),
  // instead of re-deriving a list from the template's declared fields.
  return { output, summary, events, sources, partial, needsReview, informationAbsent, absentFields };
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

/**
 * Resolve a typed company NAME to a confirmed domain.
 *
 * Returns `{ best, candidates }` where `best` may be null — a miss is the
 * expected outcome for any company whose domain does not derive from its name,
 * and the caller must treat it as "type it yourself", never as an error.
 */
export async function resolveCompany(name) {
  // Its own endpoint, not a /api/templates action: it charges nothing, needs no
  // template, and runs while the user is still deciding what to research.
  const res = await fetch("/api/resolve-company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return res.json();
}
