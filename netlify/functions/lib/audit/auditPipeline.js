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
import { scoreAudit, SCORING_MODEL_VERSION } from "../../../../src/lib/discoverability/scoringModel.js";
import { buildRecommendation, rankRecommendations, estimateTotalLift, estimateUnblockedLift, applyDependencies }
  from "../../../../src/lib/discoverability/recommendationModel.js";
import { buildConstruct } from "../../../../src/lib/discoverability/constructTemplates.js";
import { severityTally, ISSUES } from "../../../../src/lib/discoverability/issueCatalog.js";
import { applyProfile, AUDIT_PROFILES, applyPageTypePack, notApplicableSignals, packFor }
  from "../../../../src/lib/discoverability/auditProfiles.js";
import { resolveAuditProfile, normaliseGeography, normaliseCompetitorUrls, PRIMARY_GOALS }
  from "../../../../src/lib/discoverability/intakeModel.js";
import { createEvidenceCollector } from "./evidenceCollector.js";
import { attachEvidenceToPillars } from "../../../../src/lib/discoverability/evidenceModel.js";

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
 * @param {string} [options.auditProfile]     one of PROFILE_IDS; omit to have one chosen
 * @param {string} [options.primaryGoal]      one of PRIMARY_GOAL_IDS
 * @param {object} [options.targetGeography]  {country, region, city, language}
 * @param {string[]} [options.competitorUrls] recorded context; nothing is fetched
 * @param {string} [options.auditType]        url | domain | benchmark | prompt_monitor | rerun
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

  // ── The intake, normalised once ─────────────────────────────────────────
  // Everything the customer said before anything was fetched. It is echoed on
  // the result rather than re-read from the audit row so a guest run — which
  // has no row — carries the same shape as a stored one.
  const requestedProfile = AUDIT_PROFILES[options.auditProfile] ? options.auditProfile : null;
  const primaryGoal = PRIMARY_GOALS[options.primaryGoal] ? options.primaryGoal : null;
  const targetGeography = normaliseGeography(options.targetGeography);
  const competitorUrls = normaliseCompetitorUrls(options.competitorUrls).urls;
  const auditType = options.auditType || "url";

  // Settled TWICE, and this is the first pass: it can see the choice and the
  // goal but not the page, and it is what an unreachable URL is reported under
  // — a fetch that never returned HTML gives inference nothing to read, and a
  // profile guessed from a page we never saw would be a fabrication.
  let { profile: auditProfile, source: auditProfileSource } =
    resolveAuditProfile({ requested: requestedProfile, primaryGoal });

  const intake = {
    audit_type: auditType,
    primary_goal: primaryGoal,
    target_geography: targetGeography,
    competitor_urls: competitorUrls,
  };
  const stageErrors = [];
  const startedAt = now;

  // ── The wall-clock budget ────────────────────────────────────────────────
  // Every stage below is bounded by what is LEFT of this, not just by its own
  // timeout. Without it the per-call timeouts compose additively across the
  // serial stages and the whole audit reaches ~155s against a function that is
  // killed at 10-26s — which is what produced `POST /audits failed (504)`.
  // See deadline.js for the measurements.
  const deadline = options.deadline || createDeadline(options.budgetMs ?? budgetFromEnv(env));

  // Every observation any analyser makes is recorded here, at the point it is
  // made, and lands on the signal or issue it supports. `now` rather than a
  // clock read per record: two observations from the same audit run must carry
  // the same collection timestamp, or a diff between two audits starts showing
  // sub-second jitter as though it were change.
  const evidence = createEvidenceCollector({ url, collectedAt: now });

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
      intake,
      ...emptyResultShell({ url, deviceProfile, auditProfile, auditProfileSource, now, collected }),
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

  // ── The second pass, now that the page has spoken ───────────────────────
  // Re-settled rather than patched: `resolveAuditProfile` is ordered, so
  // handing it the page as well can only ever fill the slot nothing else
  // claimed. An explicit choice and a stated goal both still outrank whatever
  // the schema says, and the source travels with the answer so the report can
  // tell the customer which of the four reasons they are reading this view for.
  ({ profile: auditProfile, source: auditProfileSource } = resolveAuditProfile({
    requested: requestedProfile,
    primaryGoal,
    pageType,
    schemaTypes: parsed.schemaTypes || [],
  }));

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
  const answer = analyseAnswerClarity(parsed, { aiEvaluated: Boolean(aiResult), evidence });
  const structure = analyseStructure(parsed, { evidence });
  const entity = analyseEntityAuthority(parsed, { now, citationSample: citationResult, evidence });

  // The FAQ mismatch penalty belongs to the technical layer but is only
  // detectable by the structural comparison, so it is threaded across. The
  // entity-schema one is threaded the same way and for the same reason: it is
  // detected where the markup is read and applied where the multiplicative
  // layer lives, so there stays exactly one list of reasons a score is scaled.
  const faqMismatch = structure.issues.some((i) => i.code === "SH-07");
  const entitySchemaInvalid = entity.issues.some((i) => i.code === "EA-11");
  const technical = analyseTechnical(parsed, {
    url,
    fetch: collected.fetch,
    aiCrawlerAccess: collected.aiCrawlerAccess,
    robotsError: collected.robotsError,
    webVitals,
    canonicalStatus,
    faqMismatch,
    entitySchemaInvalid,
    sitemaps: collected.sitemaps || [],
    evidence,
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
    // Recorded as its own record rather than by editing the analyser's: the
    // deterministic pre-screen genuinely happened and its reading is still the
    // reason the model was asked at all. Overwriting it would erase the only
    // check on a model that disagrees with the page.
    evidence.signal("passage_independence", {
      method: "model_inference",
      section: "Model re-read of the primary answer",
      observedValue: aiResult.passageIndependence,
      excerpt: aiResult.notes || "",
      structured: { provider: aiResult.provider || null, deterministic_prescreen: signalValues.passage_independence ?? null },
    });
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

  // ── attach the workings to the numbers ───────────────────────────────────
  // The scorer is pure and knows nothing about where a value came from, which
  // is right — but a score without its provenance is exactly what the BRD
  // forbids. attachEvidenceToPillars() is the SAME function rehydrate() calls
  // on the way back out of Postgres, so a fresh audit and a stored one carry
  // identical shapes by construction.
  scored.pillars = attachEvidenceToPillars(scored.pillars, evidence.signalMap());

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
      // `evidence` stays the human sentence it has always been — it is what the
      // report prints and what every stored row and diff already contains.
      // `evidenceRecords` is the structured provenance beside it, inherited
      // from the signal this finding sits on.
      evidence: i.evidence || "", details: i.details || null,
      evidenceRecords: evidence.evidenceForIssue(i.code, i.signalCode),

      // ── OBSERVED FACT AND INFERENCE, AS TWO FIELDS ─────────────────────
      //
      // The BRD is explicit that these are different sentences, and the reason
      // is that they have different warranties. "The page has two H1 elements"
      // is something we MEASURED on this run and will defend; "this dilutes
      // the page's topical signal" is a REASONED consequence that a reasonable
      // expert could argue with.
      //
      // They were already two values in this codebase — the per-audit
      // `evidence` sentence and the catalogue's `why` — but they arrived at
      // the reader blended into one paragraph, which gives the second the
      // authority of the first. Naming them is the whole fix.
      //
      // `observed` is per-AUDIT and `inference` is per-CODE, which is exactly
      // what you would expect: what we saw varies by page, what it means does
      // not.
      observed: i.evidence || null,
      inference: meta.why || null,

      // Diagnosis and referral. See gapTaxonomy.js for why these are two
      // registries rather than one.
      rootCause: meta.rootCause || null,
      module: meta.module || null,
      // Denormalised from the catalogue onto the row so the queue can be
      // filtered by owner without a join against a table that does not exist
      // — `owner` has always been catalogue-only, and "show me everything
      // engineering has to do" was therefore a client-side filter over a list
      // the client had to have already fetched in full.
      owner: meta.owner || null,
      // Issues have had no lifecycle at all. `open` is the honest starting
      // state for every finding; W8 wires the transitions.
      status: "open",
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
      audit_profile_source: auditProfileSource,
    },
    intake,
    ...scored,
    scoringModelVersion: SCORING_MODEL_VERSION,
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

/**
 * Best guess at the page type, used to select the rule pack.
 *
 * ── ORDER IS THE WHOLE ALGORITHM ──────────────────────────────────────────
 * Schema first, because that is the page ASSERTING what it is. Then the URL's
 * own shape, which the author also controls and cannot fake by accident. Then
 * words in the title and H1, which are the weakest evidence here and the most
 * easily coincidental. A pack only ever adjusts expectations, so a wrong guess
 * costs a suppressed or promoted issue rather than a wrong score — but it is
 * still a claim we make in the UI ("Comparison page"), and the hint overrides
 * it precisely because the customer knows and we are guessing.
 */
export function inferPageType(parsed) {
  const types = (parsed.schemaTypes || []).map((t) => String(t).toLowerCase());
  if (types.includes("faqpage")) return "faq";
  if (types.includes("howto")) return "howto";
  if (types.includes("product")) return "product";
  // A LocalBusiness SUBTYPE is still a location page. Matching the suffix
  // rather than enumerating the ~200 subtypes schema.org defines, which is a
  // list that would be stale the week after it was written.
  if (types.some((t) => /(?:localbusiness|store|restaurant|clinic|dentist|physician|hotel)$/.test(t))
      || types.includes("place")) return "location";
  if (types.includes("service") || types.includes("professionalservice")) return "service";
  if (types.includes("article") || types.includes("blogposting")) return "article";

  // The root of a site is a homepage whatever it says in its title, and the
  // path is the one piece of evidence here that cannot be a coincidence.
  // Guarded so a parsed object with no URL — which is how most of the unit
  // tests call this — cannot match on an empty string.
  try {
    if (parsed.url) {
      const { pathname } = new URL(parsed.url);
      if (pathname === "/" || pathname === "") return "homepage";
    }
  } catch { /* unparseable URL is simply not evidence of a homepage */ }

  const h1 = (parsed.headingStats?.h1Text || "").toLowerCase();
  const title = (parsed.meta?.title || "").toLowerCase();
  const both = `${h1} ${title}`;
  // ⚠️ THE ORDER OF THESE THREE CHANGED IN W2, DELIBERATELY.
  //
  // "how to" is the strongest intent marker of the set and now runs first: it
  // used to sit behind the pricing test, so "How to reduce hosting cost" was
  // filed as a pricing page and asked for Offer markup it has no business
  // carrying.
  //
  // Comparison then runs before pricing, for the same reason in reverse.
  // "Acme vs Rival pricing" is a comparison that happens to discuss price, and
  // the two packs differ in exactly the way that matters for it: the
  // comparison pack promotes AC-08 — comparative content written as prose —
  // which is that page's defining failure mode and the one the pricing pack
  // says nothing about.
  if (/\bhow to\b/.test(both)) return "howto";
  if (/\b(vs\.?|versus)\b|\balternatives?\b|\bcompar(?:e|ed|ison)\b/.test(both)) return "comparison";
  if (/\b(pricing|plans?|cost)\b/.test(both)) return "pricing";
  if (/\b(faq|frequently asked)\b/.test(both)) return "faq";
  if (/\b(docs?|documentation|reference|api)\b/.test(both)) return "docs";
  if ((parsed.faqPairs || []).length >= 3) return "faq";
  if ((parsed.wordCount || 0) > 600) return "article";
  return "page";
}

/** The shape returned when a page could not be fetched at all. */
function emptyResultShell({ url, deviceProfile, auditProfile, auditProfileSource, now, collected }) {
  const scored = scoreAudit({ signalValues: {}, penaltyCodes: [] });
  // Decorated with an EMPTY evidence map rather than left undecorated. An
  // unreachable page gathered no observations, but its signals must still carry
  // the same fields a reachable page's do — a consumer that reads
  // `signal.evidence.length` should get 0, not a TypeError, and the shape of a
  // result must not depend on whether the fetch happened to succeed.
  scored.pillars = attachEvidenceToPillars(scored.pillars, {});
  const issueCode = collected.fetch.status && collected.fetch.status !== 200 ? "TA-04" : "TA-04";
  const rec = buildRecommendation(issueCode, {
    evidence: collected.fetch.status
      ? `The page returned HTTP ${collected.fetch.status}.`
      : `The page could not be fetched: ${collected.fetch.error}.`,
  });
  const meta = ISSUES[issueCode];
  // Every field a reachable page's issue carries, for the same reason the
  // pillars above are decorated with an empty evidence map rather than left
  // undecorated: the SHAPE of a result must not depend on whether the fetch
  // happened to succeed. A consumer reading `issue.rootCause` should get a
  // cause, not undefined, on the one audit where the cause is least ambiguous.
  const issue = {
    code: issueCode, pillar: meta.pillar, severity: meta.severity,
    frameworks: [...meta.frameworks], title: meta.title,
    evidence: rec.evidence, details: { status: collected.fetch.status, error: collected.fetch.error },
    observed: rec.evidence || null,
    inference: meta.why || null,
    rootCause: meta.rootCause || null,
    module: meta.module || null,
    owner: meta.owner || null,
    status: "open",
  };
  return {
    target: {
      url, canonical_url: null, final_url: collected.fetch.finalUrl || url,
      page_type: "unknown", language: null,
      device_profile: deviceProfile, audit_profile: auditProfile,
      audit_profile_source: auditProfileSource || "default",
    },
    ...scored,
    scoringModelVersion: SCORING_MODEL_VERSION,
    issues: [issue],
    severityTally: severityTally([issue]),
    recommendations: [rec],
    estimatedTotalLift: 0,
    facts: { technical: { http_status: collected.fetch.status, error: collected.fetch.error }, content: {}, entity: {} },
    evidence: {},
    meta: { startedAt: now, durationMs: Date.now() - now, engine: {} },
  };
}
