// netlify/functions/discoverability.js
//
// The Discoverability module's API. Routing is internal: the `splat` query
// parameter carries the path after /api/discoverability (see the netlify.toml
// redirect), the same pattern api-v1.js uses.
//
//   POST   /audits                          run an audit
//   GET    /audits                          list
//   GET    /audits/{id}                     status + summary
//   GET    /audits/{id}/results             the full payload
//   GET    /audits/{id}/report              markdown / csv / json
//   POST   /audits/{id}/rerun               re-run against this as baseline
//   DELETE /audits/{id}
//   GET    /audits/{id}/compare/{baseline}
//   GET    /audits/{id}/{headings|schema|answers|entities|technical}
//   GET    /audits/{id}/recommendations
//   POST   /recommendations/{id}/{accept|dismiss|done|reopen}
//   GET    /recommendations/{id}/asset
//   GET    /targets                         list
//   GET    /targets/{id}/history
//   GET    /targets/{id}/trends
//   POST   /benchmarks                      competitive / multi-URL set
//   GET    /benchmarks/{id}
//   GET/POST/DELETE /prompts/samples[/{id}]
//   GET/POST/DELETE /webhooks[/{id}]
//   GET    /schedules   POST /schedules   PATCH/DELETE /schedules/{id}
//
// ── GATE ORDER IS LOAD-BEARING ─────────────────────────────────────────────
//
//   auth → idempotency → quota CHECK → SSRF → compliance → rate limit
//        → audit row (the CHARGE) → run → persist
//
// The distinction that matters is between CHECKING the quota and SPENDING it.
// The check is free and side-effect-free, so it runs early: somebody already
// over their monthly limit is told immediately rather than after we have
// fetched their robots.txt. The CHARGE is the audit row itself — audits are
// counted from that table, there is no separate counter — and it is inserted
// only after every gate that can decline has passed.
//
// So a request refused for SSRF, robots.txt or the operator's host allowlist
// creates no row and costs the user nothing. That is the same rule extract.js
// has, and it exists there because consumeGuestCredit once ran BEFORE the
// compliance check and a guest pasting three disallowed LinkedIn URLs was
// charged three times for work that was never done.
//
// Idempotency sits above the quota check for the same reason: a retried request
// must return the original audit, not spend a second credit on the same work.
//
// ── AUDITS ARE SIGNED-IN ONLY ──────────────────────────────────────────────
// Not a paywall decision — a correctness one. An audit's value is its HISTORY:
// the baseline, the trend, the "did my fix work" comparison. All of that hangs
// off a stable identity. An anonymous cookie can be cleared and re-made without
// limit, so it can hold neither a quota nor a history worth keeping. Same
// reasoning as scrape consent and referrals.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { isPublicHttpUrlAsync } from "./lib/publicUrl.js";
import { checkCompliance } from "./lib/complianceEngine.js";
import { hasScrapeConsent } from "./lib/scrapeConsent.js";
import { takeTokenBlocking, configFromEnv } from "./lib/rateLimiter.js";
import { consumeGuestCredit } from "./lib/guestUsage.js";
import { createDeadline, budgetFromEnv } from "./lib/audit/deadline.js";
import {
  resolveRequestEntitlement, checkCapability, DENY_STATUS, denyBody,
} from "./lib/requireEntitlement.js";
import {
  buildWorkspaceCtx, requireWorkspaceDiscoverabilityAction,
} from "./lib/workspaceContext.js";
import {
  APPROVED_TYPES, APPROVED_TYPE_IDS, EXCLUDED_TYPES,
  SCHEMA_COMPONENTS, SCHEMA_COMPONENT_IDS,
  schemaScore, schemaGaps,
} from "../../src/lib/discoverability/schemaIntelligence.js";
import {
  INDEPENDENCE, TRUST_SIGNALS, TRUST_SIGNAL_IDS,
  TC_COMPONENTS, TC_COMPONENT_IDS,
  makeObservation, trustScore, tcScore, trustGaps,
} from "../../src/lib/discoverability/trustProof.js";
import { runAudit } from "./lib/audit/auditPipeline.js";
import { summariseAudit } from "./lib/audit/aiEvaluator.js";
import * as store from "./lib/audit/auditStore.js";
import { canonicalAuditUrl } from "../../src/lib/discoverability/auditUrl.js";
import { diffAudits, buildTrend, incomparableDiff, subjectMismatchCause } from "../../src/lib/discoverability/auditDiff.js";
import {
  sameSubject, subjectMismatchReason, scoreIdFor, canCreateEntitySubject,
} from "../../src/lib/discoverability/subjectModel.js";
import {
  scoreSubject, missingFacts, isThin, intentCoverage,
  SUBJECT_SCORES, SUBJECT_SCORE_IDS, SUBJECT_MODEL_VERSION, THIN_COVERAGE,
} from "../../src/lib/discoverability/subjectScoring.js";
import {
  SOURCE_TIERS, TIER_IDS, ACQUISITION, DIRECTORY_SOURCES, SOURCE_BY_ID,
  sourcesForRegion, coverageClaim, unlockAction,
} from "../../src/lib/discoverability/directorySources.js";
import {
  NAP_FIELDS, NAP_FIELD_IDS, MATCH_STATES, matchDirectory, napScore,
  LOCAL_FINDING_CODES, localFindings, correctionPack,
  serviceRadiusQueries, radiusCoverage,
} from "../../src/lib/discoverability/napModel.js";
import {
  buildMarkdownReport, issuesToCsv, recommendationsToCsv, toJsonPayload,
  signalsToCsv, scoresToCsv, bundleToCsv, brandCsv,
} from "../../src/lib/discoverability/auditReport.js";
import { buildConstruct } from "../../src/lib/discoverability/constructTemplates.js";
import { AUDIT_PROFILES, PAGE_TYPE_PACKS, packFor } from "../../src/lib/discoverability/auditProfiles.js";
import {
  AUDIT_TYPES, SELECTABLE_AUDIT_TYPE_IDS, PRIMARY_GOALS, PRIMARY_GOAL_IDS,
  normaliseGeography, normaliseCompetitorUrls, intakeVocabulary, MAX_COMPETITOR_URLS,
} from "../../src/lib/discoverability/intakeModel.js";
import { scorePillar, scoreFramework } from "../../src/lib/discoverability/scoringModel.js";
import { attachEvidenceToPillars } from "../../src/lib/discoverability/evidenceModel.js";
import { PILLAR_IDS, PILLARS } from "../../src/lib/discoverability/signalRegistry.js";
import { dispatchAuditEvent } from "./lib/audit/webhookDispatch.js";
import {
  TRUTH_FIELDS, TRUTH_FIELD_IDS, TRUTH_FIELD_GROUPS, FACT_SOURCES,
  VERSION_STATES, REQUIRED_FOR_CANONICAL, TRUTH_CONFLICT_CODES,
  makeFact, buildFieldMap, truthCompleteness, canPromote, diffVersions,
  summariseRecord, normalizeFieldValue, canTransition,
  factsFromSchemaOrg, detectConflicts, SCHEMA_READABLE,
} from "../../src/lib/discoverability/businessTruth.js";
import {
  ENTITY_TYPES, ENTITY_TYPE_IDS, PREDICATES, PREDICATE_IDS,
  RELATION_SOURCES, REVIEW_STATES, GRAPH_CONFLICT_CODES, IDENTIFYING_TYPES,
  validateRelation, detectGraphConflicts, graphCoverage, buildIndex,
} from "../../src/lib/discoverability/entityGraph.js";
import {
  SXO_LAYERS,
  SXO_LAYER_WEIGHTS,
  MASTER_FRAMEWORK_WEIGHTS,
  SXO_MODEL_VERSION,
  DEFAULT_WEIGHT_SET_ID,
} from "../../src/lib/discoverability/sxoModel.js";
import { INTENT_CLASS_DETAILS } from "../../src/lib/discoverability/intentMatch.js";
import { FIRST_SCREEN_FLAGS } from "../../src/lib/discoverability/firstScreen.js";
import { PRIMARY_OUTCOME_DETAILS } from "../../src/lib/discoverability/conversionDesign.js";
import { evaluateSxo, computeMasterScore } from "../../src/lib/discoverability/sxoScoring.js";
import {
  NORMALIZED_EVENTS,
  NORMALIZED_EVENT_SET,
  SEGMENTATION_AXES,
  mapSourceEvent,
  isValidNormalizedEvent,
} from "../../src/lib/discoverability/eventTaxonomy.js";
import { FUNNEL_STAGES, calculateJourneyFunnel } from "../../src/lib/discoverability/journeyModel.js";
import { FORM_METRIC_KEYS, evaluateFormDiagnostics } from "../../src/lib/discoverability/formDiagnostics.js";
import { evaluateMeasurementMaturity } from "../../src/lib/discoverability/measurementMaturity.js";
import { classifyPageTemplate } from "../../src/lib/discoverability/templateClassification.js";
import { calculatePortfolioRollup, PORTFOLIO_ROLLUP_AXES } from "../../src/lib/discoverability/portfolioModel.js";
import { PERSONA_PACKS, filterPersonaQueue } from "../../src/lib/discoverability/personaPacks.js";
import { createExperimentRecord, evaluateExperimentImpact } from "../../src/lib/discoverability/optimizationExperiments.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS, ...extra },
  body: JSON.stringify(body),
});

const text = (statusCode, body, contentType) => ({
  statusCode,
  headers: { "Content-Type": contentType, ...CORS },
  body,
});

const bad = (msg, extra = {}) => json(400, { error: msg, ...extra });
const notFound = (msg = "Not found.") => json(404, { error: msg });
const unauthorized = () => json(401, {
  error: "Sign in to run discoverability audits.",
  code: "AUTH_REQUIRED",
});

export function parsePath(splat) {
  if (!splat) return [];
  return String(splat).split("/").map((s) => decodeURIComponent(s)).filter(Boolean);
}

/**
 * Resolve the sub-path from TWO sources, in priority order:
 *
 *   1. event.queryStringParameters.splat — either the netlify.toml redirect's
 *      `:splat` substituted into a query string, or (for /api/v1/audits/*)
 *      api-v1.js's in-process delegation, which sets this explicitly and
 *      never goes through Netlify's redirect engine at all.
 *   2. event.path — the real HTTP request path. netlify.toml forwards the
 *      sub-path as a PATH SEGMENT (`/.netlify/functions/discoverability/:splat`),
 *      not a query param, because the query-string form of `:splat` was
 *      already found to be unreliable on an explicit-prefix wildcard rule —
 *      the exact failure that once 404'd every integrations provider with
 *      "Unknown endpoint" equivalents (see netlify.toml's comment on those
 *      redirects, and commit 87f5597).
 *
 *      ⚠️ event.path's PREFIX is not something to hardcode a single exact
 *      match against. An assumed `/.netlify/functions/discoverability`
 *      prefix (matching the integrations fix's own pattern) was deployed
 *      and STILL 404'd "Unknown endpoint" on staging — Netlify's actual
 *      value for a 200 rewrite is not reliably one fixed shape across
 *      redirect configurations, and this codebase has no live-staging
 *      trace to pin it down further than "some prefix, then a
 *      'discoverability' segment, then the real sub-path". So: find the
 *      LAST '/discoverability/' segment marker in the path, wherever it
 *      falls, and take everything after it. This resolves correctly
 *      whether event.path is the destination form
 *      (/.netlify/functions/discoverability/audits), the original request
 *      form (/api/discoverability/audits), or anything else that still
 *      contains that literal segment immediately before the real sub-path.
 */
function resolveSplat(event) {
  const fromQuery = event.queryStringParameters?.splat || "";
  if (fromQuery) return fromQuery;
  const p = event.path || "";
  const marker = "/discoverability/";
  const idx = p.lastIndexOf(marker);
  if (idx !== -1) return p.slice(idx + marker.length);
  const sxoMarker = "/sxo/";
  const sIdx = p.lastIndexOf(sxoMarker);
  if (sIdx !== -1) return "sxo/" + p.slice(sIdx + sxoMarker.length);
  return "";
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
}

/** How many URLs one benchmark set may hold. Each is a full audit. */
export const MAX_BENCHMARK_URLS = 10;

// ── The audit run, shared by POST /audits, rerun, benchmarks and schedules ──

/**
 * Everything between "we have a URL" and "we have a stored audit".
 *
 * Returns `{ ok, statusCode, body }` so every caller applies the same gates in
 * the same order. A second entry point that skipped one of them is exactly how
 * the guest-credit leak documented in CLAUDE.md happened: checking and blocking
 * were two steps each caller wired itself, and four paths drifted.
 */
async function executeAudit({ event, userId, rawUrl, options = {}, resolved, source = "ui" }) {
  // ── The budget covers the WHOLE REQUEST, not just the pipeline ───────────
  //
  // It is created here rather than inside runAudit because a large share of the
  // wall clock is spent before the pipeline is even entered — the robots.txt
  // fetch in checkCompliance, the consent lookup, the rate limiter's wait, two
  // Supabase writes — and afterwards, persisting the result and dispatching the
  // webhook. A budget that starts when the pipeline starts leaves all of that
  // unaccounted for, so the pipeline can finish inside its own budget and the
  // REQUEST still overrun and 504.
  //
  // runAudit then receives what is LEFT, so the gates above genuinely come out
  // of the same allowance instead of being additional to it.
  const deadline = createDeadline(budgetFromEnv(process.env));

  // ── SSRF ─────────────────────────────────────────────────────────────────
  if (!(await isPublicHttpUrlAsync(rawUrl))) {
    return { ok: false, statusCode: 400, body: { error: "That URL is not a public web address.", code: "INVALID_URL" } };
  }

  // ── compliance — an audit FETCHES the page, so robots applies ────────────
  //
  // It is tempting to exempt audits: the whole point of TA-01 is to report that
  // crawlers are blocked, and refusing to audit a blocking site means never
  // reporting it. But we fetch and read the page content either way, /blog and
  // /vs/* advertise that we honour robots.txt, and a product that quietly
  // exempts its newest feature from its own published policy has no policy.
  //
  // The recorded per-host attestation is the right escape hatch, and audits are
  // overwhelmingly run on one's own site — exactly what it was built for.
  const compliance = await checkCompliance(rawUrl, {
    permittedHosts: process.env.PERMITTED_HOSTS || "",
  });
  if (!compliance.allowed) {
    const overridable = compliance.code === "robots_disallowed";
    const consented = overridable && userId
      ? await hasScrapeConsent(userId, compliance.host)
      : false;
    if (!consented) {
      return {
        ok: false, statusCode: 403,
        body: {
          error: compliance.reason,
          code: compliance.code,
          _complianceBlocked: true,
          host: compliance.host,
          // Branch on the code, never the prose. Matching prose is what made a
          // robots refusal render as "Something went wrong" with a stack trace.
          overridable,
        },
      };
    }
  }

  // ── rate limit, per host, after every gate that can decline for free ─────
  // Same call shape as extract.js, with one difference that matters here: the
  // wait is BOUNDED. The bucket is per-host and survives in the warm container,
  // so re-auditing a URL asks the same host's bucket for another token moments
  // after the previous audit spent one — and an unbounded wait there blocks
  // until the platform kills the function, which is reported to the user as an
  // unexplained 504 on exactly the "run it again" path.
  //
  // At most a quarter of the budget is spent being polite. Past that we proceed
  // rather than decline: the audit makes few requests, the host is nearly
  // always the user's own, and throttling that takes the product down is not
  // throttling. A failure in the limiter itself is warned about, never fatal.
  try {
    const token = await takeTokenBlocking(rawUrl, {
      ...configFromEnv(),
      maxWaitMs: Math.max(0, Math.floor(deadline.remaining() * 0.25)),
    });
    if (token?.timedOut) {
      console.warn(`[DatIQ] audit rate limiter gave up after ${token.waitedMs}ms for ${token.host}; proceeding`);
    }
  } catch (err) {
    console.warn("[DatIQ] audit rate limiter errored (continuing):", err?.message);
  }

  // ── target + audit row ───────────────────────────────────────────────────
  const canonical = canonicalAuditUrl(rawUrl) || rawUrl;
  let host = "";
  try { host = new URL(rawUrl).hostname; } catch { host = compliance.host || ""; }

  // ── One options object, both run paths ──────────────────────────────────
  // The guest path and the stored path used to build this list separately, and
  // a field added to one and forgotten in the other is invisible: the audit
  // still runs, and only the context is missing. Built once here so a guest
  // audit and a signed-in audit are commissioned identically.
  //
  // `auditProfile` is passed only when it was EXPLICITLY chosen. Sending the
  // "balanced" fallback would look identical to a deliberate choice of the
  // neutral lens and would stop the goal and the page from ever settling it.
  const pipelineOptions = {
    deadline,
    deviceProfile: options.deviceProfile,
    auditProfile: options.auditProfileExplicit ? options.auditProfile : null,
    auditType: options.auditType,
    primaryGoal: options.primaryGoal,
    targetGeography: options.targetGeography,
    competitorUrls: options.competitorUrls,
    pageTypeHint: options.pageTypeHint,
    prompts: options.prompts,
    citationEngine: options.citationEngine,
    skipWebVitals: options.skipWebVitals,
    skipCitations: options.skipCitations,
  };

  if (!userId) {
    let result;
    try {
      result = await runAudit(rawUrl, pipelineOptions);
    } catch (err) {
      return { ok: false, statusCode: 502, body: { error: "The audit could not be completed.", code: "AUDIT_FAILED" } };
    }
    const auditId = `guest-${Date.now()}`;
    return {
      ok: true, statusCode: 200,
      body: { ...result, auditId, targetId: null, persisted: false, guest: true },
    };
  }

  const targetId = await store.ensureTarget(userId, canonical, host, options.label || null);
  if (!targetId) {
    return { ok: false, statusCode: 503, body: { error: "Audit storage is unavailable. Try again shortly.", code: "STORAGE_UNAVAILABLE" } };
  }

  // D7 — the subject registry. A page audit gets a `page` subject over the same
  // target, so every audit from here on is addressable the same way a brand
  // audit will be. ⚠️ `null` is NOT a failure path: `audits.subject_id` is
  // nullable precisely because every pre-0057 row carries none, so an audit
  // whose subject could not be resolved lands in a state the readers already
  // handle. `target_id` stays authoritative for the page case regardless.
  const subjectId = await store.ensureSubject(userId, {
    kind: "page", targetId, label: options.label || canonical, canonicalDomain: host,
    workspaceId: options.workspaceId || null,
  });

  const created = await store.createAudit(userId, {
    targetId, subjectId, targetUrl: rawUrl,
    deviceProfile: options.deviceProfile, auditProfile: options.auditProfile,
    // What is known before the fetch. `persistResult` corrects the profile and
    // its source to whatever the run actually applied, exactly as it already
    // does for `page_type` — so an audit that dies mid-run still records what
    // it was commissioned to do, and a completed one records what happened.
    auditProfileSource: options.auditProfileExplicit ? "explicit" : "default",
    auditType: options.auditType, primaryGoal: options.primaryGoal,
    targetGeography: options.targetGeography, competitorUrls: options.competitorUrls,
    pageTypeHint: options.pageTypeHint, baselineAuditId: options.baselineAuditId,
    promptSetId: options.promptSetId, idempotencyKey: options.idempotencyKey,
    source, tags: options.tags || [],
    // D6 — the column has existed since 0030 and nothing ever wrote it.
    // Back-filling later costs far more than carrying it now. NULL stays valid
    // and common: most audits have no workspace.
    workspaceId: options.workspaceId || null,
  });
  if (!created.ok) {
    return { ok: false, statusCode: 503, body: { error: "Could not open the audit.", code: "STORAGE_UNAVAILABLE", detail: created.error } };
  }
  const auditId = created.audit.id;

  // ── run ──────────────────────────────────────────────────────────────────
  let result;
  try {
    // The same options the guest path runs, carrying the deadline that is LEFT
    // after the gates above rather than a fresh allowance.
    result = await runAudit(rawUrl, pipelineOptions);
  } catch (err) {
    await store.markAuditFailed(auditId, err?.message);
    return { ok: false, statusCode: 502, body: { error: "The audit could not be completed.", code: "AUDIT_FAILED", auditId } };
  }

  const persisted = await store.persistResult(userId, auditId, result, {
    workspaceId: options.workspaceId || null,
  });
  if (!persisted.ok) {
    // The audit ran; only the write failed. Return the result anyway rather
    // than throwing away work the user has already been charged for — but say
    // clearly that it was not saved, so nobody looks for it in their history.
    return {
      ok: true, statusCode: 200,
      body: { ...result, auditId, targetId, persisted: false, persistError: persisted.error },
    };
  }

  await store.persistPromptRuns(userId, auditId, result.citationSample || null, options.promptSetId);
  await store.recordEvent(userId, { auditId, eventType: "created", payload: { url: rawUrl, source } });

  // W9 — check the page against the approved record, if there is one.
  const truth = await checkAgainstTruthRecord(userId, auditId, rawUrl, result);
  if (truth) result.businessTruth = truth;

  // Fire and forget. dispatchAuditEvent swallows its own failures, so a user's
  // endpoint being down cannot fail an audit that already ran and was already
  // charged for; the failure lands on the webhook row where they can see it.
  await dispatchAuditEvent(userId, "audit.completed", {
    audit: { id: auditId, target_url: rawUrl }, result,
  });

  return { ok: true, statusCode: 201, body: { ...result, auditId, targetId, persisted: true } };
}

/**
 * Everything the composer needs to render the intake form, in one call.
 *
 * `profiles` keeps its original key and its original shape. It is the response
 * this endpoint has always returned and there are clients reading it; the new
 * vocabularies sit BESIDE it rather than nesting it under a new key, so an
 * older client keeps working and a newer one gets the goals, the types and the
 * page types without a second request.
 */
function intakeReference() {
  return {
    profiles: AUDIT_PROFILES,
    page_types: PAGE_TYPE_PACKS,
    ...intakeVocabulary(),
  };
}

/**
 * Validate and normalise the create-audit body.
 *
 * ── AN UNKNOWN VALUE IS AN ERROR, NEVER A SUBSTITUTION ────────────────────
 * The rule `audit_profile` has always followed now covers the whole intake. A
 * caller who sends `primary_goal: "local"` (the profile id) instead of
 * `"local_discovery"` (the goal id) must be told, not quietly given an audit
 * with no goal recorded — they would go looking for local findings that were
 * never commissioned, and the row would say the question was never asked.
 *
 * `auditProfile` still defaults to "balanced" here rather than to null, and
 * `auditProfileExplicit` carries whether anybody actually chose it. The
 * pipeline needs both: "balanced" is the fallback the unreachable-page path
 * reports under, and the flag is what stops inference overriding a deliberate
 * choice of the neutral lens.
 */
export function parseAuditOptions(body = {}) {
  const errors = [];
  const url = String(body.target_url || body.url || "").trim();
  if (!url) errors.push("target_url is required.");

  const deviceProfile = body.device_profile === "desktop" ? "desktop" : "mobile";
  const auditProfile = AUDIT_PROFILES[body.audit_profile] ? body.audit_profile : "balanced";
  if (body.audit_profile && !AUDIT_PROFILES[body.audit_profile]) {
    errors.push(`audit_profile must be one of: ${Object.keys(AUDIT_PROFILES).join(", ")}.`);
  }

  const primaryGoal = PRIMARY_GOALS[body.primary_goal] ? body.primary_goal : null;
  if (body.primary_goal && !PRIMARY_GOALS[body.primary_goal]) {
    errors.push(`primary_goal must be one of: ${PRIMARY_GOAL_IDS.join(", ")}.`);
  }

  if (body.page_type_hint && !PAGE_TYPE_PACKS[body.page_type_hint]) {
    errors.push(`page_type_hint must be one of: ${Object.keys(PAGE_TYPE_PACKS).join(", ")}.`);
  }

  // ── The audit type, and the two the engine cannot honour ────────────────
  // Refused rather than accepted-and-downgraded. Storing `domain` on a row
  // that fetched one page would be a claim about work nobody did, and it is a
  // claim the customer cannot check — the row looks exactly like a domain
  // snapshot in every list, export and trend it appears in.
  let auditType = "url";
  if (body.audit_type) {
    const type = AUDIT_TYPES[body.audit_type];
    if (!type) {
      errors.push(`audit_type must be one of: ${SELECTABLE_AUDIT_TYPE_IDS.join(", ")}.`);
    } else if (!type.available) {
      errors.push(type.unavailableReason || `${type.label} audits are not available yet.`);
    } else if (!type.callerSelectable) {
      // `benchmark` and `rerun` are set by the routes that create their
      // context. An audit that called itself a re-audit with nothing to be a
      // re-audit OF would break the one guarantee the type carries.
      errors.push(`audit_type "${body.audit_type}" is set by the ${body.audit_type} endpoint, not on a plain audit.`);
    } else {
      auditType = body.audit_type;
    }
  }

  const geography = normaliseGeography(body.target_geography);
  const competitors = normaliseCompetitorUrls(body.competitor_urls);
  if (competitors.rejected.length) {
    // Named and returned, not dropped. A caller who believes a competitor is
    // being tracked when it is not will read the next report as though it
    // covered them.
    errors.push(
      `${competitors.rejected.length} competitor URL${competitors.rejected.length === 1 ? " was" : "s were"} ` +
      `not usable or beyond the limit of ${MAX_COMPETITOR_URLS}: ${competitors.rejected.slice(0, 3).join(", ")}.`,
    );
  }

  return {
    errors, url,
    options: {
      deviceProfile, auditProfile,
      auditProfileExplicit: Boolean(AUDIT_PROFILES[body.audit_profile]),
      auditType, primaryGoal,
      targetGeography: geography,
      competitorUrls: competitors.urls,
      pageTypeHint: body.page_type_hint || null,
      baselineAuditId: body.baseline_audit_id || null,
      promptSetId: body.prompt_sample_set_id || null,
      idempotencyKey: body.idempotency_key || null,
      prompts: Array.isArray(body.prompts) ? body.prompts.slice(0, 10) : null,
      citationEngine: body.citation_engine || null,
      skipWebVitals: body.skip_web_vitals === true,
      skipCitations: body.skip_citations === true,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 10).map(String) : [],
      label: body.label || null,
      // D6. Taken as given here and RE-CHECKED by buildWorkspaceCtx before it
      // gates anything — a workspace id in a request body is a claim, not a
      // membership, and the entitlement path already refuses one the caller is
      // not in. Carried onto the row so the queue can filter without a join.
      workspaceId: body.workspace_id || null,
    },
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const path = parsePath(resolveSplat(event));
  const method = event.httpMethod;

  // Two callers, one code path. The SPA presents a Supabase JWT; the public
  // /api/v1 router has already authenticated an API key and passes the resolved
  // user through `_apiKeyUserId` on the in-process event. That field cannot
  // arrive over the network: the /api/discoverability/* redirect builds the
  // event from the HTTP request, which has no way to set it, and the /api/v1/*
  // redirect targets api-v1 rather than this function.
  const delegatedUserId = event._apiKeyUserId || null;
  let userId = delegatedUserId;
  if (!userId) {
    const auth = await authenticateBearer(event, { label: "discoverability" });
    if (auth.ok && auth.user) {
      userId = auth.user.id;
    }
  }

  let body = {};
  try { body = readBody(event); } catch { return bad("Request body is not valid JSON."); }

  const [root, id, sub, subId] = path;

  // Profiles is static reference data for the UI
  if (root === "profiles" && method === "GET") return json(200, intakeReference());

  // Guest audit: allow unauthenticated visitors to run 1 free discoverability audit
  const isGuestAudit = !userId && root === "audits" && method === "POST" && !id && Boolean(body?.guest);

  if (!userId && !isGuestAudit) {
    return unauthorized();
  }

  try {
    // ── /audits ────────────────────────────────────────────────────────────
    if (root === "audits") {
      if (!id && method === "POST") return await createAuditRoute(event, userId, body);
      if (!id && method === "GET") {
        const q = event.queryStringParameters || {};
        const rows = await store.listAudits(userId, {
          limit: Number(q.limit) || 25, offset: Number(q.offset) || 0,
          targetId: q.target_id || null, status: q.status || null,
        });
        return json(200, { audits: rows });
      }
      if (!id) return json(405, { error: "Method not allowed." });

      if (method === "DELETE" && !sub) {
        const r = await store.deleteAudit(userId, id);
        if (r.notFound) return notFound("Audit not found.");
        if (!r.ok) return json(503, { error: "Could not delete the audit." });
        await store.recordEvent(userId, { auditId: id, eventType: "deleted", payload: {} });
        return json(200, { deleted: true, audit_id: id });
      }

      if (method === "POST" && sub === "rerun") return await rerunRoute(event, userId, id, body);

      if (method === "GET") {
        const full = await store.getAuditFull(userId, id);
        // 404, never 403, for somebody else's audit: a 403 confirms the id is
        // real, which is how an id space gets enumerated.
        if (!full) return notFound("Audit not found.");

        if (!sub) return json(200, { audit: full.audit, result: full.result });
        if (sub === "results") return json(200, shapeFull(full));
        if (sub === "recommendations") return json(200, { recommendations: full.recommendations });
        if (sub === "headings") return json(200, { headings: full.result?.evidence_json?.heading_outline || [] });
        if (sub === "schema") return json(200, { schema_types: full.result?.evidence_json?.schema_types || [], structured_data: full.result?.facts_json?.technical?.structured_data || null });
        if (sub === "answers") return json(200, { direct_answer_blocks: full.result?.evidence_json?.direct_answer_blocks || [], faq_pairs: full.result?.evidence_json?.faq_pairs || [] });
        if (sub === "entities") return json(200, { entity: full.result?.facts_json?.entity || {}, prompt_runs: full.promptRuns });
        if (sub === "technical") return json(200, { technical: full.result?.facts_json?.technical || {} });
        if (sub === "report") {
          // Exports leave the product — a report can be forwarded to a client
          // or attached to a ticket — so they belong in the trail beside
          // created / rerun / deleted. Fire-and-forget: recordEvent never
          // throws, and a lost trail entry must not fail the download.
          store.recordEvent(userId, {
            auditId: id, eventType: "exported",
            payload: { format: (event.queryStringParameters?.format || "markdown").toLowerCase() },
          });
          return reportRoute(event, full);
        }
        if (sub === "compare" && subId) return await compareRoute(userId, full, subId);
      }
      if (method === "POST" && id && sub === "summary") {
        const full = await store.getAuditFull(userId, id);
        if (!full) return notFound("Audit not found.");
        return await summaryRoute(userId, id, full);
      }
      return json(405, { error: "Method not allowed." });
    }

    // ── /recommendations ───────────────────────────────────────────────────
    if (root === "recommendations" && id) {
      const workspaceId = body.workspace_id || event.queryStringParameters?.workspace_id || null;
      let scopedRecommendation = null;
      if (workspaceId) {
        // Scope first, permission second: foreign ids remain indistinguishable
        // from missing ids and cannot be enumerated through a role error.
        scopedRecommendation = await store.getRecommendation(userId, id, { workspaceId });
        if (!scopedRecommendation) return notFound("Recommendation not found.");
      }

      if (method === "POST" && sub === "assign") {
        if (workspaceId) {
          const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "manage_workflow");
          if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
        }
        // `assignee: null` puts it down. Anything else is checked against
        // shared workspace membership by the database, not here.
        const r = await (workspaceId
          ? store.setRecommendationAssignee(userId, id, body.assignee ?? null, { workspaceId })
          : store.setRecommendationAssignee(userId, id, body.assignee ?? null));
        if (r.notFound) return notFound("Recommendation not found.");
        if (!r.ok) return bad(r.error);
        await store.recordEvent(userId, {
          auditId: r.recommendation?.audit_id || null,
          eventType: body.assignee ? "recommendation.assigned" : "recommendation.unassigned",
          payload: { code: r.recommendation?.code || null, assignee: body.assignee ?? null },
        });
        return json(200, { recommendation: r.recommendation });
      }
      // W14 — ask for a re-audit. Kept OUT of VERB_TO_STATE deliberately:
      // every other verb is a pure state change costing nothing, while this
      // one is gated, idempotent and leads to a paid audit. Folding it in
      // would make a quota-bearing action look like a label change.
      if (method === "POST" && sub === "revalidate") {
        return await revalidateRoute(event, userId, id, body);
      }

      // W8 — the full lifecycle. The four original verbs keep their exact
      // meanings so no existing client breaks; the rest are new.
      if (method === "POST" && VERB_TO_STATE[sub]) {
        if (workspaceId) {
          const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "manage_workflow");
          if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
        }
        const status = VERB_TO_STATE[sub];
        const r = await store.setRecommendationStatus(userId, id, status, body.reason, {
          validatedByAuditId: body.validated_by_audit_id || null,
          assignee: body.assignee || null,
          dueAt: body.due_at,
          notes: body.notes,
          ...(workspaceId ? { workspaceId } : {}),
        });
        if (r.notFound) return notFound("Recommendation not found.");
        if (!r.ok) return bad(r.error);
        // W8 — the audit trail entry AND the webhook, which are different
        // readers: the first is ours, the second is somebody's integration.
        await dispatchAuditEvent(scopedRecommendation?.user_id || userId, WEBHOOK_EVENT_FOR[status] || null, {
          audit: { id: r.recommendation.audit_id },
          recommendation: r.recommendation,
        }).catch(() => {});
        await store.recordEvent(userId, {
          auditId: r.recommendation.audit_id,
          eventType: `recommendation.${status}`,
          payload: { code: r.recommendation.code, reason: body.reason || null },
        });
        return json(200, { recommendation: r.recommendation });
      }
      if (method === "GET" && sub === "asset") {
        const full = await store.getAuditFull(userId, body.audit_id || event.queryStringParameters?.audit_id);
        const rec = full?.recommendations?.find((r) => r.id === id);
        if (!rec) return notFound("Recommendation not found.");
        return json(200, { asset: rec.implementation_asset_json || null });
      }
      return json(405, { error: "Method not allowed." });
    }

    // ── /targets ───────────────────────────────────────────────────────────
    if (root === "targets") {
      if (!id && method === "GET") return json(200, { targets: await store.listTargets(userId) });
      if (id && method === "GET" && sub === "history") {
        return json(200, { audits: await store.listAudits(userId, { targetId: id, limit: 50 }) });
      }
      if (id && method === "GET" && sub === "trends") {
        const rows = await store.getTargetTrend(userId, id, Number(event.queryStringParameters?.limit) || 30);
        return json(200, buildTrend(rows));
      }
      return json(405, { error: "Method not allowed." });
    }

    // ── /benchmarks ────────────────────────────────────────────────────────
    if (root === "benchmarks") return await benchmarkRoute(event, userId, method, id, body);

    // ── /prompts/samples ───────────────────────────────────────────────────
    if (root === "prompts" && id === "samples") return await promptSetRoute(event, userId, method, sub, body);
    if (root === "monitors") return await promptMonitorRoute(event, userId, method, id, sub, body);
    // W8 — the PRD calls these `prompt-runs`; we shipped `monitors` first.
    // Aliased rather than duplicated, for the same reason D2 strips a segment
    // instead of adding a second route: two paths into one feature is one
    // refactor away from two sets of gates.
    if (root === "prompt-runs") return await promptMonitorRoute(event, userId, method, id, sub, body);

    // W8 — the QUEUE as a file, not one audit's slice of it. Exports have been
    // audit-scoped since the module shipped, which is the wrong unit for
    // somebody working a backlog across twenty pages.
    if (root === "queue" && method === "GET") {
      const rows = await store.listRecommendationQueue(userId, {
        status: sub || null,
        workspaceId: event.queryStringParameters?.workspace_id || null,
      });
      const format = (event.queryStringParameters?.format || "json").toLowerCase();
      if (format === "csv") {
        return text(200, recommendationsToCsv(rows), "text/csv");
      }
      return json(200, { recommendations: rows, count: rows.length });
    }

    // ── /subject-score ─────────────────────────────────────────────────────
    if (root === "subject-score") {
      return await subjectScoreRoute(userId, method, path, body, event);
    }

    // ── /schema-trust ──────────────────────────────────────────────────────
    if (root === "schema-trust") {
      return await schemaTrustRoute(userId, method, path, body, event);
    }

    // ── /local-directory ───────────────────────────────────────────────────
    if (root === "local-directory") {
      return await localDirectoryRoute(userId, method, path, body, event);
    }

    // ── /entity-graph ──────────────────────────────────────────────────────
    if (root === "entity-graph") {
      return await entityGraphRoute(userId, method, path, body, event);
    }

    // ── /business-truth ────────────────────────────────────────────────────
    if (root === "business-truth") {
      return await businessTruthRoute(userId, method, path, body, event);
    }

    // ── /webhooks ──────────────────────────────────────────────────────────
    if (root === "webhooks") return await webhookRoute(event, userId, method, id, body);

    // ── /schedules ─────────────────────────────────────────────────────────
    if (root === "schedules") return await scheduleRoute(event, userId, method, id, body);

    if (root === "connectors") {
      if (id === "dispatch" && method === "POST") {
        const { provider, idempotency_key, truth_record_id, entity_id, workspace_id, payload } = body || {};
        if (!provider || !idempotency_key) {
          return bad("provider and idempotency_key are required.");
        }
        const res = await store.claimConnectorDispatch(userId, {
          provider,
          idempotencyKey: idempotency_key,
          truthRecordId: truth_record_id,
          entityId: entity_id,
          workspaceId: workspace_id,
          payload,
        });
        if (!res.ok) {
          if (res.reason === "not_authorized") return json(403, { error: "Not authorized to dispatch connectors in this workspace." });
          if (res.reason === "source_not_approved") return json(409, { error: "Source record or entity must be approved before connector dispatch." });
          return bad(res.error || res.reason || "Dispatch claim refused.");
        }
        return json(res.replay ? 200 : 201, res);
      }
      return json(405, { error: "Method not allowed." });
    }

    // ── /sxo — Search Experience Optimization (SXO) (P3A / Stage 2) ────────
    if (root === "sxo") {
      if (id === "schema" && method === "GET") {
        return json(200, {
          layers: SXO_LAYERS,
          layer_weights: SXO_LAYER_WEIGHTS,
          master_weights: MASTER_FRAMEWORK_WEIGHTS,
          intent_classes: INTENT_CLASS_DETAILS,
          primary_outcomes: PRIMARY_OUTCOME_DETAILS,
          flags: FIRST_SCREEN_FLAGS,
          model_version: SXO_MODEL_VERSION,
          default_weight_set_id: DEFAULT_WEIGHT_SET_ID,
        });
      }

      if (id === "evaluate" && method === "POST") {
        const workspaceId = body.workspace_id || null;
        if (workspaceId) {
          const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
          if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
        }

        if (!body.audit_id) {
          return bad("`audit_id` is required to evaluate SXO.");
        }

        const full = await store.getAuditFull(userId, body.audit_id);
        if (!full) return notFound("Audit not found.");

        const sxoResult = evaluateSxo(full, {
          intentClass: body.intent_class,
          primaryOutcome: body.primary_outcome,
          weightSetId: body.weight_set_id,
        });

        const masterScore = computeMasterScore({
          seo: full.result?.framework_scores?.seo?.score ?? null,
          aeo: full.result?.framework_scores?.aeo?.score ?? null,
          geo: full.result?.framework_scores?.geo?.score ?? null,
          sxo: sxoResult.score,
        });

        const saved = await store.saveSxoRun(userId, {
          auditId: body.audit_id,
          subjectId: full.audit?.subject_id || null,
          targetId: full.audit?.target_id || null,
          workspaceId: workspaceId || full.audit?.workspace_id || null,
          sxoTotalScore: sxoResult.score,
          coverage: sxoResult.coverage,
          layerScores: sxoResult.layerScores,
          layerResults: sxoResult.layerResults,
          findings: sxoResult.findings,
          weightSetId: sxoResult.weightSetId,
          modelVersion: sxoResult.modelVersion,
        });

        return json(200, {
          ok: true,
          sxo: sxoResult,
          master: masterScore,
          run: saved.run || null,
        });
      }

      if (id === "runs" && !sub) {
        if (method === "GET") {
          const q = event.queryStringParameters || {};
          const runs = await store.listSxoRuns(userId, {
            auditId: q.audit_id || null,
            subjectId: q.subject_id || null,
            workspaceId: q.workspace_id || null,
            limit: Number(q.limit) || 50,
          });
          return json(200, { runs });
        }
      }

      if (id === "runs" && sub) {
        if (method === "GET") {
          const q = event.queryStringParameters || {};
          const run = await store.getSxoRun(userId, sub, { workspaceId: q.workspace_id || null });
          if (!run) return notFound("SXO run not found.");
          return json(200, { run });
        }
      }

      if (id === "composite" && sub) {
        if (method === "GET") {
          const full = await store.getAuditFull(userId, sub);
          if (!full) return notFound("Audit not found.");
          const existingRun = await store.getSxoForAudit(userId, sub);
          const sxoScore = existingRun?.sxo_total_score ?? null;
          const masterScore = computeMasterScore({
            seo: full.result?.framework_scores?.seo?.score ?? null,
            aeo: full.result?.framework_scores?.aeo?.score ?? null,
            geo: full.result?.framework_scores?.geo?.score ?? null,
            sxo: sxoScore,
          });
          return json(200, {
            audit_id: sub,
            master: masterScore,
            sxo_run_id: existingRun?.id || null,
          });
        }
      }

      // ── Stage 3 / P3B & Stage 4 / P3C Endpoints ──

      // 1. POST /sxo/audits (create/evaluate SXO audit)
      if (id === "audits" && !sub && method === "POST") {
        const workspaceId = body.workspace_id || null;
        if (workspaceId) {
          const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
          if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
        }

        if (!body.audit_id) {
          return bad("`audit_id` is required to evaluate SXO.");
        }

        const full = await store.getAuditFull(userId, body.audit_id);
        if (!full) return notFound("Audit not found.");

        const sxoResult = evaluateSxo(full, {
          intentClass: body.intent_class,
          primaryOutcome: body.primary_outcome,
          weightSetId: body.weight_set_id,
        });

        const masterScore = computeMasterScore({
          seo: full.result?.framework_scores?.seo?.score ?? null,
          aeo: full.result?.framework_scores?.aeo?.score ?? null,
          geo: full.result?.framework_scores?.geo?.score ?? null,
          sxo: sxoResult.score,
        });

        const saved = await store.saveSxoRun(userId, {
          auditId: body.audit_id,
          subjectId: full.audit?.subject_id || null,
          targetId: full.audit?.target_id || null,
          workspaceId: workspaceId || full.audit?.workspace_id || null,
          sxoTotalScore: sxoResult.score,
          coverage: sxoResult.coverage,
          layerScores: sxoResult.layerScores,
          layerResults: sxoResult.layerResults,
          findings: sxoResult.findings,
          weightSetId: sxoResult.weightSetId,
          modelVersion: sxoResult.modelVersion,
        });

        return json(200, {
          ok: true,
          sxo: sxoResult,
          master: masterScore,
          run: saved.run || null,
        });
      }

      // 2. GET /sxo/audits/:id (summary / status)
      if (id === "audits" && sub && !subId && method === "GET") {
        const full = await store.getAuditFull(userId, sub);
        if (!full) return notFound("Audit not found.");
        const run = await store.getSxoForAudit(userId, sub);
        return json(200, { ok: true, audit: full.audit, sxo_run: run });
      }

      // 3. GET /sxo/audits/:id/results (scores + evidence)
      if (id === "audits" && sub && subId === "results" && method === "GET") {
        const run = await store.getSxoForAudit(userId, sub);
        return json(200, {
          ok: true,
          audit_id: sub,
          sxo_results: run?.layer_results || null,
          layer_scores: run?.layer_scores || null,
          coverage: run?.coverage ?? null,
        });
      }

      // 4. GET /sxo/audits/:id/intent-match (intent findings)
      if (id === "audits" && sub && subId === "intent-match" && method === "GET") {
        const run = await store.getSxoForAudit(userId, sub);
        return json(200, {
          ok: true,
          audit_id: sub,
          intent_match: run?.layer_results?.ic || null,
        });
      }

      // 5. GET /sxo/audits/:id/first-screen (first-screen findings)
      if (id === "audits" && sub && subId === "first-screen" && method === "GET") {
        const run = await store.getSxoForAudit(userId, sub);
        return json(200, {
          ok: true,
          audit_id: sub,
          first_screen: run?.layer_results?.ia || null,
        });
      }

      // 6. GET /sxo/audits/:id/journey
      if (id === "audits" && sub && subId === "journey") {
        if (method === "GET") {
          const q = event.queryStringParameters || {};
          let funnel = await store.getJourneyFunnel(userId, sub, { workspaceId: q.workspace_id || null });
          if (!funnel) {
            const aggregates = await store.listAnalyticsAggregates(userId, { auditId: sub, workspaceId: q.workspace_id || null });
            const aggregatedCounts = {};
            for (const agg of aggregates) {
              for (const [evt, count] of Object.entries(agg.event_counts || {})) {
                aggregatedCounts[evt] = (aggregatedCounts[evt] || 0) + Number(count || 0);
              }
            }
            const stageInputs = {
              landing_session: aggregatedCounts.page_view ?? null,
              engaged_session: (aggregatedCounts.scroll_50 || aggregatedCounts.scroll_75 || aggregatedCounts.scroll_90) ?? null,
              key_content_seen: (aggregatedCounts.pricing_view || aggregatedCounts.form_view) ?? null,
              primary_cta_view: aggregatedCounts.primary_cta_view ?? null,
              primary_cta_click: aggregatedCounts.primary_cta_click ?? null,
              action_start: (aggregatedCounts.form_start || aggregatedCounts.booking_start || aggregatedCounts.checkout_start) ?? null,
              conversion_complete: (aggregatedCounts.form_submit || aggregatedCounts.booking_complete || aggregatedCounts.purchase_complete) ?? null,
              qualified_outcome: aggregatedCounts.qualified_conversion ?? null,
            };
            const calculated = calculateJourneyFunnel(stageInputs, { name: `audit_${sub}_funnel` });
            const mi = evaluateMeasurementMaturity({
              connected: aggregates.length > 0,
              trackedEventsCount: Object.keys(aggregatedCounts).length,
              measuredFunnelStagesCount: calculated.measured_stages_count,
            });
            funnel = {
              audit_id: sub,
              funnel_name: calculated.funnel_name,
              stage_results: calculated.stages,
              overall_conversion_rate: calculated.overall_conversion_rate,
              mi_score: mi.score,
              mi_caveats: calculated.caveats.concat(mi.caveats),
            };
          }
          return json(200, { ok: true, audit_id: sub, funnel });
        }
      }

      // 7. GET /sxo/audits/:id/form-diagnostics
      if (id === "audits" && sub && subId === "form-diagnostics") {
        if (method === "GET") {
          const q = event.queryStringParameters || {};
          let diagnostics = await store.getFormDiagnostics(userId, sub, {
            formId: q.form_id || null,
            workspaceId: q.workspace_id || null,
          });
          if (!diagnostics) {
            diagnostics = evaluateFormDiagnostics({
              views: Number(q.views) || 0,
              starts: Number(q.starts) || 0,
              submits: Number(q.submits) || 0,
              fieldErrors: Number(q.field_errors) || 0,
              completionTimeSec: q.completion_time_sec ? Number(q.completion_time_sec) : null,
              deviceSplit: {
                desktop: Number(q.desktop) || 0,
                mobile: Number(q.mobile) || 0,
                tablet: Number(q.tablet) || 0,
              },
              form_id: q.form_id || "default_form",
              page_url: q.page_url || "/",
            });
          }
          return json(200, { ok: true, audit_id: sub, diagnostics });
        }
      }

      // 8. POST /sxo/events/import
      if (id === "events" && sub === "import") {
        if (method === "POST") {
          const workspaceId = body.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }

          const events = Array.isArray(body.events) ? body.events : [body];
          const provider = body.provider || "custom";
          const mappedCounts = {};
          const unmappedList = [];

          for (const item of events) {
            const rawName = item.event_name || item.name || item.event;
            if (!rawName) continue;
            const props = item.properties || item.params || {};
            const mapResult = mapSourceEvent(provider, rawName, props);
            if (mapResult.valid && mapResult.normalized_event) {
              const count = Number(item.count || 1);
              mappedCounts[mapResult.normalized_event] = (mappedCounts[mapResult.normalized_event] || 0) + count;
            } else {
              unmappedList.push({
                unmapped_name: mapResult.unmapped_name || rawName,
                reason: mapResult.reason || "Unrecognized event name",
              });
            }
          }

          const saved = await store.saveAnalyticsAggregates(userId, {
            auditId: body.audit_id || null,
            subjectId: body.subject_id || null,
            dateBucket: body.date_bucket || null,
            landingPage: body.landing_page || "/",
            sourceChannel: body.source_channel || "direct",
            device: body.device || "all",
            region: body.region || "global",
            visitorType: body.visitor_type || "all",
            conversionGoalId: body.conversion_goal_id || null,
            eventCounts: mappedCounts,
            metrics: body.metrics || {},
            workspaceId,
          });

          return json(200, {
            ok: true,
            imported_events_count: Object.keys(mappedCounts).length,
            event_counts: mappedCounts,
            unmapped: unmappedList,
            aggregate: saved.aggregate || null,
          });
        }
      }

      // 9. /sxo/integrations
      if (id === "integrations") {
        if (sub && subId === "connect" && method === "POST") {
          const provider = sub;
          const workspaceId = body.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }
          const saved = await store.saveAnalyticsConnection(userId, {
            provider,
            providerAccountId: body.provider_account_id || null,
            token: body.token || body.api_key || null,
            settings: body.settings || {},
            workspaceId,
          });
          return json(200, saved);
        }

        if (!sub && method === "GET") {
          const q = event.queryStringParameters || {};
          const connections = await store.listAnalyticsConnections(userId, {
            workspaceId: q.workspace_id || null,
          });
          return json(200, { ok: true, connections });
        }

        if (sub && !subId && method === "DELETE") {
          const provider = sub;
          const q = event.queryStringParameters || {};
          const workspaceId = q.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }
          await store.deleteAnalyticsConnection(userId, provider, { workspaceId });
          return json(200, { ok: true, disconnected: provider });
        }
      }

      // 10. /sxo/conversion-goals
      if (id === "conversion-goals") {
        if (method === "POST") {
          const workspaceId = body.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }
          if (!body.name || !body.outcome_type) {
            return bad("`name` and `outcome_type` are required for conversion goals.");
          }
          const saved = await store.saveConversionGoal(userId, {
            name: body.name,
            outcomeType: body.outcome_type,
            targetUrl: body.target_url || null,
            targetSelector: body.target_selector || null,
            targetEvent: body.target_event || null,
            valueCents: Number(body.value_cents) || 0,
            auditId: body.audit_id || null,
            subjectId: body.subject_id || null,
            workspaceId,
          });
          return json(200, saved);
        }

        if (method === "GET") {
          const q = event.queryStringParameters || {};
          const goals = await store.listConversionGoals(userId, {
            auditId: q.audit_id || null,
            workspaceId: q.workspace_id || null,
          });
          return json(200, { ok: true, goals });
        }
      }

      // 11. /sxo/experiments (POST, GET)
      if (id === "experiments") {
        if (!sub && method === "POST") {
          const workspaceId = body.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }
          if (!body.experiment_name && !body.name) {
            return bad("`experiment_name` is required for optimization experiments.");
          }
          const expData = createExperimentRecord({
            auditId: body.audit_id || null,
            recommendationId: body.recommendation_id || null,
            experimentName: body.experiment_name || body.name,
            ticketUrl: body.ticket_url || null,
            hypothesis: body.hypothesis || null,
            expectedMetric: body.expected_metric || "sxo_total_score",
            baselineValue: body.baseline_value ?? null,
            currentValue: body.current_value ?? null,
            status: body.status || "active",
            observationPeriodDays: Number(body.observation_period_days) || 28,
            results: body.results || {},
          });
          const saved = await store.saveOptimizationExperiment(userId, {
            ...expData,
            workspaceId,
          });
          return json(200, saved);
        }

        if (!sub && method === "GET") {
          const q = event.queryStringParameters || {};
          const experiments = await store.listOptimizationExperiments(userId, {
            auditId: q.audit_id || null,
            status: q.status || null,
            workspaceId: q.workspace_id || null,
            limit: Number(q.limit) || 50,
          });
          return json(200, { ok: true, experiments });
        }

        if (sub && !subId && method === "GET") {
          const q = event.queryStringParameters || {};
          const experiment = await store.getOptimizationExperiment(userId, sub, {
            workspaceId: q.workspace_id || null,
          });
          if (!experiment) return notFound("Experiment not found.");
          return json(200, { ok: true, experiment });
        }

        if (sub && subId === "evaluate" && method === "POST") {
          const baseline = body.baseline_audit_id ? await store.getAuditFull(userId, body.baseline_audit_id) : null;
          const current = body.current_audit_id ? await store.getAuditFull(userId, body.current_audit_id) : null;
          const impact = evaluateExperimentImpact({
            baselineAudit: baseline,
            currentAudit: current,
            targetMetric: body.target_metric || "sxo_total_score",
          });
          await store.updateOptimizationExperiment(userId, sub, {
            results: impact,
            status: body.complete ? "completed" : "active",
            current_value: impact.current,
          });
          return json(200, { ok: true, impact });
        }
      }

      // 12. /sxo/portfolio/rollups (GET, POST)
      if (id === "portfolio" && sub === "rollups") {
        if (method === "GET") {
          const q = event.queryStringParameters || {};
          const rollups = await store.listPortfolioRollups(userId, {
            rollupAxis: q.axis || null,
            workspaceId: q.workspace_id || null,
            limit: Number(q.limit) || 100,
          });
          return json(200, { ok: true, rollups });
        }

        if (method === "POST") {
          const workspaceId = body.workspace_id || null;
          if (workspaceId) {
            const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "run_audit");
            if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
          }
          const axis = body.axis || body.rollup_axis;
          if (!axis || !PORTFOLIO_ROLLUP_AXES.includes(axis)) {
            return bad(`Invalid axis "${axis}". Must be one of: ${PORTFOLIO_ROLLUP_AXES.join(", ")}.`);
          }
          const calculated = calculatePortfolioRollup(body.audits || [], {
            axis,
            axisValue: body.axis_value || "all",
          });
          const saved = await store.savePortfolioRollup(userId, {
            rollupAxis: calculated.rollup_axis,
            axisValue: calculated.axis_value,
            auditCount: calculated.audit_count,
            masterScore: calculated.master_score,
            layerScores: calculated.layer_scores,
            frameworkScores: calculated.framework_scores,
            coverage: calculated.coverage,
            workspaceId,
          });
          return json(200, saved);
        }
      }

      // 13. POST /sxo/recommendations/:id/validate
      if (id === "recommendations" && sub && subId === "validate" && method === "POST") {
        const workspaceId = body.workspace_id || null;
        if (workspaceId) {
          const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "manage_workflow");
          if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
        }
        const r = await store.setRecommendationStatus(userId, sub, "validated", body.reason || "Validated via SXO", {
          validatedByAuditId: body.validated_by_audit_id || null,
          notes: body.notes || null,
          ...(workspaceId ? { workspaceId } : {}),
        });
        if (r.notFound) return notFound("Recommendation not found.");
        if (!r.ok) return bad(r.error);
        return json(200, {
          ok: true,
          recommendation: r.recommendation,
          relationship: "correlation",
          caveats: [
            "Observed metric movement between baseline and observation periods is correlational.",
            "Correlation does not establish causation.",
          ],
        });
      }

      return json(405, { error: "Method not allowed." });
    }

    // ── /profiles — static reference data for the UI ────────────────────────
    if (root === "profiles" && method === "GET") return json(200, intakeReference());

    // Diagnostic only — never triggered on a successful route match, so this
    // costs nothing when routing works. If resolveSplat's marker search ever
    // needs a third `event.path` shape, this is what tells us which one
    // instead of another guess-deploy-report cycle (see resolveSplat's own
    // comment for the first two shapes it already had to learn to handle).
    console.error("[discoverability] Unknown endpoint — routing could not resolve a sub-path", {
      method, rawPath: event.path, rawQuerySplat: event.queryStringParameters?.splat,
      resolvedSplat: resolveSplat(event), parsedPath: path,
    });
    return notFound("Unknown endpoint.");
  } catch (err) {
    return json(500, { error: "Unexpected server error.", detail: err?.message });
  }
};

// ── Route handlers ─────────────────────────────────────────────────────────

async function createAuditRoute(event, userId, body) {
  const { errors, url, options } = parseAuditOptions(body);
  if (errors.length) return bad(errors.join(" "), { code: "INVALID_REQUEST" });

  if (!userId) {
    // ── Guest Audit Quota Check (1 free audit) ─────────────────────────
    const guestUsage = await consumeGuestCredit(event, "single");
    if (!guestUsage.allowed) {
      return json(402, {
        error: "You have used your free Discoverability audit. Sign in to save reports and unlock ongoing monitoring.",
        code: "UPGRADE_REQUIRED",
        upgradeTo: "starter",
      });
    }

    const run = await executeAudit({
      event, userId: null, rawUrl: url, options, resolved: null, source: "guest_ui",
    });
    const extraHeaders = guestUsage.cookie ? { "Set-Cookie": guestUsage.cookie } : {};
    return json(run.statusCode, run.body, extraHeaders);
  }

  // Idempotency BEFORE the quota check: a retried request must return the
  // original audit, not spend a second credit on the same work.
  if (options.idempotencyKey) {
    const existing = await store.findByIdempotencyKey(userId, options.idempotencyKey);
    if (existing) {
      const full = await store.getAuditFull(userId, existing.id);
      return json(200, { ...shapeFull(full), idempotent_replay: true });
    }
  }

  const gate = await gateAuditQuota(event, userId, 1, body.workspace_id);
  if (!gate.ok) return gate.response;

  const run = await executeAudit({
    event, userId, rawUrl: url, options, resolved: gate.resolved, source: body.source === "api" ? "api" : "ui",
  });
  return json(run.statusCode, run.body);
}

async function rerunRoute(event, userId, auditId, body) {
  if (!userId) return unauthorized();

  const resolved = await resolveRequestEntitlement(event);

  // ── 🔴 `resolved.plan` HAS NEVER EXISTED ────────────────────────────────
  //
  // This gate read `resolved.plan?.id`, and `resolveRequestEntitlement` has
  // only ever returned `{userId, guest, entitlement, degraded, planMap,
  // supabase}` — no `plan` key on any of its four return paths. So the
  // optional chain produced `undefined`, the `|| "free"` fallback fired on
  // EVERY request, and every re-audit answered 402 "requires a paid plan" —
  // to Pro and Business customers included.
  //
  // It failed CLOSED and it failed SILENTLY, which is why it survived: the
  // refusal is a plausible-looking upgrade prompt rather than an error, so it
  // reads as a plan limit to the customer and as working code to us. The
  // adjacent gates all read `resolved.entitlement` correctly (gateAuditQuota,
  // the benchmark and schedule routes); this one path had its own spelling.
  //
  // Fixed to the shape the resolver actually returns, and made to fail OPEN on
  // a degraded lookup like every other capability check in this codebase — a
  // Supabase blip must not become "your plan does not include this".
  const planId = resolved.entitlement?.plan_id || "free";
  if (!resolved.guest && !resolved.degraded && planId === "free") {
    return json(402, {
      error: "Re-discovery and comparative re-auditing require a paid DatIQ plan.",
      code: "UPGRADE_REQUIRED",
      upgradeTo: "starter",
    });
  }

  const prior = await store.getAudit(userId, auditId);
  if (!prior) return notFound("Audit not found.");

  const gate = await gateAuditQuota(event, userId, 1, body.workspace_id);
  if (!gate.ok) return gate.response;

  // ── THE INTAKE IS INHERITED, NOT RE-ASKED ────────────────────────────────
  //
  // A re-audit exists to answer "did my fix work", and that question is only
  // answerable if the second run was commissioned exactly like the first. A
  // rerun that quietly dropped the goal, the geography or the competitor set
  // would still be diffed against its baseline — nothing downstream knows the
  // context changed — and the delta would be read as page movement.
  //
  // `??`, not `||`, on every field a caller can legitimately CLEAR. With `||`
  // an explicit `primary_goal: null` ("I no longer have that goal") silently
  // re-inherits the old one, which is the failure mode of a form that lets you
  // change your mind and does not record it.
  const inheritedProfile = body.audit_profile ?? prior.audit_profile;
  const run = await executeAudit({
    event, userId, rawUrl: body.target_url || prior.target_url,
    options: {
      deviceProfile: body.device_profile || prior.device_profile,
      auditProfile: inheritedProfile,
      // A profile inherited from the baseline is an explicit one for this run:
      // the baseline was scored under that lens, and re-inferring a different
      // one from the same page would change which score leads the comparison.
      auditProfileExplicit: Boolean(AUDIT_PROFILES[inheritedProfile]),
      auditType: "rerun",
      primaryGoal: body.primary_goal !== undefined
        ? (PRIMARY_GOALS[body.primary_goal] ? body.primary_goal : null)
        : (prior.primary_goal || null),
      targetGeography: body.target_geography !== undefined
        ? normaliseGeography(body.target_geography)
        : normaliseGeography(prior.target_geography),
      competitorUrls: body.competitor_urls !== undefined
        ? normaliseCompetitorUrls(body.competitor_urls).urls
        : (prior.competitor_urls || []),
      pageTypeHint: body.page_type_hint || prior.page_type_hint,
      // The re-run is automatically measured against the audit it re-ran, which
      // is what makes "did my fix work" a single click.
      baselineAuditId: auditId,
      promptSetId: body.prompt_sample_set_id || prior.prompt_set_id,
      // 🔴 INHERITED, OR A RE-AUDIT SILENTLY LEAVES ITS WORKSPACE.
      // Every other intake field is carried across; workspace was added in W8
      // and missed here, which would have made the ONE path the validation loop
      // depends on — "re-run and compare" — the path that drops it. The
      // baseline would sit in a workspace queue and its re-audit would not.
      workspaceId: body.workspace_id !== undefined
        ? (body.workspace_id || null)
        : (prior.workspace_id || null),
      tags: prior.tags || [],
    },
    resolved: gate.resolved, source: "rerun",
  });
  await store.recordEvent(userId, { auditId, eventType: "rerun", payload: { new_audit_id: run.body?.auditId } });
  return json(run.statusCode, run.body);
}

async function compareRoute(userId, currentFull, baselineId) {
  const baselineFull = await store.getAuditFull(userId, baselineId);
  if (!baselineFull) return notFound("Baseline audit not found.");

  // 🔴 D7 — REFUSE A COMPARISON BETWEEN TWO DIFFERENT THINGS.
  //
  // This route accepts any baseline the caller owns, and until now it compared
  // whatever it was given: an audit of /pricing against an audit of /about
  // produced a confident "+6.2" that meant nothing. The UI happens to pass the
  // audit's own recorded baseline, so it was never exercised from a browser —
  // but `/api/v1` key holders reach the same handler, and a number on a report
  // is what gets screenshotted.
  //
  // `sameSubject` carries the backward-compatibility rule: two pre-0057 audits
  // fall back to `target_id`, which every audit has had since 0030, and two
  // NULL subjects are NEVER treated as a match.
  const same = sameSubject(baselineFull.audit, currentFull.audit);
  const diff = same
    ? diffAudits(rehydrate(baselineFull), rehydrate(currentFull))
    : incomparableDiff(
        rehydrate(baselineFull), rehydrate(currentFull),
        baselineFull.result?.scoring_model_version || "v1",
        currentFull.result?.scoring_model_version || "v1",
        subjectMismatchCause(subjectMismatchReason(baselineFull.audit, currentFull.audit)),
      );

  return json(200, {
    baseline: {
      audit_id: baselineFull.audit.id, created_at: baselineFull.audit.created_at,
      subject_id: baselineFull.audit.subject_id || null,
    },
    current: {
      audit_id: currentFull.audit.id, created_at: currentFull.audit.created_at,
      subject_id: currentFull.audit.subject_id || null,
    },
    comparable: same,
    diff,
  });
}

/**
 * Generate the audit's executive summary, once, and cache it.
 *
 * ── LAZY, NOT PART OF THE AUDIT RUN ────────────────────────────────────────
 * AUDIT_BUDGET_MS defaults to 8000ms against Netlify's stock 10s function
 * timeout, and the 504 this module shipped in August came from precisely this
 * shape of mistake: per-call timeouts that composed additively with no notion
 * of the platform's limit. An extra model call inside runAudit would re-create
 * it. So the summary is generated on FIRST REPORT VIEW and stored, which costs
 * the audit path nothing and costs the reader one round trip, once.
 *
 * ── IT IS OPTIONAL, IN BOTH DIRECTIONS ─────────────────────────────────────
 * If the model is unavailable this returns 200 with `summary: null`, not an
 * error: the report header degrades to the deterministic facts, which are the
 * part that matters. And if the cache write fails, the summary is still
 * returned — it just gets regenerated next time.
 */
async function summaryRoute(userId, auditId, full) {
  const audit = rehydrate(full);
  if (!audit) return notFound("Audit not found.");

  // Already have one. Idempotent by design: a reader refreshing the report
  // must not spend another model call, and two readers of the same audit must
  // see the same words.
  if (audit.summary) {
    return json(200, { summary: audit.summary, model: audit.summaryModel, cached: true });
  }

  const result = await summariseAudit(audit);
  if (!result?.summary) {
    return json(200, { summary: null, cached: false, unavailable: true });
  }

  const saved = await store.saveAuditSummary(userId, auditId, {
    summary: result.summary, model: result.provider,
  });
  return json(200, {
    summary: result.summary,
    model: result.provider,
    cached: false,
    persisted: saved.ok,
  });
}

function reportRoute(event, full) {
  const format = (event.queryStringParameters?.format || "markdown").toLowerCase();
  const audit = rehydrate(full);
  if (format === "json") return json(200, toJsonPayload(audit));
  if (format === "csv") {
    // `rows` selects a section. Default stays `recommendations` — it is what
    // every existing caller gets today and this is a public API surface — but
    // `all` is what the UI now offers, because the commonest thing anyone wants
    // is the whole report and making them download four files to get it is how
    // a report ends up forwarded incomplete.
    const CSV_ROWS = {
      issues: issuesToCsv,
      recommendations: recommendationsToCsv,
      signals: signalsToCsv,
      scores: scoresToCsv,
      all: bundleToCsv,
    };
    const which = CSV_ROWS[event.queryStringParameters?.rows] || recommendationsToCsv;
    return text(200, brandCsv(which(audit), audit), "text/csv; charset=utf-8");
  }
  return text(200, buildMarkdownReport(audit, {
    includeConstructs: event.queryStringParameters?.constructs === "1",
  }), "text/markdown; charset=utf-8");
}

/**
 * Check the audit quota.
 *
 * Fails OPEN when the count could not be read, matching requireEntitlement's
 * asymmetry: a Supabase blip must not take auditing down. It fails CLOSED only
 * on an explicitly-read over-quota state.
 */
async function gateAuditQuota(event, userId, count, rawWorkspaceId, capability = "audit") {
  const resolved = await resolveRequestEntitlement(event);
  // A refusal here (named a workspace the caller isn't in, or a paused seat)
  // takes priority over the quota read below — same "decline before doing
  // work" posture the quota check itself already follows.
  const { ctx: workspaceCtx, refusal } = await buildWorkspaceCtx(resolved, rawWorkspaceId);
  if (refusal) {
    return { ok: false, response: json(403, { error: refusal.message, code: refusal.code }) };
  }
  const { count: used, degraded } = await store.countAuditsThisMonth(userId);
  if (degraded) return { ok: true, resolved };

  // ⚠️ `capability` IS A PARAMETER SO THERE IS ONE QUOTA GATE, NOT TWO.
  // `audit.revalidate` delegates to `audit` inside the model, so it needs the
  // same real monthly count — routing it through a feature-only gate reads
  // `usage.audits` off an object nobody populated and 500s.
  const check = checkCapability(resolved, capability, {
    usage: { audits: used },
    auditCount: count,
    bonusAudits: resolved.entitlement?.bonus_audits || 0,
    ...workspaceCtx,
  });
  if (!check.allowed) {
    return { ok: false, response: json(DENY_STATUS, { ...denyBody(check), used, capability }) };
  }
  return { ok: true, resolved };
}

/**
 * P2 · W14 / D9 — the feature gate the intelligence layer shipped without.
 *
 * 🔴 W9 THROUGH W13 HAD NO ENTITLEMENT CHECK OF ANY KIND. Every truth record,
 * graph edge, directory listing and trust observation was writable on any plan
 * including Free — the same gap Phases 4-6 had, where three cost-bearing
 * operations went unmetered and three of the BRD's own upgrade triggers were
 * unenforceable. A 100% green gate proved nothing about them, because nothing
 * checked.
 *
 * ⚠️ FAILS OPEN ON INFRASTRUCTURE, CLOSED ONLY ON AN EXPLICIT REFUSAL — the
 * same asymmetry `requireEntitlement` and `gateAuditQuota` already hold. A
 * Supabase blip must not take the intelligence layer down.
 *
 * ⚠️ READS ARE NOT GATED, WRITES ARE. Refusing to show a customer the record
 * they already own would be taking away something they were given, which is a
 * different act from declining to create more.
 */
async function gateP2Capability(event, capability, rawWorkspaceId, action = "run_analysis") {
  const resolved = await resolveRequestEntitlement(event);
  const roleGate = await requireWorkspaceDiscoverabilityAction(
    resolved.userId, rawWorkspaceId, action,
  );
  if (!roleGate.ok) {
    return {
      ok: false,
      response: json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code }),
    };
  }
  const workspaceCtx = roleGate.ctx || {};
  if (resolved.degraded) return { ok: true, resolved };

  const check = checkCapability(resolved, capability, { ...workspaceCtx });
  if (!check.allowed) {
    return { ok: false, response: json(DENY_STATUS, { ...denyBody(check), capability }) };
  }
  return { ok: true, resolved };
}

/**
 * P2 · W14 — ask for a re-audit. Explicit, gated and idempotent.
 *
 * 🔴 IT DOES NOT RUN THE AUDIT. A re-audit is a paid action with its own
 * monthly budget; a control that silently spends one is the shape of thing a
 * customer discovers on an invoice. This records the request, charges nothing,
 * and leaves the run to the monitor's own tick where it is visible and
 * countable.
 *
 * ⚠️ THE ENTITLEMENT CHECK STILL HAPPENS HERE, at request time, because
 * refusing at run time would refuse silently — in a cron, with nobody present
 * to see it. A refusal has to reach the person who asked.
 */
async function revalidateRoute(event, userId, recId, body) {
  const workspaceId = body.workspace_id || event.queryStringParameters?.workspace_id || null;
  const rec = await store.getRecommendation(userId, recId, { workspaceId });
  if (!rec) return notFound("Recommendation not found.");
  const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "manage_workflow");
  if (!roleGate.ok) return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });

  // Only something believed FIXED is worth re-checking. Asking to revalidate
  // an open item would spend an audit to confirm what the last one said.
  if (!["implemented", "done", "validation_scheduled"].includes(rec.status)) {
    return json(409, {
      error: "Only an implemented recommendation can be revalidated. Mark it implemented first.",
      code: "NOT_IMPLEMENTED",
      status: rec.status,
    });
  }

  // ⚠️ IDEMPOTENCY IS CHECKED BEFORE THE QUOTA, deliberately. A second click on
  // an outstanding request must not read as "you are out of audits" — it is
  // not a new request at all, and refusing it for quota would be a refusal for
  // something the customer is not asking to do.
  if (rec.revalidation_requested_at) {
    return json(200, {
      revalidation: {
        requested_at: rec.revalidation_requested_at,
        baseline_audit_id: rec.revalidation_baseline_audit_id,
      },
      already_requested: true,
    });
  }

  // 🔴 THE REAL AUDIT QUOTA, not a feature flag — this spends one.
  const gate = await gateAuditQuota(event, userId, 1, workspaceId, "audit.revalidate");
  if (!gate.ok) return gate.response;

  const claim = await store.claimRevalidation(userId, recId, {
    baselineAuditId: body.baseline_audit_id || rec.audit_id || null,
    workspaceId,
  });
  if (!claim.ok) {
    return json(503, { error: "Could not record the request.", code: "STORAGE_UNAVAILABLE", detail: claim.error });
  }
  if (!claim.claimed) {
    // Lost the race to a concurrent click. That is the outcome the caller
    // wanted, so it is a 200 — not an error and not a second audit.
    return json(200, { already_requested: true });
  }

  return json(201, {
    revalidation: {
      requested_at: claim.recommendation.revalidation_requested_at,
      baseline_audit_id: claim.recommendation.revalidation_baseline_audit_id,
    },
    recommendation: claim.recommendation,
  });
}

async function benchmarkRoute(event, userId, method, id, body) {
  if (method === "POST" && !id) {
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter(Boolean);
    if (urls.length < 2) return bad("A benchmark needs at least two URLs.");
    if (urls.length > MAX_BENCHMARK_URLS) {
      return bad(`A benchmark set holds at most ${MAX_BENCHMARK_URLS} URLs.`);
    }

    const resolved = await resolveRequestEntitlement(event);
    const { ctx: workspaceCtx, refusal } = await buildWorkspaceCtx(resolved, body.workspace_id);
    if (refusal) return json(403, { error: refusal.message, code: refusal.code });
    const { count: used, degraded } = await store.countAuditsThisMonth(userId);
    if (!degraded) {
      // Gated on the WHOLE set fitting. Half a competitive comparison is not a
      // smaller comparison, it is a misleading one.
      const check = checkCapability(resolved, "audit.benchmark", {
        usage: { audits: used }, urlCount: urls.length,
        bonusAudits: resolved.entitlement?.bonus_audits || 0,
        ...workspaceCtx,
      });
      if (!check.allowed) return json(DENY_STATUS, { ...denyBody(check), capability: "audit.benchmark" });
    }

    const profile = AUDIT_PROFILES[body.audit_profile] ? body.audit_profile : "balanced";
    const created = await store.createBenchmark(userId, {
      name: body.name || `Benchmark of ${urls.length} pages`,
      description: body.description || null,
      primaryUrl: body.primary_url || urls[0],
      auditProfile: profile,
      urls,
    });
    if (!created.ok) return json(503, { error: "Could not create the benchmark." });

    // Run them in series, not in parallel. Ten concurrent audits would each
    // fire a PageSpeed lookup and a citation sample; the rate limiter would
    // throttle them into a timeout, and the function's budget would expire
    // holding nine half-finished audits.
    const results = [];
    for (const member of created.members) {
      const run = await executeAudit({
        event, userId, rawUrl: member.url,
        options: {
          auditProfile: profile,
          // Explicit for every member, including the ones we would otherwise
          // infer a lens for. A set whose members were each scored under a
          // profile read off their own markup is not a comparison — the
          // "competitor intelligence" goal exists precisely to say that the
          // lens must favour nobody.
          auditProfileExplicit: true,
          auditType: "benchmark",
          primaryGoal: PRIMARY_GOALS[body.primary_goal] ? body.primary_goal : null,
          targetGeography: normaliseGeography(body.target_geography),
          deviceProfile: body.device_profile,
        },
        resolved, source: "benchmark",
      });
      if (run.ok && run.body?.auditId) {
        await store.attachBenchmarkAudit(member.id, run.body.auditId);
      }
      results.push({
        url: member.url, label: member.label,
        is_primary: member.is_primary,
        audit_id: run.ok ? run.body.auditId : null,
        error: run.ok ? null : run.body?.error || "audit failed",
        scores: run.ok ? {
          overall: run.body.finalScore, seo: run.body.seoScore,
          aeo: run.body.aeoScore, geo: run.body.geoScore, coverage: run.body.coverage,
        } : null,
      });
    }
    await store.completeBenchmark(created.benchmark.id);
    return json(201, { benchmark: created.benchmark, members: results });
  }

  if (method === "GET" && id) {
    const b = await store.getBenchmark(userId, id);
    if (!b) return notFound("Benchmark not found.");
    return json(200, b);
  }
  if (method === "GET" && !id) return json(200, { benchmarks: await store.listBenchmarks(userId) });
  if (method === "DELETE" && id) {
    const r = await store.deleteBenchmark(userId, id);
    return r.ok ? json(200, { deleted: true }) : notFound("Benchmark not found.");
  }
  return json(405, { error: "Method not allowed." });
}

/**
 * Prompt monitors — the recurring answer-engine sample.
 *
 * ⚠️ CREATION IS ENTITLEMENT-GATED, READS ARE NOT. A monitor spends real engine
 * calls on a cadence with nobody watching, which is precisely the shape of
 * thing that should not be ungated. Reading what you already own costs nothing
 * and is refused only by ownership.
 */
/**
 * Queue verbs → lifecycle states.
 *
 * ⚠️ THE FIRST FOUR KEEP THEIR EXACT SHIPPED MEANINGS. `done` maps to `done`
 * and not to `implemented`, even though they are one state, because every
 * stored row and webhook payload in existence says `done` and a client posting
 * it must get back what it expects.
 */
/**
 * Which webhook event a state change publishes.
 *
 * `open` maps to `reopened` rather than `opened`: a recommendation arriving at
 * `open` for the first time is already covered by `recommendation.created`, and
 * a subscriber receiving both for one row would double-count every new finding.
 */
const WEBHOOK_EVENT_FOR = Object.freeze({
  accepted: "recommendation.accepted",
  assigned: "recommendation.assigned",
  in_progress: "recommendation.in_progress",
  implemented: "recommendation.implemented",
  done: "recommendation.implemented",   // one state, one event
  validation_scheduled: "recommendation.validation_scheduled",
  validated: "recommendation.validated",
  no_measurable_change: "recommendation.no_measurable_change",
  regressed: "recommendation.regressed",
  dismissed: "recommendation.dismissed",
  open: "recommendation.reopened",
});

const VERB_TO_STATE = Object.freeze({
  accept: "accepted",
  dismiss: "dismissed",
  done: "done",
  reopen: "open",
  assign_state: "assigned",
  start: "in_progress",
  implemented: "implemented",
  schedule_validation: "validation_scheduled",
  validate: "validated",
  no_change: "no_measurable_change",
  regress: "regressed",
});

async function promptMonitorRoute(event, userId, method, id, sub, body) {
  if (method === "GET" && !id) {
    return json(200, { monitors: await store.listPromptMonitors(userId) });
  }
  if (method === "GET" && id && sub === "runs") {
    return json(200, { runs: await store.listPromptMonitorRuns(userId, id) });
  }
  if (method === "POST" && !id) {
    // Resolved here rather than threaded: every other route in this file does
    // the same, and one shared lookup would have to be recomputed anyway for
    // the workspace context each route builds differently.
    const resolved = await resolveRequestEntitlement(event);
    const check = checkCapability(resolved, "audit.prompt_monitor", {});
    if (!check.allowed) {
      return json(DENY_STATUS, { ...denyBody(check), capability: "audit.prompt_monitor" });
    }
    // Shares the scheduled-monitoring allowance with audit schedules, so the
    // count has to include both — otherwise a user at their limit acquires
    // more by pointing the next one at prompts instead of pages.
    const existingMonitors = await store.listPromptMonitors(userId);
    const existingSchedules = await store.listSchedules(userId);
    const held = existingMonitors.length + existingSchedules.length;
    if (Number.isFinite(check.remaining) && held >= check.remaining) {
      return json(DENY_STATUS, {
        error: `Your plan allows ${check.remaining} recurring monitor${check.remaining === 1 ? "" : "s"}, and you have ${held}.`,
        code: "QUOTA_EXCEEDED", capability: "audit.prompt_monitor",
      });
    }

    const targetId = String(body.target_id || "").trim();
    if (!targetId) return bad("target_id is required.");
    const cadence = ["daily", "weekly", "monthly"].includes(body.cadence) ? body.cadence : "weekly";
    const engine = ["perplexity", "gemini"].includes(body.engine) ? body.engine : null;

    const r = await store.createPromptMonitor(userId, {
      target_id: targetId,
      prompt_set_id: body.prompt_set_id || null,
      name: body.name ? String(body.name).slice(0, 120) : null,
      cadence,
      engine,
      alert_email: body.alert_email ? String(body.alert_email).slice(0, 200) : null,
      // Null, not now(): a monitor with no next_run_at is treated as due, so a
      // new one is sampled on the next tick rather than waiting a full cadence
      // to produce its first data point.
      next_run_at: null,
    });
    return r.ok ? json(201, { monitor: r.monitor }) : json(503, { error: r.error });
  }
  if (method === "DELETE" && id) {
    const r = await store.deletePromptMonitor(userId, id);
    return r.ok ? json(200, { deleted: true }) : notFound("Monitor not found.");
  }
  return json(405, { error: "Method not allowed." });
}

async function promptSetRoute(event, userId, method, id, body) {
  if (method === "POST" && !id) {
    const prompts = (Array.isArray(body.prompts) ? body.prompts : []).map(String).filter(Boolean).slice(0, 25);
    if (prompts.length === 0) return bad("A prompt set needs at least one prompt.");
    const r = await store.createPromptSet(userId, {
      name: body.name || "Prompt set", description: body.description || null, prompts,
    });
    return r.ok ? json(201, { prompt_set: r.promptSet }) : json(503, { error: "Could not save the prompt set." });
  }
  if (method === "GET" && !id) return json(200, { prompt_sets: await store.listPromptSets(userId) });
  if (method === "GET" && id) {
    const s = await store.getPromptSet(userId, id);
    return s ? json(200, { prompt_set: s }) : notFound("Prompt set not found.");
  }
  if (method === "DELETE" && id) {
    const r = await store.deletePromptSet(userId, id);
    return r.ok ? json(200, { deleted: true }) : notFound("Prompt set not found.");
  }
  return json(405, { error: "Method not allowed." });
}

async function webhookRoute(event, userId, method, id, body) {
  if (method === "POST" && !id) {
    const url = String(body.target_url || "").trim();
    if (!url) return bad("target_url is required.");
    // A webhook makes US fetch a URL the caller chose, so it is the same SSRF
    // surface as an audit and gets the same guard.
    if (!(await isPublicHttpUrlAsync(url))) return bad("That webhook URL is not a public web address.");
    const r = await store.createWebhook(userId, {
      targetUrl: url,
      events: Array.isArray(body.events) && body.events.length ? body.events : ["audit.completed"],
    });
    if (!r.ok) return json(503, { error: "Could not register the webhook." });
    // The signing secret is returned EXACTLY ONCE. It is stored encrypted and
    // no endpoint ever reads it back.
    return json(201, { webhook: r.webhook, secret: r.secret });
  }
  if (method === "GET") return json(200, { webhooks: await store.listWebhooks(userId) });
  if (method === "DELETE" && id) {
    const r = await store.deleteWebhook(userId, id);
    return r.ok ? json(200, { deleted: true }) : notFound("Webhook not found.");
  }
  return json(405, { error: "Method not allowed." });
}

async function scheduleRoute(event, userId, method, id, body) {
  if (method === "GET") return json(200, { schedules: await store.listSchedules(userId) });

  if (method === "POST" && !id) {
    const url = String(body.target_url || body.url || "").trim();
    if (!url) return bad("target_url is required.");
    if (!(await isPublicHttpUrlAsync(url))) return bad("That URL is not a public web address.");

    const resolved = await resolveRequestEntitlement(event);
    const { ctx: workspaceCtx, refusal } = await buildWorkspaceCtx(resolved, body.workspace_id);
    if (refusal) return json(403, { error: refusal.message, code: refusal.code });
    const existing = await store.listSchedules(userId);
    const check = checkCapability(resolved, "audit.schedule", workspaceCtx);
    if (!check.allowed) return json(DENY_STATUS, { ...denyBody(check), capability: "audit.schedule" });
    if (Number.isFinite(check.remaining) && existing.length >= check.remaining) {
      return json(DENY_STATUS, {
        error: `Your plan allows ${check.remaining} monitored page${check.remaining === 1 ? "" : "s"}.`,
        code: "QUOTA_EXCEEDED", capability: "audit.schedule",
      });
    }

    const canonical = canonicalAuditUrl(url) || url;
    let host = ""; try { host = new URL(url).hostname; } catch { /* unparseable */ }
    const targetId = await store.ensureTarget(userId, canonical, host, body.label || null);
    if (!targetId) return json(503, { error: "Audit storage is unavailable." });

    const r = await store.createSchedule(userId, {
      targetId, name: body.name || null,
      cadence: ["daily", "weekly", "monthly"].includes(body.cadence) ? body.cadence : "weekly",
      deviceProfile: body.device_profile === "desktop" ? "desktop" : "mobile",
      auditProfile: AUDIT_PROFILES[body.audit_profile] ? body.audit_profile : "balanced",
      // Stored on the schedule so every run it creates is commissioned the same
      // way. Without this a twelve-month monitor produces a series whose first
      // point had a goal and whose other fifty-one did not.
      primaryGoal: PRIMARY_GOALS[body.primary_goal] ? body.primary_goal : null,
      pageTypeHint: PAGE_TYPE_PACKS[body.page_type_hint] ? body.page_type_hint : null,
      targetGeography: normaliseGeography(body.target_geography),
      competitorUrls: normaliseCompetitorUrls(body.competitor_urls).urls,
      alertEmail: body.alert_email || null,
      alertThreshold: Number.isFinite(Number(body.alert_threshold)) ? Number(body.alert_threshold) : 3,
    });
    return r.ok ? json(201, { schedule: r.schedule }) : json(503, { error: "Could not save the schedule." });
  }

  if (method === "PATCH" && id) {
    const r = await store.updateSchedule(userId, id, body);
    if (r.notFound) return notFound("Schedule not found.");
    return r.ok ? json(200, { schedule: r.schedule }) : bad(r.error);
  }
  if (method === "DELETE" && id) {
    const r = await store.deleteSchedule(userId, id);
    return r.ok ? json(200, { deleted: true }) : notFound("Schedule not found.");
  }
  return json(405, { error: "Method not allowed." });
}

// ── Shaping ────────────────────────────────────────────────────────────────

/** Stored rows → the payload shape the pipeline and the client both speak. */
export function rehydrate(full) {
  if (!full?.result) return null;
  const r = full.result;

  // ── REBUILD THE PILLARS THROUGH scorePillar(), NOT BY HAND ───────────────
  //
  // This used to construct each signal object inline, and it quietly omitted
  // three fields the in-memory pipeline puts there: `label`, and each pillar's
  // `coverage` and `weight`. `audit_signals` stores only `signal_code` — which
  // is right, because codes are the public contract and a stored label would
  // freeze today's wording into every historical row — so nothing downstream
  // could recover them.
  //
  // The result was that a FRESH audit rendered correctly and a STORED one did
  // not, which is the worst shape a bug can take: it never reproduces while you
  // are looking at it. The exported markdown printed `| undefined | 0 | 25% |`
  // for every signal in every pillar, the pillar accordion showed blank signal
  // names on any audit reopened from history, and toJsonPayload emitted
  // pillar_scores[*].coverage as null.
  //
  // Feeding the stored per-signal values back through the SAME pure function
  // the pipeline used is what makes fresh and rehydrated audits identical by
  // construction rather than by two lists of fields agreeing. It also restores
  // registry declaration order — getAuditFull returns rows sorted
  // signal_code.asc, so a reopened audit listed its signals alphabetically
  // while a fresh one listed them in the order the pillar defines.
  //
  // The STORED pillar scores stay authoritative: they are what was persisted,
  // what the trend chart plots, and what a historical diff compares against.
  // Only the derived presentation fields are recomputed.
  const values = {};
  const reasons = {};
  // Provenance, keyed by signal code so it can be re-attached after
  // scorePillar() rebuilds the presentation fields. Without this a stored audit
  // shows scores with no workings while a fresh one shows both — the exact
  // fresh-renders-right / stored-renders-wrong shape this function's own header
  // records having been caught by once already.
  const storedEvidence = {};
  for (const row of full.signals || []) {
    values[row.signal_code] = row.normalized_score === null ? null : Number(row.normalized_score);
    if (row.unknown_reason) reasons[row.signal_code] = row.unknown_reason;
    // Records only. `raw_value` and `threshold_json` are stored for querying
    // and DERIVED again here from these same records, so the two can never
    // disagree — see attachEvidenceToPillars.
    storedEvidence[row.signal_code] = Array.isArray(row.evidence_json) ? row.evidence_json : [];
  }

  const storedPillarScore = {
    answer_clarity: r.answer_clarity_score,
    entity_authority: r.entity_authority_score,
    structural_hierarchy: r.structural_hierarchy_score,
    technical_accessibility: r.technical_accessibility_score,
  };

  const pillars = {};
  for (const pillar of PILLAR_IDS) {
    const rebuilt = scorePillar(pillar, values, reasons);
    const stored = storedPillarScore[pillar];
    pillars[pillar] = {
      ...rebuilt,
      weight: PILLARS[pillar].weight,
      score: stored === null || stored === undefined ? rebuilt.score : Number(stored),
    };
  }

  // The same decorator the pipeline runs, fed from the stored records instead
  // of a live collector. See attachEvidenceToPillars' own comment for why this
  // must not be a second implementation.
  const decorated = attachEvidenceToPillars(pillars, storedEvidence);

  return {
    auditId: full.audit.id,
    target: {
      url: full.audit.target_url, page_type: full.audit.page_type,
      device_profile: full.audit.device_profile, audit_profile: full.audit.audit_profile,
      // Rows written before 0049 carry no source. They were commissioned with
      // whatever the caller sent or the 'balanced' fallback and nothing was
      // ever inferred, so 'default' is a true statement about them rather than
      // a guess — the same reasoning the migration's own default rests on.
      audit_profile_source: full.audit.audit_profile_source || "default",
      // The pipeline puts the human label here (auditPipeline.js:341). Without
      // it every export printed the raw enum — "page" instead of "General page".
      page_type_label: packFor(full.audit.page_type).label,
    },
    // ── THE INTAKE, REBUILT TO THE SHAPE THE PIPELINE EMITS ────────────────
    // Same discipline as the pillars above: a reopened audit must be
    // indistinguishable from a fresh one, so this block mirrors the pipeline's
    // `intake` field key for key. `primary_goal` stays NULL where the question
    // was never asked; defaulting it here would invent an intent for every
    // audit that predates 0049.
    intake: {
      audit_type: full.audit.audit_type || "url",
      primary_goal: full.audit.primary_goal || null,
      target_geography: full.audit.target_geography || null,
      competitor_urls: full.audit.competitor_urls || [],
    },
    finalScore: num(r.final_score), seoScore: num(r.seo_score),
    aeoScore: num(r.aeo_score), geoScore: num(r.geo_score),
    headlineFramework: r.headline_framework,
    coverage: num(r.coverage),
    // Coverage travels WITH each framework score. A framework-weighted coverage
    // is not the same number for all four views — a missing technical signal
    // costs the tech-heavy SEO view more than the answer-heavy AEO view — and
    // dropping it here is what left CoverageNote blank on every reopened audit.
    // Recomputed with scoreFramework(), the same function the pipeline uses.
    frameworks: {
      overall: { score: num(r.final_score), coverage: scoreFramework("overall", pillars).coverage },
      seo: { score: num(r.seo_score), coverage: scoreFramework("seo", pillars).coverage },
      aeo: { score: num(r.aeo_score), coverage: scoreFramework("aeo", pillars).coverage },
      geo: { score: num(r.geo_score), coverage: scoreFramework("geo", pillars).coverage },
    },
    pillars: decorated,
    penalties: r.engine_json?.penalties || [],
    penaltyMultiplier: num(r.penalty_multiplier),
    scoreMath: { prePenaltyTotal: num(r.pre_penalty_score), penaltyMultiplier: num(r.penalty_multiplier), finalScore: num(r.final_score) },
    // Rows written before 0048 carry no version. They were scored by v1 — the
    // only model this repository has ever shipped — and the migration backfills
    // them; this fallback covers a read that races the migration rather than
    // inventing a version for an unknown model.
    scoringModelVersion: r.scoring_model_version || "v1",
    issues: (full.issues || []).map((i) => ({
      code: i.code, pillar: i.pillar, severity: i.severity,
      frameworks: i.framework_scope || [], title: i.title, evidence: i.evidence, details: i.details_json,
      evidenceRecords: Array.isArray(i.evidence_json) ? i.evidence_json : [],
      // ── The gap-analysis fields (0050), rebuilt key for key ─────────────
      //
      // `observed` falls back to the sentence, because on a row written before
      // 0050 the sentence IS the observed fact — it was just not labelled as
      // one. `inference`, `rootCause` and `module` do NOT fall back to the
      // catalogue: those rows were recorded before the taxonomy existed, and
      // back-filling a diagnosis nobody made at the time would put a claim in
      // front of a customer that no run ever produced. Null renders as "not
      // classified", which is true.
      observed: i.observed ?? i.evidence ?? null,
      inference: i.inference ?? null,
      rootCause: i.root_cause ?? null,
      module: i.recommended_module ?? null,
      owner: i.owner_role ?? null,
      status: i.status || "open",
      statusChangedAt: i.status_changed_at || null,
    })),
    recommendations: (full.recommendations || []).map((x) => ({
      id: x.id, code: x.code, pillar: x.pillar, frameworks: x.frameworks || [],
      // Declared in 0030 and written by nothing until W4. Null on every row
      // older than that, which is what "this task predates the link" looks
      // like — not an error.
      issueId: x.issue_id || null,
      priority: x.priority, priorityScore: num(x.priority_score),
      impactScore: num(x.impact_score), effortScore: num(x.effort_score),
      confidenceScore: num(x.confidence_score), estimatedLift: num(x.estimated_lift),
      owner: x.owner_role, title: x.title, rationale: x.rationale, evidence: x.evidence,
      implementationAsset: x.implementation_asset_json, status: x.status,
    })),
    estimatedTotalLift: num(r.estimated_total_lift),
    // Cached on first report view (see the /summary route). Carried here so it
    // reaches the markdown, the PDF and the JSON from the same place the scores
    // do — generating it per format would let them disagree about the same run.
    summary: r.summary_md || null,
    summaryModel: r.summary_model || null,
    summaryGeneratedAt: r.summary_generated_at || null,
    facts: r.facts_json || {},
    evidence: r.evidence_json || {},
    meta: { startedAt: full.audit.started_at || full.audit.created_at, engine: r.engine_json || {} },
    stageErrors: r.engine_json?.stageErrors || [],
    promptRuns: full.promptRuns || [],
  };
}

function shapeFull(full) {
  return full ? { audit: full.audit, ...rehydrate(full) } : null;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Attach the construct a recommendation promises, on demand. */
export function assetFor(rec) {
  return rec?.implementation_asset_json || buildConstruct(rec?.asset_type, {});
}

/**
 * Compare what this audit observed against the business's approved record.
 *
 * 🔴 THIS IS WHY THE TRUTH RECORD IS NOT JUST A FORM. A table that only stores
 * what the customer typed produces nothing. Comparing it to the pages produces
 * "you told us Acme Technologies Pvt Ltd; your schema says Acme" — which is
 * frequently the explanation for why three engines disagree about who they are.
 *
 * ⚠️ IT NEVER FAILS AN AUDIT. The audit ran and was charged for; a truth record
 * that is missing, unapproved, or briefly unreadable is not a reason to lose
 * it. Every failure path here returns null and the audit is returned as normal.
 *
 * ⚠️ AND IT ONLY RUNS AGAINST AN APPROVED VERSION. Comparing a page to an
 * un-reviewed draft would raise findings against facts nobody has agreed are
 * true, which is the exact effect the approval gate exists to prevent.
 */
async function checkAgainstTruthRecord(userId, auditId, rawUrl, result) {
  try {
    const host = normalizeFieldValue("canonical_domain", rawUrl);
    if (!host) return null;

    const records = await store.listTruthRecords(userId);
    const record = records.find((r) => r.canonical_domain === host);
    if (!record?.current_version_id) return null;

    const canonicalVersion = await store.getCanonicalTruthVersion(userId, record.id);
    if (!canonicalVersion) return null;

    const node = result?.facts?.organization_node
      || result?.pillars?.entity_authority?.facts?.organization_node
      || null;
    const observedFacts = node
      ? factsFromSchemaOrg(node, { sourceUrl: rawUrl, collectedAt: new Date().toISOString() })
      : {};

    // 🔴 SCOPED TO WHAT THIS PAGE COULD PLAUSIBLY HAVE SAID.
    // Without a scope, every field in the record that a single audited page
    // never mentions becomes a BT-02, and one audit of a blog post would raise
    // twenty absences. The scope is the fields the record holds AND the mapper
    // knows how to read — anything outside it is not a finding, it is a
    // question this audit did not ask.
    const canonicalFields = canonicalVersion.fields_json || {};
    const scope = Object.keys(canonicalFields).filter((f) => f in SCHEMA_READABLE);

    const conflicts = detectConflicts(canonicalFields, observedFacts, { fields: scope });
    if (conflicts.length) {
      await store.recordTruthConflicts(record.id, auditId, canonicalVersion.id, conflicts);
    }

    return {
      record_id: record.id,
      version_id: canonicalVersion.id,
      version_no: canonicalVersion.version_no,
      checked_fields: scope,
      conflicts,
      // Distinguishes "we compared and found nothing" from "there was nothing
      // on the page to compare against" — the same distinction BT-01 and BT-02
      // draw, one level up.
      identity_markup_present: Boolean(node),
    };
  } catch {
    return null;
  }
}

// ── /business-truth — the Canonical Business Truth Record (W9) ─────────────
//
// Routes:
//   GET    /business-truth/fields                reference data for the form
//   GET    /business-truth                       list this user's records
//   POST   /business-truth                       create a record
//   GET    /business-truth/:id                   record + versions + open conflicts
//   DELETE /business-truth/:id                   archive
//   POST   /business-truth/:id/versions          propose a version
//   GET    /business-truth/:id/versions/:vid     one version, with its gate report
//   POST   /business-truth/:id/versions/:vid/submit    draft -> pending_review
//   POST   /business-truth/:id/versions/:vid/reject    -> rejected, reason required
//   POST   /business-truth/:id/versions/:vid/promote   -> approved + canonical
//   GET    /business-truth/:id/diff?from=&to=    field-level version diff
//   POST   /business-truth/:id/conflicts/:cid/resolve
//
// 🔴 PROMOTION IS ITS OWN VERB, NOT A PATCH. `setTruthVersionState` refuses
// `approved` outright and this route sends it through the SQL function, so
// there is exactly one path by which a fact becomes something other modules
// assert as true — and it is the path carrying the interlocks.

/** Turn a `{ fieldId: rawValue }` body into facts, reporting what it dropped. */
function factsFromBody(rawFields, { source, statedBy, statedAt }) {
  const fields = {};
  const rejected = [];
  for (const [id, value] of Object.entries(rawFields || {})) {
    if (!TRUTH_FIELDS[id]) { rejected.push({ field: id, reason: "unknown_field" }); continue; }
    // An explicit null clears a field — distinct from omitting it, which leaves
    // whatever the previous version said. Both are legitimate edits and
    // collapsing them would make "delete this fact" unexpressible.
    if (value === null) continue;
    const fact = makeFact({ field: id, value, source, statedBy, statedAt });
    if (!fact) {
      rejected.push({
        field: id,
        reason: normalizeFieldValue(id, value) === null ? "unusable_value" : "rejected",
      });
      continue;
    }
    fields[id] = fact;
  }
  return { fields, rejected };
}

/** A version as the API reports it: the row, plus what the pure model says about it. */
function describeVersion(row) {
  if (!row) return null;
  const version = { state: row.state, fields: row.fields_json || {}, proposed_by: row.proposed_by, reviewed_by: row.reviewed_by };
  return {
    ...row,
    summary: summariseRecord(version),
    gate: canPromote(version),
  };
}

async function businessTruthRoute(userId, method, path, body, event) {
  const workspaceId = body.workspace_id || event.queryStringParameters?.workspace_id || null;
  // W14/D9. Writes are gated; reads are not — refusing to show a customer the
  // record they already own is taking away something they were given, which is
  // a different act from declining to create more.
  if (method !== "GET") {
    const approving = path.includes("promote") || path.includes("reject") || path.includes("conflicts");
    const gate = await gateP2Capability(
      event, "audit.business_truth", workspaceId,
      approving ? "approve_changes" : "propose_changes",
    );
    if (!gate.ok) return gate.response;
  }
  // `path` is the whole parsed sub-path, because a version verb lives at
  // position 4 (`/business-truth/:id/versions/:vid/promote`) and the handler
  // re-deriving it from the raw event would be a second parser to keep in step
  // with `resolveSplat`, which this file has already had to teach two URL
  // shapes.
  const [, id, sub, subId, verb] = path;
  // Static reference data for the form. No record needed, so it is checked
  // before anything that would look one up.
  if (id === "fields" && method === "GET") {
    return json(200, {
      groups: TRUTH_FIELD_GROUPS,
      fields: TRUTH_FIELD_IDS.map((f) => ({ ...TRUTH_FIELDS[f] })),
      sources: Object.values(FACT_SOURCES),
      states: Object.values(VERSION_STATES),
      required_for_canonical: REQUIRED_FOR_CANONICAL,
      conflict_codes: Object.values(TRUTH_CONFLICT_CODES),
    });
  }

  // ── Collection ───────────────────────────────────────────────────────────
  if (!id) {
    if (method === "GET") {
      const q = event.queryStringParameters || {};
      const readGate = await requireWorkspaceDiscoverabilityAction(userId, q.workspace_id, "read");
      if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
      const records = await store.listTruthRecords(userId, { workspaceId: q.workspace_id || null });
      return json(200, { records, count: records.length });
    }

    if (method === "POST") {
      const domain = normalizeFieldValue("canonical_domain", body.canonical_domain || body.domain);
      if (!domain) {
        return bad("A canonical domain is required, as a bare host such as acme.example.",
          { code: "INVALID_REQUEST" });
      }
      // Membership is re-checked here rather than trusted from the body — the
      // same rule every other workspace-carrying route in this file follows.
      const { refusal } = await buildWorkspaceCtx({ userId }, body.workspace_id);
      if (refusal) return json(403, { error: refusal.message, code: refusal.code });

      const notApplicable = Array.isArray(body.not_applicable)
        ? body.not_applicable.filter((f) => TRUTH_FIELDS[f]) : [];

      const created = await store.createTruthRecord(userId, {
        canonicalDomain: domain,
        displayName: body.display_name || null,
        targetId: body.target_id || null,
        workspaceId: body.workspace_id || null,
        notApplicable,
      });
      if (created.duplicate) {
        // 409, not 400: the request was well formed and the collision is the
        // table doing its job — one live answer to "what is true" per business.
        return json(409, {
          error: `A truth record already exists for ${domain}. Open it rather than starting a second one — two records would give two answers to the same question.`,
          code: "RECORD_EXISTS",
        });
      }
      if (!created.ok) return json(500, { error: "Could not create the record.", detail: created.error });
      return json(201, { record: created.record });
    }

    return notFound("Unknown endpoint.");
  }

  // ── One record ───────────────────────────────────────────────────────────
  if (!sub) {
    if (method === "GET") {
      const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
      if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
      const full = await store.getTruthRecordFull(userId, id, { workspaceId });
      if (!full) return notFound("Truth record not found.");
      const canonical = full.versions.find((v) => v.id === full.current_version_id) || null;
      return json(200, {
        record: { ...full, versions: full.versions.map(describeVersion) },
        canonical: describeVersion(canonical),
        // A record with nothing approved is not "empty" — it is un-reviewed,
        // and saying which is the difference between a bug and a to-do.
        canonical_state: canonical ? "approved" : "none_approved",
      });
    }
    if (method === "DELETE") {
      const r = await store.archiveTruthRecord(userId, id, { workspaceId });
      return r.ok ? json(200, { archived: true }) : notFound("Truth record not found.");
    }
    return notFound("Unknown endpoint.");
  }

  // ── Versions ─────────────────────────────────────────────────────────────
  if (sub === "versions") {
    if (!subId && method === "POST") {
      const record = await store.getTruthRecord(userId, id, { workspaceId });
      if (!record) return notFound("Truth record not found.");

      const source = body.source || "declared";
      if (!FACT_SOURCES[source]) {
        return bad(`Unknown fact source "${source}".`, { code: "INVALID_REQUEST" });
      }
      // 🔴 A CLIENT MAY NOT CLAIM `observed` OR `imported` HERE. Those two
      // carry a warranty that somebody could go and check, and this endpoint
      // has no evidence to attach — the audit pipeline does, and it writes
      // those facts itself. Accepting the claim from a request body would make
      // verifiability a flag anyone can set, which is the same defect as an
      // `?consented=true` query parameter.
      if (FACT_SOURCES[source].verifiable) {
        return bad(
          `Facts from "${source}" carry evidence and are written by the audit pipeline, not by this endpoint. Submit them as "declared" or "inferred".`,
          { code: "SOURCE_NOT_ACCEPTED" });
      }

      const { fields, rejected } = factsFromBody(body.fields, {
        source,
        statedBy: body.stated_by || userId,
        statedAt: new Date().toISOString(),
      });

      if (!Object.keys(fields).length) {
        return bad("No usable facts in the request.", { code: "INVALID_REQUEST", rejected });
      }

      const completeness = truthCompleteness(fields, { notApplicable: record.not_applicable || [] });
      const created = await store.createTruthVersion(userId, id, {
        fields,
        completeness: completeness.percent,
        origin: "manual", workspaceId,
      });
      if (created.conflict) {
        return json(409, {
          error: "Another version was proposed while this one was being written. Reload and re-apply your changes.",
          code: "VERSION_CONFLICT",
        });
      }
      if (!created.ok) {
        return created.notFound
          ? notFound("Truth record not found.")
          : json(500, { error: "Could not save the version.", detail: created.error });
      }
      // `rejected` is always reported, never silently dropped: a field the
      // caller sent and we did not store is the one thing they most need told.
      return json(201, { version: describeVersion(created.version), rejected });
    }

    if (subId && method === "GET") {
      const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
      if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
      const row = await store.getTruthVersion(userId, id, subId, { workspaceId });
      return row ? json(200, { version: describeVersion(row) }) : notFound("Version not found.");
    }

    // Verbs on one version.
    if (subId && method === "POST" && verb) {
      const row = await store.getTruthVersion(userId, id, subId, { workspaceId });
      if (!row) return notFound("Version not found.");

      if (verb === "promote") {
        const r = await store.promoteTruthVersion(userId, id, subId, {
          note: body.note || null, workspaceId,
        });
        if (r.ok) {
          const full = await store.getTruthRecordFull(userId, id, { workspaceId });
          return json(200, {
            promoted: true,
            record: full,
            canonical: describeVersion((full?.versions || []).find((v) => v.id === subId) || null),
          });
        }
        if (r.notFound) return notFound("Version not found.");
        // The function's verdict maps to a status code without re-deriving the
        // rule here — one place decides, one place explains.
        const VERDICTS = {
          self_approval: [403, "You proposed this version. Approval means a second person looked at it."],
          no_approver: [400, "No approver could be resolved for this request."],
          not_reviewable: [409, "This version is not awaiting review. Only a submitted version can be approved."],
          missing_required: [422, `A canonical record needs the facts that identify the business: ${REQUIRED_FOR_CANONICAL.map((f) => TRUTH_FIELDS[f].label).join(" and ")}.`],
          not_found: [404, "Version not found."],
        };
        const [status, message] = VERDICTS[r.verdict] || [500, "Could not promote the version."];
        return json(status, { error: message, code: (r.verdict || "error").toUpperCase() });
      }

      const TARGET = { submit: "pending_review", reject: "rejected", withdraw: "draft" };
      const next = TARGET[verb];
      if (!next) return notFound("Unknown endpoint.");

      if (!canTransition(row.state, next)) {
        return json(409, {
          error: `A ${(VERSION_STATES[row.state]?.label || row.state).toLowerCase()} version cannot move to ${(VERSION_STATES[next]?.label || next).toLowerCase()}.`,
          code: "INVALID_TRANSITION",
        });
      }

      const note = typeof body.note === "string" ? body.note.trim() : "";
      // A rejection with no reason is indistinguishable from a mis-click three
      // months later. Refused here, and again by a CHECK constraint.
      if (next === "rejected" && !note) {
        return bad("A rejection needs a reason. Three months from now it is the only thing that explains the decision.",
          { code: "REASON_REQUIRED" });
      }

      const r = await store.setTruthVersionState(userId, id, subId, next, {
        note: note || null, workspaceId,
      });
      if (!r.ok) {
        if (r.notFound) return notFound("Version not found.");
        if (r.refused) return json(409, { error: "Approval goes through promote, which carries the interlocks.", code: "USE_PROMOTE" });
        return json(500, { error: "Could not update the version.", detail: r.error });
      }
      return json(200, { version: describeVersion(r.version) });
    }

    return notFound("Unknown endpoint.");
  }

  // ── Diff ─────────────────────────────────────────────────────────────────
  if (sub === "diff" && method === "GET") {
    const q = event.queryStringParameters || {};
    const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
    if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
    const full = await store.getTruthRecordFull(userId, id, { workspaceId });
    if (!full) return notFound("Truth record not found.");

    const byId = new Map(full.versions.map((v) => [v.id, v]));
    const to = q.to ? byId.get(q.to) : full.versions[0];
    const from = q.from
      ? byId.get(q.from)
      : full.versions.find((v) => to && v.version_no === to.version_no - 1);

    if (!to) return notFound("Nothing to compare — this record has no versions.");
    if (!from) {
      // The first version has no predecessor, and saying so is more useful than
      // an empty diff that reads as "nothing changed".
      return json(200, {
        comparable: false,
        reason: "This is the first version of the record, so there is nothing to compare it against.",
        to: { id: to.id, version_no: to.version_no },
      });
    }

    return json(200, {
      comparable: true,
      from: { id: from.id, version_no: from.version_no, state: from.state },
      to: { id: to.id, version_no: to.version_no, state: to.state },
      diff: diffVersions({ fields: from.fields_json || {} }, { fields: to.fields_json || {} }),
    });
  }

  // ── Conflicts ────────────────────────────────────────────────────────────
  if (sub === "conflicts") {
    if (!subId && method === "GET") {
      const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
      if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
      const full = await store.getTruthRecordFull(userId, id, { workspaceId });
      if (!full) return notFound("Truth record not found.");
      return json(200, { conflicts: full.conflicts, count: full.conflicts.length });
    }
    if (subId && method === "POST") {
      const resolution = body.resolution;
      const ALLOWED = ["record_updated", "page_updated", "not_a_conflict"];
      if (!ALLOWED.includes(resolution)) {
        return bad(`Resolution must be one of: ${ALLOWED.join(", ")}.`, { code: "INVALID_REQUEST" });
      }
      const r = await store.resolveTruthConflict(userId, id, subId, resolution, { workspaceId });
      return r.ok ? json(200, { resolved: true }) : notFound("Conflict not found.");
    }
  }

  return notFound("Unknown endpoint.");
}

// ── /entity-graph — the Entity Graph Builder (W10) ─────────────────────────
//
// Routes:
//   GET    /entity-graph/schema                    types, predicates, states
//   GET    /entity-graph?truth_record_id=          the graph, with its conflicts
//   POST   /entity-graph/entities                  propose an entity
//   POST   /entity-graph/entities/:id/reject       reason required
//   POST   /entity-graph/relationships             propose a relationship
//   POST   /entity-graph/relationships/:id/approve approve it AND its endpoints
//   POST   /entity-graph/relationships/:id/reject  reason required
//   GET    /entity-graph/conflicts
//   POST   /entity-graph/conflicts/:id/resolve
//
// 🔴 THERE IS NO ROUTE THAT CREATES AN APPROVED ROW, and no PATCH that reaches
// `approved`. Approval is one verb going through one SQL function, because
// approving an edge also approves its endpoints — an approved edge between two
// unreviewed nodes is a half-built statement.

async function entityGraphRoute(userId, method, path, body, event) {
  const workspaceId = body.workspace_id || event.queryStringParameters?.workspace_id || null;
  // W14/D9. Writes are gated; reads are not — refusing to show a customer the
  // record they already own is taking away something they were given, which is
  // a different act from declining to create more.
  if (method !== "GET") {
    const approving = path.includes("approve") || path.includes("reject") || path.includes("resolve");
    const gate = await gateP2Capability(
      event, "audit.entity_graph", workspaceId,
      approving ? "approve_changes" : "propose_changes",
    );
    if (!gate.ok) return gate.response;
  }
  const [, section, id, verb] = path;

  if (section === "schema" && method === "GET") {
    return json(200, {
      entity_types: ENTITY_TYPE_IDS.map((t) => ({ ...ENTITY_TYPES[t] })),
      identifying_types: IDENTIFYING_TYPES,
      predicates: PREDICATE_IDS.map((p) => ({ ...PREDICATES[p] })),
      sources: Object.values(RELATION_SOURCES),
      review_states: Object.values(REVIEW_STATES),
      conflict_codes: Object.values(GRAPH_CONFLICT_CODES),
    });
  }

  // ── The graph ────────────────────────────────────────────────────────────
  if (!section && method === "GET") {
    const q = event.queryStringParameters || {};
    const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
    if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
    const truthRecordId = q.truth_record_id || null;
    const [entities, relationships, conflicts] = await Promise.all([
      store.listEntities(userId, { truthRecordId, workspaceId }),
      store.listRelationships(userId, { workspaceId }),
      store.listGraphConflicts(userId, { truthRecordId, workspaceId }),
    ]);

    // Coverage is computed from the rows, in the pure model, so the number the
    // UI shows and the number a report would print come from one implementation.
    const asModel = entities.map((e) => ({
      id: e.id, type: e.entity_type, name: e.name, source: e.source,
      stated_at: e.created_at,
    }));
    const relModel = toRelationModels(relationships, entities);

    return json(200, {
      entities,
      relationships,
      conflicts,
      coverage: graphCoverage(asModel, relModel),
      pending: {
        entities: entities.filter((e) => e.state === "proposed").length,
        relationships: relationships.filter((r) => r.state === "proposed").length,
      },
    });
  }

  // ── Entities ─────────────────────────────────────────────────────────────
  if (section === "entities") {
    if (!id && method === "POST") {
      const entityType = body.entity_type;
      if (!ENTITY_TYPES[entityType]) {
        return bad(`Unknown entity type "${entityType}".`, { code: "INVALID_REQUEST", allowed: ENTITY_TYPE_IDS });
      }
      const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
      // An unnamed node resolves nothing, which is the only job an entity has.
      if (!name) return bad("An entity needs a name.", { code: "INVALID_REQUEST" });

      const source = body.source || "declared";
      if (!RELATION_SOURCES[source]) {
        return bad(`Unknown source "${source}".`, { code: "INVALID_REQUEST" });
      }
      // Same rule as the truth record: a client may not claim a provenance it
      // has no evidence for. `observed` is written by the audit pipeline.
      if (RELATION_SOURCES[source].verifiable) {
        return bad(
          `Entities from "${source}" carry evidence and are written by the audit pipeline, not by this endpoint. Submit them as "declared" or "inferred".`,
          { code: "SOURCE_NOT_ACCEPTED" });
      }

      const created = await store.createEntity(userId, {
        entityType, name,
        description: body.description || null,
        canonicalDomain: normalizeFieldValue("canonical_domain", body.canonical_domain),
        externalIds: body.external_ids || null,
        source,
        truthRecordId: body.truth_record_id || null,
        workspaceId: body.workspace_id || null,
      });
      return created.ok
        ? json(201, { entity: created.entity })
        : json(500, { error: "Could not create the entity.", detail: created.error });
    }

    if (id && verb === "reject" && method === "POST") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return bad("A rejection needs a reason. A rejected entity that keeps being re-proposed is itself a finding, and without the reason nobody can tell a decision from a mis-click.",
          { code: "REASON_REQUIRED" });
      }
      const r = await store.rejectGraphRow(userId, "entity", id, reason, { workspaceId });
      return r.ok ? json(200, { entity: r.row }) : notFound("Entity not found.");
    }

    return notFound("Unknown endpoint.");
  }

  // ── Relationships ────────────────────────────────────────────────────────
  if (section === "relationships") {
    if (!id && method === "POST") {
      const { subject_id: subjectId, object_id: objectId, predicate } = body;
      if (!subjectId || !objectId) return bad("A relationship needs both endpoints.", { code: "INVALID_REQUEST" });
      if (!PREDICATES[predicate]) {
        return bad(`Unknown predicate "${predicate}".`, { code: "INVALID_REQUEST", allowed: PREDICATE_IDS });
      }
      // A self-edge is vacuously true and pollutes every traversal.
      if (subjectId === objectId) {
        return bad("A relationship from an entity to itself carries no information.", { code: "SELF_EDGE" });
      }

      const source = body.source || "declared";
      if (!RELATION_SOURCES[source]) return bad(`Unknown source "${source}".`, { code: "INVALID_REQUEST" });
      if (RELATION_SOURCES[source].verifiable) {
        return bad(
          `Relationships from "${source}" carry evidence and are written by the audit pipeline, not by this endpoint. Submit them as "declared" or "inferred".`,
          { code: "SOURCE_NOT_ACCEPTED" });
      }

      // 🔴 THE SHAPE IS CHECKED AGAINST REAL ROWS, not against types the client
      // supplied. A caller that could name its own endpoint types could declare
      // any edge legal, and the domain/range rules would enforce nothing.
      const [subject, object] = await Promise.all([
        store.getEntity(userId, subjectId, { workspaceId }),
        store.getEntity(userId, objectId, { workspaceId }),
      ]);
      if (!subject || !object) return notFound("One or both entities were not found.");

      const shape = validateRelation({
        subjectType: subject.entity_type, predicate, objectType: object.entity_type,
      });
      if (!shape.ok) {
        return json(422, {
          error: shape.problems[0]?.message || "These endpoints do not fit this relationship.",
          code: "INVALID_RELATIONSHIP",
          problems: shape.problems,
        });
      }

      const created = await store.createRelationship(userId, {
        subjectId, predicate, objectId, source, note: body.note || null, workspaceId,
      });
      if (created.duplicate) {
        // 🔴 THIS SENTENCE USED TO BE FALSE. The route said "re-observing one
        // corroborates it" and corroborated nothing: `recordEntityEvidence`
        // was written for exactly this and called by NOTHING, so
        // `audit_entity_evidence` was empty for the life of the module —
        // the fourth time this schema has declared storage and never written
        // to it. 0056's own header says why the table exists: "we read this
        // once in 2024" and "we have read this on six pages across nine
        // months" are different warranties on the same edge.
        //
        // ⚠️ Still 409, and still no new row: nothing was created, and the
        // status code is a public contract `/api/v1` holders read. What
        // changed is that the body now reports what actually happened, so a
        // caller can tell a recorded sighting from a lost one.
        const criteria = { subjectId, predicate, objectId };
        if (workspaceId) criteria.workspaceId = workspaceId;
        const existing = await store.findRelationship(userId, criteria);
        let corroborated = false;
        if (existing) {
          const ev = await store.recordEntityEvidence({
            relationshipId: existing.id,
            auditId: body.source_audit_id || null,
            evidence: body.evidence || null,
            confidence: body.confidence ?? null,
          });
          corroborated = Boolean(ev.ok);
        }
        return json(409, {
          error: "That relationship already exists. Re-observing one corroborates it rather than adding a second copy.",
          code: "RELATIONSHIP_EXISTS",
          corroborated,
          relationship: existing || null,
        });
      }
      return created.ok
        ? json(201, { relationship: created.relationship })
        : json(500, { error: "Could not create the relationship.", detail: created.error });
    }

    if (id && method === "POST" && verb === "approve") {
      const r = await store.approveEntityRelationship(userId, id, {
        note: body.note || null, workspaceId,
      });
      if (r.ok) {
        const relationship = await store.getRelationship(userId, id, { workspaceId });
        // The approved graph just changed, so its conflicts just changed.
        const sweep = await refreshGraphConflicts(userId, body.truth_record_id || null, workspaceId);
        return json(200, { approved: true, relationship, conflicts: sweep });
      }
      if (r.notFound) return notFound("Relationship not found.");
      const VERDICTS = {
        self_approval: [403, "You proposed this relationship. Approval means a second person looked."],
        no_approver: [400, "No approver could be resolved for this request."],
        rejected: [409, "This relationship was rejected. Propose it again rather than reviving the rejection."],
        endpoint_rejected: [409, "One of the entities this connects was rejected. Approving the edge would silently revive it."],
        not_found: [404, "Relationship not found."],
      };
      const [status, message] = VERDICTS[r.verdict] || [500, "Could not approve the relationship."];
      return json(status, { error: message, code: (r.verdict || "error").toUpperCase() });
    }

    if (id && method === "POST" && verb === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) return bad("A rejection needs a reason.", { code: "REASON_REQUIRED" });
      const r = await store.rejectGraphRow(userId, "relationship", id, reason, { workspaceId });
      return r.ok ? json(200, { relationship: r.row }) : notFound("Relationship not found.");
    }

    return notFound("Unknown endpoint.");
  }

  // ── Conflicts ────────────────────────────────────────────────────────────
  if (section === "conflicts") {
    if (!id && method === "GET") {
      const q = event.queryStringParameters || {};
      const readGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
      if (!readGate.ok) return json(403, { error: readGate.refusal.message, code: readGate.refusal.code });
      const conflicts = await store.listGraphConflicts(userId, {
        truthRecordId: q.truth_record_id || null, workspaceId,
      });
      return json(200, { conflicts, count: conflicts.length });
    }
    if (id && method === "POST" && verb === "resolve") {
      const ALLOWED = ["relationship_removed", "relationship_corrected", "entity_merged", "not_a_conflict"];
      if (!ALLOWED.includes(body.resolution)) {
        return bad(`Resolution must be one of: ${ALLOWED.join(", ")}.`, { code: "INVALID_REQUEST" });
      }
      const r = await store.resolveGraphConflict(userId, id, body.resolution, { workspaceId });
      return r.ok ? json(200, { resolved: true }) : notFound("Conflict not found.");
    }
    return notFound("Unknown endpoint.");
  }

  return notFound("Unknown endpoint.");
}

/**
 * Stored relationship rows in the shape the pure model expects.
 *
 * 🔴 THE ENDPOINT TYPES ARE JOINED FROM THE ENTITIES, NOT STORED ON THE EDGE.
 * Denormalising them onto the relationship row would be a second copy of a fact
 * that already has an owner, and the two would drift the first time an entity
 * was re-typed — after which `EG-03` and `EG-04` would be checking against a
 * type nobody holds any more. The cost is one lookup; the alternative is a
 * graph that disagrees with itself about what its own nodes are.
 */
function toRelationModels(rows, entities) {
  const typeOf = new Map(entities.map((e) => [e.id, e.entity_type]));
  return rows.map((row) => ({
    subject_id: row.subject_id,
    subject_type: typeOf.get(row.subject_id) || null,
    predicate: row.predicate,
    object_id: row.object_id,
    object_type: typeOf.get(row.object_id) || null,
    state: row.state,
    source: row.source,
    evidence: row.evidence_json || null,
    confidence: row.confidence,
    stated_at: row.created_at,
    _id: row.id,
  }));
}

/**
 * Recompute the approved graph's conflicts and store the ones that are new.
 *
 * 🔴 RUN ON APPROVAL, BECAUSE THAT IS WHEN THE APPROVED GRAPH CHANGES. A
 * conflict table nothing writes is the failure pattern this repo has already
 * shipped three times — a column declared, merged, and NULL for the life of the
 * module, invisible because the read path returns null exactly as it would for
 * "not applicable".
 *
 * ⚠️ ALREADY-OPEN CONFLICTS ARE NOT RE-WRITTEN. Re-approving anything would
 * otherwise pile up duplicate rows for one unchanged problem, and a queue that
 * grows while nothing gets worse is a queue people stop reading.
 *
 * ⚠️ AND IT NEVER FAILS THE APPROVAL. The edge was approved; a conflict sweep
 * that cannot write is not a reason to tell the user their approval failed.
 */
async function refreshGraphConflicts(userId, truthRecordId = null, workspaceId = null) {
  try {
    const [entities, relationships, open] = await Promise.all([
      store.listEntities(userId, { truthRecordId, workspaceId }),
      store.listRelationships(userId, { workspaceId }),
      store.listGraphConflicts(userId, { truthRecordId, workspaceId }),
    ]);

    const entityModels = entities.map((e) => ({
      id: e.id, type: e.entity_type, name: e.name, source: e.source,
      stated_at: e.created_at,
    }));
    const found = detectGraphConflicts(entityModels, toRelationModels(relationships, entities));

    const byId = new Map(entities.map((e) => [e.id, e]));
    const seen = new Set(open.map((c) => `${c.code}::${c.subject_id || ""}::${c.predicate || ""}`));
    const fresh = found
      .filter((c) => !seen.has(`${c.code}::${c.subject_id || ""}::${c.predicate || ""}`))
      .map((c) => ({
        ...c,
        // Only a real entity id reaches the foreign key. A conflict whose
        // subject is not a row we hold still gets recorded, with a null
        // subject, rather than failing the whole batch.
        subject_entity_id: byId.has(c.subject_id) ? c.subject_id : null,
      }));

    if (fresh.length) {
      await store.recordGraphConflicts(userId, truthRecordId, null, fresh, { workspaceId });
    }
    return { found: found.length, recorded: fresh.length };
  } catch {
    return null;
  }
}

// ── /local-directory — Local and Directory Intelligence (W12) ──────────────
//
//   GET    /local-directory/schema                     tiers, sources, LD codes
//   GET    /local-directory/listings?truth_record_id=   what each source says
//   POST   /local-directory/listings                    record an observation
//   DELETE /local-directory/listings/{id}
//   POST   /local-directory/check                       run a NAP check and STORE it
//   GET    /local-directory/checks?truth_record_id=     history
//   GET    /local-directory/checks/{id}                 one check, with its matches
//   POST   /local-directory/findings/{id}/resolve
//   POST   /local-directory/radius                      build service-area queries
//
// ⚠️ `acquisition` IS NOT ACCEPTED FROM THE CLIENT AS `authorized_api`.
// The fidelity of an observation is a claim about HOW it was obtained, and a
// claim a request body can set is not a claim — it is the `?consented=true`
// defect wearing a third hat. A client may record `declared_url` or
// `public_listing`; an API-sourced listing can only be written by the connector
// that actually held the customer's token.
const CLIENT_ACQUISITION = new Set(["declared_url", "public_listing"]);

/**
 * Every caller-supplied reference on a W12 request, checked against rows the
 * caller actually owns.
 *
 * ⚠️ The refusal is 404, never 403 — the same choice `invoice-pdf.js` makes and
 * for the same reason: a 403 confirms the id exists, which turns the endpoint
 * into an enumeration oracle over other tenants' uuids. "Not found" is true
 * from where the caller stands.
 *
 * ⚠️ `workspace_id` goes through `buildWorkspaceCtx`, not through a store read,
 * because membership is not ownership — the check is "are you in it", and that
 * helper is the one place this file asks.
 */
async function requireLocalRefs(userId, body) {
  const { refusal: wsRefusal } = await buildWorkspaceCtx({ userId }, body.workspace_id);
  if (wsRefusal) return { refusal: json(403, { error: wsRefusal.message, code: wsRefusal.code }) };

  if (body.truth_record_id) {
    const rec = await (body.workspace_id
      ? store.getTruthRecord(userId, body.truth_record_id, { workspaceId: body.workspace_id })
      : store.getTruthRecord(userId, body.truth_record_id));
    if (!rec) return { refusal: notFound("Business truth record not found.") };
  }
  if (body.subject_id) {
    const subj = await (body.workspace_id
      ? store.getSubject(userId, body.subject_id, { workspaceId: body.workspace_id })
      : store.getSubject(userId, body.subject_id));
    if (!subj) return { refusal: notFound("Subject not found.") };
  }
  return { refusal: null };
}

/**
 * P2 · W13 — schema intelligence and trust & proof.
 *
 * 🔴 `independence` IS DERIVED, NEVER ACCEPTED. It is the field the entire
 * trust model rests on: it decides whether a claim is worth 25% or 100%, so a
 * client that could set it could mint third-party standing for its own
 * testimonials. The route resolves it from what the request actually
 * demonstrates — a checkable source URL — which is the same rule W12 applies
 * to `acquisition: "authorized_api"` and W9 applies to `observed`/`imported`.
 */
/**
 * P2 · W11's result surface — the one W13's step 5 asked for.
 *
 * 🔴 W11 SHIPPED A COMPLETE SCORING MODEL THAT NOTHING IMPORTED. That was
 * recorded as deliberate and it was: it needed a subject model (D7) and two
 * components that did not exist (TC and TP, both W13). `0057` and `0062` removed
 * both blockers, so the deferral expired — and a module called by nothing is
 * this repository's own documented failure mode, four times in this schema
 * alone. It is not the fifth.
 *
 * ⚠️ THE SCORE IS COMPUTED HERE AND STORED; IT IS NEVER SUPPLIED BY A CLIENT.
 * A caller-supplied score is not a measurement, it is a number somebody typed —
 * the same reason `acquisition: "authorized_api"` and `independence` are both
 * refused from a request body. Component VALUES are inputs and may be sent;
 * the score, coverage, and model version are ours.
 */
async function subjectScoreRoute(userId, method, path, body, event) {
  // W14/D9. Writes are gated; reads are not — refusing to show a customer the
  // record they already own is taking away something they were given, which is
  // a different act from declining to create more.
  if (method !== "GET") {
    const gate = await gateP2Capability(event, "audit.subject_score", body.workspace_id);
    if (!gate.ok) return gate.response;
  }
  const [, section] = path;
  const q = event.queryStringParameters || {};
  const workspaceId = method === "GET" ? q.workspace_id || null : body.workspace_id || null;
  if (method === "GET" && workspaceId) {
    const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
    if (!roleGate.ok) {
      return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
    }
  }

  // The registry, so a client renders the same component names and weights the
  // server scores with rather than keeping a copy that drifts.
  if (section === "registry" && method === "GET") {
    return json(200, {
      model_version: SUBJECT_MODEL_VERSION,
      thin_coverage: THIN_COVERAGE,
      scores: SUBJECT_SCORE_IDS.map((id) => ({
        id,
        code: SUBJECT_SCORES[id].code,
        label: SUBJECT_SCORES[id].label,
        components: Object.entries(SUBJECT_SCORES[id].components)
          .map(([cid, c]) => ({ id: cid, ...c })),
      })),
    });
  }

  // Service intent coverage — excluded intents are NAMED, never counted as
  // gaps. An intent nobody sampled is not an intent you lost.
  if (section === "intent-coverage" && method === "POST") {
    return json(200, intentCoverage(Array.isArray(body.intents) ? body.intents : []));
  }

  if (section === "subjects" && method === "POST") {
    if (!body.entity_id || !body.subject_kind) {
      return bad("`entity_id` and `subject_kind` are required.");
    }
    const entity = await store.getEntity(userId, body.entity_id, {
      workspaceId: body.workspace_id || null,
    });
    if (!entity) return notFound("Entity not found.");
    const allowed = canCreateEntitySubject(entity, body.subject_kind);
    if (!allowed.ok) {
      return json(entity.state === "approved" ? 422 : 409, {
        error: allowed.reason,
        code: entity.state === "approved" ? "SUBJECT_KIND_MISMATCH" : "ENTITY_NOT_APPROVED",
      });
    }
    const subjectId = await store.ensureSubject(userId, {
      kind: body.subject_kind,
      entityId: entity.id,
      label: entity.name,
      canonicalDomain: entity.canonical_domain,
      workspaceId: entity.workspace_id || null,
    });
    if (!subjectId) return json(502, { error: "Could not create the subject." });
    const subject = await store.getSubject(userId, subjectId, {
      workspaceId: entity.workspace_id || null,
    });
    return json(201, { subject });
  }

  if (section === "scores") {
    if (method === "GET") {
      const rows = await store.listSubjectScores(userId, {
        subjectId: q.subject_id || null,
        workspaceId,
      });
      return json(200, { scores: rows, count: rows.length });
    }

    if (method === "POST") {
      if (!body.subject_id) return bad("`subject_id` is required — a score with no subject is not a score.");

      const ref = await requireSubjectScoreRefs(userId, body);
      if (ref.refusal) return ref.refusal;

      // ⚠️ THE KIND COMES FROM THE STORED SUBJECT, NOT THE REQUEST. A body that
      // could name its own kind would let a page be filed with a brand score,
      // which is the category error the CHECK constraint refuses one layer down
      // — and the two must not disagree about who decides.
      const scoreId = scoreIdFor(ref.subject.subject_kind);
      if (!scoreId) {
        return bad(
          `A ${ref.subject.subject_kind} subject has no single-number formula. `
          + `Scorable kinds are: ${SUBJECT_SCORE_IDS.join(", ")}.`);
      }

      const values = (body.components && typeof body.components === "object") ? body.components : {};
      const result = scoreSubject(scoreId, values);
      if (!result) return bad("Could not score this subject.");

      // 🔴 THE WRITE. Declared-and-never-written is this schema's own recorded
      // failure mode; the contract test asserts this call, confirmed RED first.
      const saved = await store.saveSubjectScore(userId, {
        subjectId: body.subject_id,
        auditId: body.audit_id || null,
        workspaceId: body.workspace_id || null,
        result,
      });
      if (!saved.ok) return json(502, { error: "Could not record the subject score." });

      return json(201, {
        score: saved.score,
        result,
        // Reported beside the score rather than left for the reader to derive:
        // a number built from half its formula is a different number, and the
        // caveat does not travel with a screenshot.
        thin: isThin(result),
        missing_facts: missingFacts(result),
      });
    }
  }

  return notFound("Unknown subject-score endpoint.");
}

/**
 * ⚠️ A PARENT ID IN A REQUEST BODY IS A CLAIM, NOT A FACT — the rule W12 shipped
 * without and `requireLocalRefs` exists for. Refused 404, never 403: a 403
 * confirms the row exists and makes the endpoint an enumeration oracle over
 * other tenants' uuids.
 */
async function requireSubjectScoreRefs(userId, body) {
  const { refusal: wsRefusal } = await buildWorkspaceCtx({ userId }, body.workspace_id);
  if (wsRefusal) return { refusal: json(403, { error: wsRefusal.message, code: wsRefusal.code }) };

  const subject = await (body.workspace_id
    ? store.getSubject(userId, body.subject_id, { workspaceId: body.workspace_id })
    : store.getSubject(userId, body.subject_id));
  if (!subject) return { refusal: notFound("Subject not found.") };

  if (body.audit_id) {
    const audit = await store.getAudit(userId, body.audit_id);
    if (!audit) return { refusal: notFound("Audit not found.") };
  }
  return { refusal: null, subject };
}

async function schemaTrustRoute(userId, method, path, body, event) {
  // W14/D9. Writes are gated; reads are not — refusing to show a customer the
  // record they already own is taking away something they were given, which is
  // a different act from declining to create more.
  if (method !== "GET") {
    const gate = await gateP2Capability(event, "audit.schema_trust", body.workspace_id);
    if (!gate.ok) return gate.response;
  }
  const [, section] = path;
  const q = event.queryStringParameters || {};
  const workspaceId = method === "GET" ? q.workspace_id || null : body.workspace_id || null;
  if (method === "GET" && workspaceId) {
    const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
    if (!roleGate.ok) {
      return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
    }
  }

  if (section === "schema-registry" && method === "GET") {
    return json(200, {
      approved_types: APPROVED_TYPE_IDS.map((t) => ({ ...APPROVED_TYPES[t] })),
      excluded_types: EXCLUDED_TYPES,
      components: SCHEMA_COMPONENT_IDS.map((id) => ({ ...SCHEMA_COMPONENTS[id] })),
      trust_signals: TRUST_SIGNAL_IDS.map((id) => ({ ...TRUST_SIGNALS[id] })),
      independence: Object.values(INDEPENDENCE),
      tc_components: TC_COMPONENT_IDS.map((id) => ({ ...TC_COMPONENTS[id] })),
    });
  }

  // ── Schema observations ──────────────────────────────────────────────────
  if (section === "schema") {
    if (method === "GET") {
      const rows = await store.listSchemaEntities(userId, {
        subjectId: q.subject_id || null,
        workspaceId,
      });
      return json(200, { entities: rows, count: rows.length });
    }

    if (method === "POST") {
      const ref = await requireSchemaTrustRefs(userId, body);
      if (ref.refusal) return ref.refusal;

      const blocks = Array.isArray(body.json_ld) ? body.json_ld : [];
      if (blocks.length === 0 && !body.schema_type) {
        return bad("Supply either `json_ld` blocks to validate, or a `schema_type` to record.");
      }

      const scored = schemaScore({
        jsonLd: blocks,
        microdata: Array.isArray(body.microdata) ? body.microdata : [],
        pageType: body.page_type || null,
        visibleFaq: numOrNullBody(body.visible_faq),
        visibleSteps: numOrNullBody(body.visible_steps),
        canonicalDomain: body.canonical_domain || null,
        parseFailures: Number(body.parse_failures) || 0,
      });

      // 🔴 THE WRITE. Declared-and-never-written is this schema's own recorded
      // failure mode, four times over; the contract test asserts this call.
      const saved = [];
      for (const b of scored.blocks) {
        const r = await store.saveSchemaEntity(userId, {
          subjectId: body.subject_id || null,
          auditId: body.audit_id || null,
          workspaceId: body.workspace_id || null,
          schemaType: b.type,
          validity: b.valid ? "valid" : "incomplete",
          missingProperties: b.missing,
          componentScores: Object.fromEntries(scored.components.map((c) => [c.id, c.value])),
        });
        if (r.ok) saved.push(r.entity);
      }

      return json(201, {
        schema: scored,
        gaps: schemaGaps(scored),
        persisted: saved.length,
      });
    }
  }

  // ── Trust observations ───────────────────────────────────────────────────
  if (section === "trust") {
    if (method === "GET") {
      const rows = await store.listTrustObservations(userId, {
        subjectId: q.subject_id || null,
        workspaceId,
      });
      const kind = q.kind || "brand";
      const bySignal = {};
      for (const row of rows) {
        (bySignal[row.signal] ||= []).push({
          signal: row.signal,
          independence: row.independence,
          count: row.observed_count,
          verifiable: row.verifiable,
        });
      }
      const scored = trustScore(kind, bySignal);
      return json(200, {
        observations: rows,
        count: rows.length,
        trust: scored,
        tc: kind === "brand" ? tcScore(bySignal) : null,
        gaps: scored ? trustGaps(scored) : [],
      });
    }

    if (method === "POST") {
      const ref = await requireSchemaTrustRefs(userId, body);
      if (ref.refusal) return ref.refusal;

      const signal = String(body.signal || "").trim();
      if (!TRUST_SIGNALS[signal]) {
        return bad(`Unknown trust signal: ${signal || "(none)"}.`);
      }

      // 🔴 REFUSED FROM THE BODY. Provenance is a claim about who holds the
      // evidence; a claim the measured party can set is not a claim.
      if (body.independence) {
        return bad(
          "`independence` is derived from the evidence, not supplied. An observation with a "
          + "checkable source URL is recorded as independent; one without is recorded as a claim "
          + "about an independent record.");
      }

      const sourceUrl = typeof body.source_url === "string" ? body.source_url.trim() : "";
      // The route states WHAT it saw; `makeObservation` decides what that is
      // worth, and demotes an unsourced independent claim rather than refusing
      // it — so there is exactly one place the rule lives.
      const observation = makeObservation({
        signal,
        independence: sourceUrl ? "third_party" : "self_published",
        count: Number(body.observed_count) || 0,
        verifiable: Boolean(sourceUrl) && body.verifiable !== false,
        sourceUrl: sourceUrl || null,
        excerpt: body.excerpt || null,
      });
      if (!observation) return bad("That observation could not be recorded.");

      const saved = await store.saveTrustObservation(userId, {
        subjectId: body.subject_id || null,
        auditId: body.audit_id || null,
        workspaceId: body.workspace_id || null,
        signal: observation.signal,
        independence: observation.independence,
        observedCount: observation.count,
        verifiable: observation.verifiable,
        sourceUrl: sourceUrl || null,
        evidence: observation.evidence,
      });
      if (!saved.ok) {
        return json(503, { error: "Could not record the observation.", code: "STORAGE_UNAVAILABLE", detail: saved.error });
      }
      return json(201, { observation: saved.observation });
    }
  }

  return notFound("Unknown schema-trust endpoint.");
}

/** A number from a request body, or null — never 0 for an absent key. */
function numOrNullBody(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The W13 equivalent of `requireLocalRefs` — a parent id in a request body is
 * a claim, not a fact. 404 rather than 403, so the endpoint is not an
 * enumeration oracle over other tenants' uuids.
 */
async function requireSchemaTrustRefs(userId, body) {
  const { refusal: wsRefusal } = await buildWorkspaceCtx({ userId }, body.workspace_id);
  if (wsRefusal) return { refusal: json(403, { error: wsRefusal.message, code: wsRefusal.code }) };

  if (body.subject_id) {
    const subj = await (body.workspace_id
      ? store.getSubject(userId, body.subject_id, { workspaceId: body.workspace_id })
      : store.getSubject(userId, body.subject_id));
    if (!subj) return { refusal: notFound("Subject not found.") };
  }
  if (body.audit_id) {
    const audit = await store.getAudit(userId, body.audit_id);
    if (!audit) return { refusal: notFound("Audit not found.") };
  }
  return { refusal: null };
}

async function localDirectoryRoute(userId, method, path, body, event) {
  // W14/D9. Writes are gated; reads are not — refusing to show a customer the
  // record they already own is taking away something they were given, which is
  // a different act from declining to create more.
  if (method !== "GET") {
    const gate = await gateP2Capability(event, "audit.local_directory", body.workspace_id);
    if (!gate.ok) return gate.response;
  }
  const [, section, id, verb] = path;
  const q = event.queryStringParameters || {};
  const workspaceId = method === "GET" ? q.workspace_id || null : body.workspace_id || null;
  if (method === "GET" && workspaceId) {
    const roleGate = await requireWorkspaceDiscoverabilityAction(userId, workspaceId, "read");
    if (!roleGate.ok) {
      return json(403, { error: roleGate.refusal.message, code: roleGate.refusal.code });
    }
  }

  if (section === "schema" && method === "GET") {
    return json(200, {
      tiers: TIER_IDS.map((t) => ({ ...SOURCE_TIERS[t] })),
      acquisition: Object.values(ACQUISITION),
      sources: DIRECTORY_SOURCES.map((src) => ({ ...src, unlock: unlockAction(src.id) })),
      nap_fields: NAP_FIELD_IDS.map((f) => ({ ...NAP_FIELDS[f] })),
      match_states: Object.values(MATCH_STATES),
      finding_codes: Object.values(LOCAL_FINDING_CODES),
    });
  }

  // ── Listings ─────────────────────────────────────────────────────────────
  if (section === "listings") {
    if (method === "GET") {
      const rows = await store.listDirectoryListings(userId, {
        truthRecordId: q.truth_record_id || null,
        workspaceId,
      });
      return json(200, {
        listings: rows,
        count: rows.length,
        // The honest sentence, built in one place so it cannot drift into
        // marketing copy in a stronger form. See D5.
        coverage_claim: coverageClaim({ checked: rows.length, region: q.region || null }),
      });
    }

    if (method === "POST") {
      const sourceId = String(body.source_id || "").trim();
      const source = SOURCE_BY_ID[sourceId];
      if (!source) return bad(`Unknown directory source: ${sourceId || "(none)"}.`);

      const acquisition = String(body.acquisition || source.acquisition);
      if (!CLIENT_ACQUISITION.has(acquisition)) {
        return bad(
          "A listing recorded through this endpoint is either a declared URL or a public listing. " +
          "An authorised-API observation can only be written by the connector that held the token.");
      }
      if (!body.listing_url) return bad("A listing URL is required — an observation nobody can go and check is not evidence.");

      // 🔴 A PARENT ID FROM A REQUEST BODY IS A CLAIM, NOT A FACT — the same
      // rule W9 applies before creating a truth record and W10 applies before
      // drawing an edge. W12 shipped without either check, so a caller could
      // attach its own listing to ANOTHER TENANT'S truth record: the row would
      // carry the attacker's user_id and the victim's foreign key, and every
      // later join over that record would read a row its owner never wrote.
      const ref = await requireLocalRefs(userId, body);
      if (ref.refusal) return ref.refusal;

      const saved = await store.upsertDirectoryListing(userId, {
        truthRecordId: body.truth_record_id || null,
        sourceId, sourceTier: source.tier, acquisition,
        listingUrl: body.listing_url,
        observedName: body.observed_name || null,
        observedAddress: body.observed_address || null,
        observedPhone: body.observed_phone || null,
        observedPostalCode: body.observed_postal_code || null,
        observedLocality: body.observed_locality || null,
        observedExtra: body.observed_extra || null,
        evidence: body.evidence || null,
        workspaceId: body.workspace_id || null,
      });
      if (!saved.ok) return json(503, { error: "Could not record the listing.", code: "STORAGE_UNAVAILABLE", detail: saved.error });
      return json(201, { listing: saved.listing });
    }

    if (method === "DELETE" && id) {
      const r = await store.deleteDirectoryListing(userId, id, {
        workspaceId: body.workspace_id || null,
      });
      if (r.notFound) return notFound("Listing not found.");
      return json(200, { deleted: true });
    }
  }

  // ── Run a check ──────────────────────────────────────────────────────────
  if (section === "check" && method === "POST") {
    const truthRecordId = body.truth_record_id || null;
    const canonical = body.canonical && typeof body.canonical === "object" ? body.canonical : {};
    const region = body.region || null;

    // Same reasoning as the listings POST above, and `subject_id` as well: a
    // check filed against a subject the caller does not own would put their
    // local score on somebody else's brand.
    const ref = await requireLocalRefs(userId, body);
    if (ref.refusal) return ref.refusal;

    const listings = await store.listDirectoryListings(userId, {
      truthRecordId,
      workspaceId: body.workspace_id || null,
    });
    const configured = (region ? sourcesForRegion(region) : DIRECTORY_SOURCES).map((src) => src.id);

    const matches = listings
      .map((l) => {
        const m = matchDirectory(l.source_id, canonical, {
          name: l.observed_name, address: l.observed_address,
          phone: l.observed_phone, postal_code: l.observed_postal_code,
        }, { country: body.country || "IN" });
        // `matchDirectory` returns null for a source the registry no longer
        // declares — a source can be retired, and scoring a row whose weighting
        // nothing declares would be scoring against a number nobody chose.
        // ⚠️ This is the ONLY place that drop happens. An earlier draft also
        // pre-filtered on SOURCE_BY_ID, which made the test covering it pass
        // against a broken model: two guards, one assertion, and the assertion
        // was pinned to the redundant one.
        return m ? { ...m, listingId: l.id } : null;
      })
      .filter(Boolean);

    const score = napScore(matches, configured);
    const findings = localFindings(matches, {
      canonical,
      // LD-04 is raised only for a TOP-tier source with no listing at all —
      // absence low down the tiers is ordinary and saying so would bury the
      // one absence that matters.
      uncheckedTopTier: score.unchecked,
    });

    // 🔴 THE WRITE. Declared-and-never-written is this schema's own recorded
    // failure mode, three times over. The contract test asserts this call.
    const saved = await store.saveLocalCheck(userId, {
      truthRecordId, subjectId: body.subject_id || null,
      workspaceId: body.workspace_id || null, region, score, matches, findings,
    });

    return json(saved.ok ? 201 : 200, {
      check: saved.check || null,
      persisted: Boolean(saved.ok),
      score, matches, findings,
      coverage_claim: coverageClaim({ checked: score.checkedCount, region }),
      corrections: matches
        .filter((m) => m.mismatches.length > 0)
        .map((m) => correctionPack(m.sourceId, canonical, m)),
      ...(saved.ok ? {} : { warning: "The check ran but could not be stored.", detail: saved.error }),
    });
  }

  // ── History ──────────────────────────────────────────────────────────────
  if (section === "checks" && method === "GET") {
    if (id) {
      const full = await store.getLocalCheckFull(userId, id, { workspaceId });
      if (!full) return notFound("Check not found.");
      return json(200, full);
    }
    const rows = await store.listLocalChecks(userId, {
      truthRecordId: q.truth_record_id || null, subjectId: q.subject_id || null,
      workspaceId,
    });
    return json(200, { checks: rows, count: rows.length });
  }

  // ── Resolve a finding ────────────────────────────────────────────────────
  if (section === "findings" && id && verb === "resolve" && method === "POST") {
    const resolution = String(body.resolution || "");
    if (!LOCAL_RESOLUTIONS.includes(resolution)) {
      return bad(`Resolution must be one of: ${LOCAL_RESOLUTIONS.join(", ")}.`);
    }
    const r = await store.resolveLocalFinding(userId, id, resolution, {
      workspaceId: body.workspace_id || null,
    });
    if (r.notFound) return notFound("Finding not found.");
    if (!r.ok) return json(503, { error: "Could not resolve the finding.", code: "STORAGE_UNAVAILABLE", detail: r.error });
    return json(200, { finding: r.finding });
  }

  // ── Service radius ───────────────────────────────────────────────────────
  if (section === "radius" && method === "POST") {
    const built = serviceRadiusQueries({
      categories: body.categories || [],
      serviceAreas: body.service_areas || [],
      brandName: body.brand_name || null,
    });
    const coverage = radiusCoverage({
      serviceAreas: body.service_areas || [],
      listingLocalities: body.listing_localities || [],
    });
    // Built, never run. Sampling them is the citation path's job, under its own
    // budget — generating and executing in one call is the shape that produced
    // this module's August 504.
    return json(200, { ...built, coverage, executed: false });
  }

  return notFound("Unknown local-directory endpoint.");
}

/** The listing resolution vocabulary, mirroring 0058's CHECK. */
const LOCAL_RESOLUTIONS = ["listing_updated", "record_updated", "not_a_conflict", "wont_fix"];
