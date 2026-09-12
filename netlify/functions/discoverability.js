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
import { buildWorkspaceCtx } from "./lib/workspaceContext.js";
import { runAudit } from "./lib/audit/auditPipeline.js";
import { summariseAudit } from "./lib/audit/aiEvaluator.js";
import * as store from "./lib/audit/auditStore.js";
import { canonicalAuditUrl } from "../../src/lib/discoverability/auditUrl.js";
import { diffAudits, buildTrend } from "../../src/lib/discoverability/auditDiff.js";
import {
  buildMarkdownReport, issuesToCsv, recommendationsToCsv, toJsonPayload,
  signalsToCsv, scoresToCsv, bundleToCsv, brandCsv,
} from "../../src/lib/discoverability/auditReport.js";
import { buildConstruct } from "../../src/lib/discoverability/constructTemplates.js";
import { AUDIT_PROFILES, packFor } from "../../src/lib/discoverability/auditProfiles.js";
import { scorePillar, scoreFramework } from "../../src/lib/discoverability/scoringModel.js";
import { PILLAR_IDS, PILLARS } from "../../src/lib/discoverability/signalRegistry.js";
import { dispatchAuditEvent } from "./lib/audit/webhookDispatch.js";

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
  return idx === -1 ? "" : p.slice(idx + marker.length);
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

  if (!userId) {
    let result;
    try {
      result = await runAudit(rawUrl, {
        deadline,
        deviceProfile: options.deviceProfile,
        auditProfile: options.auditProfile,
        pageTypeHint: options.pageTypeHint,
        prompts: options.prompts,
        citationEngine: options.citationEngine,
        skipWebVitals: options.skipWebVitals,
        skipCitations: options.skipCitations,
      });
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

  const created = await store.createAudit(userId, {
    targetId, targetUrl: rawUrl,
    deviceProfile: options.deviceProfile, auditProfile: options.auditProfile,
    pageTypeHint: options.pageTypeHint, baselineAuditId: options.baselineAuditId,
    promptSetId: options.promptSetId, idempotencyKey: options.idempotencyKey,
    source, tags: options.tags || [],
  });
  if (!created.ok) {
    return { ok: false, statusCode: 503, body: { error: "Could not open the audit.", code: "STORAGE_UNAVAILABLE", detail: created.error } };
  }
  const auditId = created.audit.id;

  // ── run ──────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await runAudit(rawUrl, {
      // What is LEFT after the gates above, not a fresh allowance.
      deadline,
      deviceProfile: options.deviceProfile,
      auditProfile: options.auditProfile,
      pageTypeHint: options.pageTypeHint,
      prompts: options.prompts,
      citationEngine: options.citationEngine,
      skipWebVitals: options.skipWebVitals,
      skipCitations: options.skipCitations,
    });
  } catch (err) {
    await store.markAuditFailed(auditId, err?.message);
    return { ok: false, statusCode: 502, body: { error: "The audit could not be completed.", code: "AUDIT_FAILED", auditId } };
  }

  const persisted = await store.persistResult(userId, auditId, result);
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

  // Fire and forget. dispatchAuditEvent swallows its own failures, so a user's
  // endpoint being down cannot fail an audit that already ran and was already
  // charged for; the failure lands on the webhook row where they can see it.
  await dispatchAuditEvent(userId, "audit.completed", {
    audit: { id: auditId, target_url: rawUrl }, result,
  });

  return { ok: true, statusCode: 201, body: { ...result, auditId, targetId, persisted: true } };
}

/** Validate and normalise the create-audit body. */
export function parseAuditOptions(body = {}) {
  const errors = [];
  const url = String(body.target_url || body.url || "").trim();
  if (!url) errors.push("target_url is required.");

  const deviceProfile = body.device_profile === "desktop" ? "desktop" : "mobile";
  const auditProfile = AUDIT_PROFILES[body.audit_profile] ? body.audit_profile : "balanced";
  if (body.audit_profile && !AUDIT_PROFILES[body.audit_profile]) {
    errors.push(`audit_profile must be one of: ${Object.keys(AUDIT_PROFILES).join(", ")}.`);
  }

  return {
    errors, url,
    options: {
      deviceProfile, auditProfile,
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
  if (root === "profiles" && method === "GET") return json(200, { profiles: AUDIT_PROFILES });

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
      if (method === "POST" && ["accept", "dismiss", "done", "reopen"].includes(sub)) {
        const status = sub === "accept" ? "accepted" : sub === "reopen" ? "open" : sub === "done" ? "done" : "dismissed";
        const r = await store.setRecommendationStatus(userId, id, status, body.reason);
        if (r.notFound) return notFound("Recommendation not found.");
        if (!r.ok) return bad(r.error);
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

    // ── /webhooks ──────────────────────────────────────────────────────────
    if (root === "webhooks") return await webhookRoute(event, userId, method, id, body);

    // ── /schedules ─────────────────────────────────────────────────────────
    if (root === "schedules") return await scheduleRoute(event, userId, method, id, body);

    // ── /profiles — static reference data for the UI ────────────────────────
    if (root === "profiles" && method === "GET") return json(200, { profiles: AUDIT_PROFILES });

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
  const planId = resolved.plan?.id || "free";
  if (planId === "free") {
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

  const run = await executeAudit({
    event, userId, rawUrl: body.target_url || prior.target_url,
    options: {
      deviceProfile: body.device_profile || prior.device_profile,
      auditProfile: body.audit_profile || prior.audit_profile,
      pageTypeHint: body.page_type_hint || prior.page_type_hint,
      // The re-run is automatically measured against the audit it re-ran, which
      // is what makes "did my fix work" a single click.
      baselineAuditId: auditId,
      promptSetId: body.prompt_sample_set_id || prior.prompt_set_id,
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
  const diff = diffAudits(rehydrate(baselineFull), rehydrate(currentFull));
  return json(200, {
    baseline: { audit_id: baselineFull.audit.id, created_at: baselineFull.audit.created_at },
    current: { audit_id: currentFull.audit.id, created_at: currentFull.audit.created_at },
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
async function gateAuditQuota(event, userId, count, rawWorkspaceId) {
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

  const check = checkCapability(resolved, "audit", {
    usage: { audits: used },
    auditCount: count,
    bonusAudits: resolved.entitlement?.bonus_audits || 0,
    ...workspaceCtx,
  });
  if (!check.allowed) {
    return { ok: false, response: json(DENY_STATUS, { ...denyBody(check), used, capability: "audit" }) };
  }
  return { ok: true, resolved };
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
        options: { auditProfile: profile, deviceProfile: body.device_profile },
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
  for (const row of full.signals || []) {
    values[row.signal_code] = row.normalized_score === null ? null : Number(row.normalized_score);
    if (row.unknown_reason) reasons[row.signal_code] = row.unknown_reason;
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

  return {
    auditId: full.audit.id,
    target: {
      url: full.audit.target_url, page_type: full.audit.page_type,
      device_profile: full.audit.device_profile, audit_profile: full.audit.audit_profile,
      // The pipeline puts the human label here (auditPipeline.js:341). Without
      // it every export printed the raw enum — "page" instead of "General page".
      page_type_label: packFor(full.audit.page_type).label,
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
    pillars,
    penalties: r.engine_json?.penalties || [],
    penaltyMultiplier: num(r.penalty_multiplier),
    scoreMath: { prePenaltyTotal: num(r.pre_penalty_score), penaltyMultiplier: num(r.penalty_multiplier), finalScore: num(r.final_score) },
    issues: (full.issues || []).map((i) => ({
      code: i.code, pillar: i.pillar, severity: i.severity,
      frameworks: i.framework_scope || [], title: i.title, evidence: i.evidence, details: i.details_json,
    })),
    recommendations: (full.recommendations || []).map((x) => ({
      id: x.id, code: x.code, pillar: x.pillar, frameworks: x.frameworks || [],
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
