// auditPipeline.js — the seven stages, in order.
//
//   1. audit.fetch      raw HTML, headers, robots, crawler access
//   2. audit.render     rendered DOM via the scrape chain
//   3. audit.parse      headings, schema, passages, entities
//   4. audit.score      sub-signals, pillars, penalties, framework views
//   5. audit.recommend  issues → prioritised recommendations → constructs
//   6. audit.report     assemble the JSON payload
//   7. audit.notify     handled by the caller (webhooks, events)
//
// Stages 1 and 2 are fused in collectPage() because they run concurrently.
//
// ── EVERY STAGE IS INDIVIDUALLY SURVIVABLE ─────────────────────────────────
// A stage that fails records why and leaves its signals unmeasured; the audit
// still completes with everything else. PageSpeed being rate-limited must not
// cost the user their heading analysis. `stageErrors` records what was lost, so
// a thin result is visibly thin rather than quietly passed off as complete.
//
// ── THE AUDIT IS PURE OF PERSISTENCE ───────────────────────────────────────
// Nothing here writes to a database or reads a session. It takes a URL and
// returns a payload. That is what lets the same function serve the interactive
// API, the scheduled monitor and the test suite without a Supabase in sight.

import { parsePage, findSchema } from "./htmlParse.js";
import { collectPage, checkCanonicalTarget, CANONICAL_TIMEOUT_MS } from "./fetchLayer.js";
import { analyseAnswerClarity } from "./answerAnalysis.js";
import { analyseStructure } from "./structureAnalysis.js";
import { analyseEntityAuthority } from "./entityAnalysis.js";
import { analyseTechnical } from "./technicalAnalysis.js";
import { fetchWebVitals, webVitalsAvailable, PSI_TIMEOUT_MS } from "./webVitals.js";
import { sampleCitations, resolveEngine } from "./citationSampling.js";
import { evaluatePassage, aiEvaluationEnabled } from "./aiEvaluator.js";
import { createDeadline, budgetFromEnv } from "./deadline.js";
import { scoreAudit } from "../../../../src/lib/discoverability/scoringModel.js";
import { buildRecommendation, rankRecommendations, estimateTotalLift, estimateUnblockedLift, applyDependencies }
  from "../../../../src/lib/discoverability/recommendationModel.js";
import { buildConstruct } from "../../../../src/lib/discoverability/constructTemplates.js";
import { severityTally, ISSUES } from "../../../../src/lib/discoverability/issueCatalog.js";
import { applyProfile, AUDIT_PROFILES, applyPageTypePack, notApplicableSignals, packFor }
  from "../../../../src/lib/discoverability/auditProfiles.js";

export const PIPELINE_STAGES = Object.freeze([
  "audit.fetch", "audit.render", "audit.parse",
  "audit.score", "audit.recommend", "audit.report",
]);

/** Facts the construct generators need, gathered from the parsed page. */
function constructFacts(parsed, url) {
  const org = findSchema(parsed.jsonLd || [], "Organization");
  const article = findSchema(parsed.jsonLd || [], "Article")
    || findSchema(parsed.jsonLd || [], "BlogPosting");
  let host = "";
  let origin = "";
  try { const u = new URL(url); host = u.hostname; origin = u.origin; } catch { /* unparseable */ }

  return {
    answer_block: {
      question: parsed.headingStats?.h1Text || parsed.meta?.title || "",
      existingText: parsed.passages?.[0]?.text || "",
      subject: org?.name || host,
    },
    content_block: parsed.faqPairs || [],
    jsonld_organization: {
      name: org?.name || "", url: org?.url || origin, logo: org?.logo || "",
      description: org?.description || parsed.meta?.description || "",
      sameAs: [].concat(org?.sameAs || []).filter((s) => typeof s === "string"),
    },
    jsonld_person: {
      name: parsed.author?.name || "",
      sameAs: parsed.author?.sameAs || [],
    },
    jsonld_article: {
      headline: parsed.headingStats?.h1Text || parsed.meta?.title || "",
      description: parsed.meta?.description || "",
      url, author: parsed.author?.name || "", publisher: org?.name || "",
      datePublished: parsed.dates?.published || "", dateModified: parsed.dates?.modified || "",
    },
    jsonld_faq: parsed.faqPairs || [],
    jsonld_howto: { name: parsed.headingStats?.h1Text || "", steps: parsed.steps || [] },
    jsonld_breadcrumb: [],
    heading_tree: (parsed.headings || []).map((h) => ({ level: h.level, text: h.text, originalLevel: h.level })),
    meta_tags: {
      title: parsed.meta?.title || "", description: parsed.meta?.description || "",
      brand: org?.name || "", primaryPhrase: parsed.headingStats?.h1Text || "",
    },
    robots_txt: { sitemapUrl: origin ? `${origin}/sitemap.xml` : "" },
    entity_card: {
      brand: org?.name || host,
      description: org?.description || parsed.meta?.description || "",
      sameAs: [].concat(org?.sameAs || []).filter((s) => typeof s === "string"),
    },
    author_bio: { name: parsed.author?.name || "", profileUrl: "" },
  };
}

/**
 * Run a complete audit.
 *
 * @param {string} url
 * @param {object} options
 * @param {"mobile"|"desktop"} [options.deviceProfile]
 * @param {string} [options.auditProfile]     balanced | seo | aeo | geo
 * @param {string} [options.pageTypeHint]
 * @param {string[]} [options.prompts]        prompt set for citation sampling
 * @param {boolean} [options.skipWebVitals]
 * @param {boolean} [options.skipCitations]
 * @param {boolean} [options.skipAi]
 * @param {number}  [options.now]             injected clock, for reproducibility
 */
export async function runAudit(url, options = {}) {
  const env = options.env || process.env;
  const now = options.now ?? Date.now();
  const deviceProfile = options.deviceProfile === "desktop" ? "desktop" : "mobile";
  const auditProfile = AUDIT_PROFILES[options.auditProfile] ? options.auditProfile : "balanced";
  const stageErrors = [];
  const startedAt = now;

  // ── The wall-clock budget ────────────────────────────────────────────────
  // Every stage below is bounded by what is LEFT of this, not just by its own
  // timeout. Without it the per-call timeouts compose additively across the
  // serial stages and the whole audit reaches ~155s against a function that is
  // killed at 10-26s — which is what produced `POST /audits failed (504)`.
  // See deadline.js for the measurements.
  const deadline = options.deadline || createDeadline(options.budgetMs ?? budgetFromEnv(env));

  // ── 1 + 2. fetch and render, concurrently ────────────────────────────────
  const collected = await collectPage(url, { env, deadline });
  if (!collected.ok) {
    // No HTML at all. This is a completed audit reporting an unreachable page,
    // not a failed job — the technical facts we DID gather (status, robots) are
    // exactly what the user needs, so they are returned rather than discarded.
    return {
      status: "completed",
      url,
      unreachable: true,
      stageErrors: [{ stage: "audit.fetch", error: collected.fetch.error || "no HTML returned" }],
      ...emptyResultShell({ url, deviceProfile, auditProfile, now, collected }),
    };
  }

  // ── 3. parse ─────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parsePage(collected.primaryHtml, url);
  } catch (err) {
    stageErrors.push({ stage: "audit.parse", error: err?.message || "parse failed" });
    parsed = parsePage("", url);
  }

  // The page type has to be settled BEFORE scoring, not after: its rule pack
  // decides which signals this template has no obligation to satisfy, and that
  // has to reach scoreAudit() as an unknown rather than being retro-fitted to
  // a score already computed.
  const pageType = options.pageTypeHint && packFor(options.pageTypeHint).id !== "page"
    ? options.pageTypeHint
    : inferPageType(parsed);
  const pack = packFor(pageType);

  // ── external evidence, all optional, all concurrent ──────────────────────
  const org = findSchema(parsed.jsonLd || [], "Organization");
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* unparseable */ }
  const brand = org?.name || parsed.meta?.title?.split(/[|\-—]/).pop()?.trim() || host;

  // These four are independent and run concurrently, so this stage costs the
  // slowest of them. Each is handed the time that is actually LEFT — and a
  // stage with no room is not started at all.
  //
  // Running out of time is just another reason a signal could not be measured,
  // so a skipped stage becomes `null` exactly like a rate-limited PageSpeed:
  // its weight redistributes (rule 1.1) and `coverage` reports the thinness.
  // A thin audit that says it is thin beats a 504 that says nothing.
  const budgetLeft = deadline.remaining();
  const vitalsSlice = deadline.sliceFor(PSI_TIMEOUT_MS);
  const citationBudget = deadline.signalFor(deadline.remaining());
  const aiBudget = deadline.signalFor(deadline.remaining());
  const canonicalSlice = deadline.sliceFor(CANONICAL_TIMEOUT_MS);

  const wantVitals = !options.skipWebVitals && webVitalsAvailable(env) && vitalsSlice > 0;
  const wantCitations = !options.skipCitations
    && Boolean(resolveEngine(env, options.citationEngine)) && Boolean(citationBudget);
  const wantAi = !options.skipAi && aiEvaluationEnabled(env) && Boolean(aiBudget);
  const answerText = parsed.passages?.[0]?.text || "";

  // A budget can be allocated and then not used, because the stage was skipped
  // for a different reason (`skipCitations`, no engine configured). Release the
  // timer rather than leaving it pending — the `.finally()` handlers below only
  // run for the stages that actually started.
  if (!wantCitations) citationBudget?.clear();
  if (!wantAi) aiBudget?.clear();

  const outOfTime = [];
  if (!options.skipWebVitals && webVitalsAvailable(env) && !wantVitals) outOfTime.push("core_web_vitals");
  if (!options.skipCitations && resolveEngine(env, options.citationEngine) && !wantCitations) outOfTime.push("citation_footprint");
  if (!options.skipAi && aiEvaluationEnabled(env) && !wantAi) outOfTime.push("passage_independence");
  for (const signal of outOfTime) {
    stageErrors.push({
      stage: "audit.score", signal,
      error: `skipped: ${Math.round(budgetLeft)}ms of the ${deadline.totalMs}ms audit budget remained`,
    });
  }

  const [vitalsResult, citationResult, aiResult, canonicalStatus] = await Promise.all([
    wantVitals
      ? fetchWebVitals(url, { env, strategy: deviceProfile, timeoutMs: vitalsSlice }).catch(() => null)
      : Promise.resolve(null),
    wantCitations
      ? sampleCitations({
          brand, host, topic: parsed.headingStats?.h1Text || parsed.meta?.title || "",
          prompts: options.prompts, env, engine: options.citationEngine,
          signal: citationBudget.signal, timeoutMs: citationBudget.ms,
        }).catch(() => null).finally(() => citationBudget.clear())
      : Promise.resolve(null),
    wantAi
      ? evaluatePassage({
          answerText,
          heading: parsed.passages?.[0]?.heading || "",
          title: parsed.meta?.title || "", h1: parsed.headingStats?.h1Text || "",
          signal: aiBudget.signal,
        }).catch(() => null).finally(() => aiBudget.clear())
      : Promise.resolve(null),
    canonicalSlice > 0
      ? checkCanonicalTarget(parsed.meta?.canonical, url, { timeoutMs: canonicalSlice }).catch(() => null)
      : Promise.resolve(null),
  ]);

  // `unavailable` distinguishes "we asked and got nothing" from "we never asked".
  const webVitals = vitalsResult && !vitalsResult.unavailable ? vitalsResult : null;
  if (vitalsResult?.unavailable) stageErrors.push({ stage: "audit.score", signal: "core_web_vitals", error: vitalsResult.error });
  if (citationResult?.error) stageErrors.push({ stage: "audit.score", signal: "citation_footprint", error: citationResult.error });

  // ── 4. analyse and score ─────────────────────────────────────────────────
  const answer = analyseAnswerClarity(parsed, { aiEvaluated: Boolean(aiResult) });
  const structure = analyseStructure(parsed, {});
  const entity = analyseEntityAuthority(parsed, { now, citationSample: citationResult });

  // The FAQ mismatch penalty belongs to the technical layer but is only
  // detectable by the structural comparison, so it is threaded across.
  const faqMismatch = structure.issues.some((i) => i.code === "SH-07");
  const technical = analyseTechnical(parsed, {
    url,
    fetch: collected.fetch,
    aiCrawlerAccess: collected.aiCrawlerAccess,
    robotsError: collected.robotsError,
    webVitals,
    canonicalStatus,
    faqMismatch,
  });

  const analyses = [answer, structure, entity, technical];
  const signalValues = Object.assign({}, ...analyses.map((a) => a.signals));
  const unknownReasons = Object.assign({}, ...analyses.map((a) => a.reasons));

  // Signals this TEMPLATE has no obligation to satisfy become not-applicable,
  // so their weight redistributes rather than the page being marked down for a
  // defect it structurally cannot have. A pricing page has no procedure to
  // describe; scoring its absent HowTo markup at 25 would be inventing a fault.
  for (const code of notApplicableSignals(pageType)) {
    if (signalValues[code] !== null && signalValues[code] !== undefined) {
      signalValues[code] = null;
      unknownReasons[code] = "not_applicable";
    }
  }

  // The model refines the deterministic pre-screen, bounded and marked down.
  if (aiResult?.passageIndependence !== null && aiResult?.passageIndependence !== undefined) {
    signalValues.passage_independence = aiResult.passageIndependence;
  }

  const scored = applyProfile(
    scoreAudit({
      signalValues,
      unknownReasons,
      penaltyCodes: technical.penalties || [],
    }),
    auditProfile,
  );

  // ── 5. recommend ─────────────────────────────────────────────────────────
  const rawIssues = analyses
    .flatMap((a) => a.issues)
    // The pack removes findings this template cannot have and promotes the ones
    // it cares about most. Filtering here rather than at render time keeps the
    // issue list, the recommendation queue and the stored JSON in agreement.
    .filter((i) => !pack.suppress.includes(i.code));
  // De-duplicate: two analysers can legitimately notice the same defect (the
  // entity analyser and the technical analyser both see "no structured data").
  const seen = new Set();
  const issues = [];
  for (const i of rawIssues) {
    if (seen.has(i.code)) continue;
    seen.add(i.code);
    const meta = ISSUES[i.code];
    if (!meta) continue;
    issues.push({
      code: i.code, pillar: meta.pillar, severity: meta.severity,
      frameworks: [...meta.frameworks], title: meta.title,
      evidence: i.evidence || "", details: i.details || null,
    });
  }
  const packedIssues = applyPageTypePack(issues, pageType);

  const facts = constructFacts(parsed, url);
  const recommendations = rankRecommendations(
    applyDependencies(rawIssues
      .filter((i, idx) => rawIssues.findIndex((x) => x.code === i.code) === idx)
      .map((i) => {
        const rec = buildRecommendation(i.code, {
          signalCode: i.signalCode,
          measuredScore: i.measuredScore,
          evidence: i.evidence,
          details: i.details,
          confidenceOverride: i.confidenceOverride,
          // Lets the queue price the multiplicative blocker a fix removes, not
          // just the signal points it recovers. Without these two, "remove the
          // noindex" ranks below content polish on an unindexable page.
          prePenaltyScore: scored.scoreMath?.prePenaltyTotal ?? null,
          activePenalties: technical.penalties || [],
        });
        if (!rec) return null;
        rec.implementationAsset = rec.assetType
          ? buildConstruct(rec.assetType, facts[rec.assetType])
          : null;
        return rec;
      })
      .filter(Boolean),
    technical.penalties || []),
  );

  // ── 6. report ────────────────────────────────────────────────────────────
  return {
    status: "completed",
    url,
    unreachable: false,
    stageErrors,
    target: {
      url,
      canonical_url: parsed.meta?.canonical || null,
      final_url: collected.fetch.finalUrl,
      page_type: pageType,
      page_type_label: pack.label,
      language: parsed.meta?.lang || null,
      device_profile: deviceProfile,
      audit_profile: auditProfile,
    },
    ...scored,
    issues: packedIssues,
    severityTally: severityTally(packedIssues),
    recommendations,
    estimatedTotalLift: estimateTotalLift(recommendations),
    estimatedUnblockedLift: estimateUnblockedLift(recommendations),
    facts: {
      technical: technical.facts,
      content: { ...answer.facts, ...structure.facts, word_count: parsed.wordCount, truncated: parsed.truncated },
      entity: entity.facts,
    },
    evidence: {
      heading_outline: structure.facts.heading_outline,
      schema_types: parsed.schemaTypes || [],
      direct_answer_blocks: answer.facts.direct_answer_blocks,
      faq_pairs: (parsed.faqPairs || []).slice(0, 20),
      ai_notes: aiResult?.notes || null,
      citation_runs: (citationResult?.runs || []).slice(0, MAX_STORED_RUNS),
    },
    meta: {
      startedAt,
      durationMs: Date.now() - startedAt,
      engine: {
        renderer: collected.fetch.renderer,
        headlessAvailable: collected.fetch.headlessAvailable,
        webVitalsSource: webVitals?.source || null,
        citationEngine: citationResult?.engine || null,
        citationLive: Boolean(citationResult?.live),
        aiProvider: aiResult?.provider || null,
      },
    },
  };
}

/**
 * How many sampled answers to keep.
 *
 * Answer-engine output is volatile and can be policy-sensitive, so the guidance
 * is to store limited excerpts and normalised evidence rather than full
 * transcripts. Ten runs with a 300-character excerpt each is enough to show a
 * user why their citation score is what it is.
 */
export const MAX_STORED_RUNS = 10;

/** Best guess at the page type, used to select the rule pack. */
export function inferPageType(parsed) {
  const types = (parsed.schemaTypes || []).map((t) => String(t).toLowerCase());
  if (types.includes("faqpage")) return "faq";
  if (types.includes("howto")) return "howto";
  if (types.includes("product")) return "product";
  if (types.includes("article") || types.includes("blogposting")) return "article";

  const h1 = (parsed.headingStats?.h1Text || "").toLowerCase();
  const title = (parsed.meta?.title || "").toLowerCase();
  const both = `${h1} ${title}`;
  if (/\b(pricing|plans?|cost)\b/.test(both)) return "pricing";
  if (/\bhow to\b/.test(both)) return "howto";
  if (/\b(faq|frequently asked)\b/.test(both)) return "faq";
  if (/\b(docs?|documentation|reference|api)\b/.test(both)) return "docs";
  if ((parsed.faqPairs || []).length >= 3) return "faq";
  if ((parsed.wordCount || 0) > 600) return "article";
  return "page";
}

/** The shape returned when a page could not be fetched at all. */
function emptyResultShell({ url, deviceProfile, auditProfile, now, collected }) {
  const scored = scoreAudit({ signalValues: {}, penaltyCodes: [] });
  const issueCode = collected.fetch.status && collected.fetch.status !== 200 ? "TA-04" : "TA-04";
  const rec = buildRecommendation(issueCode, {
    evidence: collected.fetch.status
      ? `The page returned HTTP ${collected.fetch.status}.`
      : `The page could not be fetched: ${collected.fetch.error}.`,
  });
  const issue = {
    code: issueCode, pillar: ISSUES[issueCode].pillar, severity: ISSUES[issueCode].severity,
    frameworks: [...ISSUES[issueCode].frameworks], title: ISSUES[issueCode].title,
    evidence: rec.evidence, details: { status: collected.fetch.status, error: collected.fetch.error },
  };
  return {
    target: {
      url, canonical_url: null, final_url: collected.fetch.finalUrl || url,
      page_type: "unknown", language: null,
      device_profile: deviceProfile, audit_profile: auditProfile,
    },
    ...scored,
    issues: [issue],
    severityTally: severityTally([issue]),
    recommendations: [rec],
    estimatedTotalLift: 0,
    facts: { technical: { http_status: collected.fetch.status, error: collected.fetch.error }, content: {}, entity: {} },
    evidence: {},
    meta: { startedAt: now, durationMs: Date.now() - now, engine: {} },
  };
}
