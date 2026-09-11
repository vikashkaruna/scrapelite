// auditStore.js — persistence for the Discoverability module.
//
// Talks to Supabase over PostgREST with the SERVICE key, for the same reason
// requireEntitlement.js does: it is immune to RLS policy drift, and a user
// cannot make themselves look unrestricted by arranging for their own rows to
// be unreadable. Every read is still scoped by user_id in the query itself, so
// the service key never widens what a caller can see.
//
// ── QUOTA IS COUNTED FROM THE AUDITS THEMSELVES ────────────────────────────
// There is deliberately no counter column. `usage_records` is session-keyed and
// increments through a different path, and a counter that can drift from the
// rows it counts eventually bills someone for work that is not there. The
// audits table IS the ledger. A failed audit does not count: we charge for work
// we did, and our own failures are free.

import { getServiceDb } from "../requireEntitlement.js";
import { SCORING_MODEL_VERSION } from "../../../../src/lib/discoverability/scoringModel.js";

const SELECT_ALL = "select=*";

/**
 * Past this, a still-`running` audit is abandoned rather than in flight.
 *
 * Comfortably above the largest audit budget the platform permits (a Netlify
 * function is killed at 26s at the very most), so a genuinely concurrent run is
 * never mistaken for a crashed one and cannot be used to slip past the quota.
 */
export const ABANDONED_AUDIT_MS = 5 * 60 * 1000;

function db() {
  return getServiceDb();
}

async function rest(path, init = {}) {
  const conn = db();
  if (!conn) return { ok: false, degraded: true, error: "Supabase is not configured", data: null };
  try {
    const res = await fetch(`${conn.base}/${path}`, {
      ...init,
      headers: { ...conn.headers, ...(init.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, degraded: false, status: res.status, error: text || `HTTP ${res.status}`, data: null };
    }
    const text = await res.text();
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (err) {
    return { ok: false, degraded: true, error: err?.message || "request failed", data: null };
  }
}

const insert = (table, rows, prefer = "return=representation") =>
  rest(table, {
    method: "POST",
    headers: { Prefer: prefer },
    body: JSON.stringify(rows),
  });

/** First day of the current UTC month, as an ISO timestamp. */
export function monthStart(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * How many audits this user has run this month.
 *
 * Counted from the audits table, not a counter. `status=neq.failed` is the
 * charging rule in one line: queued, running and completed all represent work
 * we performed; a failure of ours does not.
 *
 * Returns `{ count, degraded }`. A degraded lookup must FAIL OPEN at the call
 * site, the same asymmetry requireEntitlement.js uses — a Supabase blip must
 * never take auditing down.
 */
export async function countAuditsThisMonth(userId, now = Date.now()) {
  if (!userId) return { count: 0, degraded: true };
  const conn = db();
  if (!conn) return { count: 0, degraded: true };
  try {
    // ── Abandoned runs do not count ──────────────────────────────────────
    //
    // The audit row is opened BEFORE the work starts, so a run that never
    // reached `persistResult` or `markAuditFailed` — because the function was
    // killed mid-flight, which is exactly what the 504 was — stays `running`
    // for ever. `status != failed` then counts it against the user's month,
    // permanently, for work that produced nothing.
    //
    // That inverts this module's own charging rule ("a failed audit does not
    // count: we charge for work we did, and our own failures are free"), and
    // it compounds: each retry of a timing-out audit cost another credit.
    //
    // A `running` row older than any audit could possibly take is not in
    // flight, it is abandoned. Recent ones still count, so genuinely
    // concurrent runs cannot be used to slip past the quota.
    const staleCutoff = new Date(now - ABANDONED_AUDIT_MS).toISOString();
    const res = await fetch(
      `${conn.base}/audits?user_id=eq.${encodeURIComponent(userId)}` +
      `&created_at=gte.${encodeURIComponent(monthStart(now))}&status=neq.failed` +
      `&or=(status.neq.running,created_at.gte.${encodeURIComponent(staleCutoff)})` +
      `&select=id`,
      { headers: { ...conn.headers, Prefer: "count=exact", Range: "0-0" } },
    );
    if (!res.ok) return { count: 0, degraded: true };
    // PostgREST returns the exact count in Content-Range as "0-0/N".
    const range = res.headers.get("content-range") || "";
    const total = Number(range.split("/")[1]);
    return { count: Number.isFinite(total) ? total : 0, degraded: false };
  } catch {
    return { count: 0, degraded: true };
  }
}

/** Look up an audit already created under this idempotency key. */
export async function findByIdempotencyKey(userId, key) {
  if (!userId || !key) return null;
  const r = await rest(
    `audits?user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(key)}&${SELECT_ALL}&limit=1`,
  );
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

/**
 * Get-or-create the target for a URL, via the migration's RPC.
 *
 * Every failure branch logs its real cause before degrading to `null`. Unlike
 * `rest()` (whose callers get `{error, status}` back), this function talks to
 * `fetch` directly and used to swallow that detail completely — the caller,
 * and the user, only ever saw a bare "Audit storage is unavailable", with
 * nothing in the Netlify function logs to tell "SUPABASE_URL/KEY unset" apart
 * from "migration 0030 not applied" (the RPC doesn't exist -> 404) apart from
 * "the service key belongs to a different project than the URL" (401 — the
 * exact key/ref mismatch class documented for the anon key elsewhere in this
 * codebase) apart from a transient network blip. That is the same
 * "guess-deploy-report" trap the `[discoverability] Unknown endpoint` logger
 * below exists to avoid for routing; this is the same fix for storage.
 */
export async function ensureTarget(userId, canonicalUrl, host, label = null) {
  const conn = db();
  if (!conn) {
    console.error("[discoverability] ensureTarget: Supabase is not configured — SUPABASE_URL / SUPABASE_SERVICE_KEY missing for this context");
    return null;
  }
  try {
    const res = await fetch(`${conn.base}/rpc/upsert_audit_target`, {
      method: "POST",
      headers: conn.headers,
      body: JSON.stringify({ p_user_id: userId, p_url: canonicalUrl, p_host: host, p_label: label }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[discoverability] ensureTarget: upsert_audit_target rejected (HTTP ${res.status})`, {
        host, status: res.status, detail: detail.slice(0, 500),
      });
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[discoverability] ensureTarget: request failed", { host, message: err?.message });
    return null;
  }
}

/**
 * Open an audit row before the work starts, so an in-flight run is visible.
 *
 * ── THE INTAKE IS WRITTEN HERE, THE RESOLVED PROFILE IS NOT ───────────────
 * Everything the customer stated — type, goal, geography, competitors — is
 * known before a byte is fetched and is written now, so an audit that dies
 * mid-run still records what it was commissioned to do.
 *
 * `audit_profile` is the exception. It may still be settled by the page (see
 * resolveAuditProfile), which has not been fetched yet, so what lands here is
 * the requested-or-derivable value and `persistResult` corrects it to what was
 * actually applied — exactly as it already does for `page_type`.
 */
export async function createAudit(userId, {
  targetId, targetUrl, deviceProfile = "mobile", auditProfile = "balanced",
  auditProfileSource = "default", auditType = "url", primaryGoal = null,
  targetGeography = null, competitorUrls = [],
  pageTypeHint = null, baselineAuditId = null, promptSetId = null,
  idempotencyKey = null, source = "ui", tags = [],
}) {
  const r = await insert("audits", [{
    user_id: userId, target_id: targetId, target_url: targetUrl,
    device_profile: deviceProfile, audit_profile: auditProfile,
    audit_profile_source: auditProfileSource,
    audit_type: auditType, primary_goal: primaryGoal,
    // NULL, never {}. The column's comment and normaliseGeography() agree on
    // one shape for absence; two would mean every reader needs two checks.
    target_geography: targetGeography || null,
    competitor_urls: Array.isArray(competitorUrls) ? competitorUrls : [],
    page_type_hint: pageTypeHint, baseline_audit_id: baselineAuditId,
    prompt_set_id: promptSetId, idempotency_key: idempotencyKey,
    source, tags, status: "running", started_at: new Date().toISOString(),
  }]);
  if (!r.ok) return { ok: false, error: r.error, degraded: r.degraded };
  return { ok: true, audit: Array.isArray(r.data) ? r.data[0] : r.data };
}

/**
 * Write a completed audit's results, signals, issues and recommendations.
 *
 * Children are inserted BEFORE the parent is marked completed. If a child
 * insert fails, the audit stays `running` and is visibly incomplete rather than
 * appearing as a finished audit with a score and no evidence behind it — which
 * is the shape a user would reasonably screenshot and act on.
 */
export async function persistResult(userId, auditId, result) {
  const conn = db();
  if (!conn) return { ok: false, degraded: true, error: "Supabase is not configured" };

  const pillars = result.pillars || {};
  const pillarScore = (p) => pillars[p]?.score ?? null;

  const resultRow = {
    audit_id: auditId,
    user_id: userId,
    final_score: result.finalScore,
    seo_score: result.seoScore,
    aeo_score: result.aeoScore,
    geo_score: result.geoScore,
    headline_framework: result.headlineFramework || "overall",
    answer_clarity_score: pillarScore("answer_clarity"),
    entity_authority_score: pillarScore("entity_authority"),
    structural_hierarchy_score: pillarScore("structural_hierarchy"),
    technical_accessibility_score: pillarScore("technical_accessibility"),
    pre_penalty_score: result.scoreMath?.prePenaltyTotal ?? null,
    penalty_multiplier: result.penaltyMultiplier ?? 1,
    coverage: result.coverage,
    estimated_total_lift: result.estimatedTotalLift ?? 0,
    issue_count: (result.issues || []).length,
    critical_count: (result.issues || []).filter((i) => i.severity === "critical").length,
    // Never null. The result normally carries it; falling back to the imported
    // constant means the column can be NOT NULL — so a future write that forgets
    // the version fails loudly instead of silently filing a v3 score as a v1.
    scoring_model_version: result.scoringModelVersion || SCORING_MODEL_VERSION,
    facts_json: result.facts || {},
    evidence_json: result.evidence || {},
    engine_json: { ...(result.meta?.engine || {}), penalties: result.penalties || [], stageErrors: result.stageErrors || [] },
  };

  const signalRows = Object.entries(pillars).flatMap(([pillar, p]) =>
    (p.signals || []).map((s) => ({
      audit_id: auditId, user_id: userId, pillar,
      signal_code: s.code,
      normalized_score: s.score,          // NULL stays NULL — see the migration
      weight: s.weight,
      measured: s.measured,
      unknown_reason: s.unknownReason,
      // The workings behind the number. `raw_value` is what was actually read;
      // `evidence_json` is how and from where. Both columns have existed since
      // 0030 and neither was ever written — a score nobody could trace back to
      // an observation, on every row in the table.
      raw_value: s.rawValue ?? null,
      evidence_json: s.evidence?.length ? s.evidence : null,
      threshold_json: s.thresholds ?? null,
    })));

  const issueRows = (result.issues || []).map((i) => ({
    audit_id: auditId, user_id: userId, code: i.code, pillar: i.pillar,
    severity: i.severity, framework_scope: i.frameworks || [],
    title: i.title, evidence: i.evidence, details_json: i.details || null,
    evidence_json: i.evidenceRecords?.length ? i.evidenceRecords : null,
    // The gap-analysis fields (0050). `observed` and `inference` sit BESIDE
    // `evidence` rather than replacing it — the sentence is what every export
    // prints and every historical diff compares.
    observed: i.observed ?? i.evidence ?? null,
    inference: i.inference ?? null,
    root_cause: i.rootCause ?? null,
    recommended_module: i.module ?? null,
    owner_role: i.owner ?? null,
    status: i.status || "open",
  }));

  const recRow = (r, issueId) => ({
    audit_id: auditId, user_id: userId, code: r.code, pillar: r.pillar,
    // 🔴 DECLARED IN 0030, WRITTEN BY NOTHING UNTIL NOW. See the block below
    // for why this could not simply be added to the parallel insert.
    issue_id: issueId ?? null,
    frameworks: r.frameworks || [], priority: r.priority,
    priority_score: r.priorityScore, impact_score: r.impactScore,
    effort_score: r.effortScore, confidence_score: r.confidenceScore,
    estimated_lift: r.estimatedLift, owner_role: r.owner,
    title: r.title, rationale: r.rationale, evidence: r.evidence,
    implementation_asset_json: r.implementationAsset || null,
  });

  // ── ISSUES ARE WRITTEN FIRST, AND ALONE ──────────────────────────────────
  //
  // 🔴 `audit_recommendations.issue_id` has existed since migration 0030 and
  // NOTHING HAS EVER WRITTEN IT — NULL on every row for the life of the module.
  // Every recommendation has been an orphan, so "which finding produced this
  // task" had no answer in the data and the validation loop could not close:
  // when a re-audit reports AC-01 resolved there was no way to mark the
  // recommendation it produced as validated except by matching on `code`, which
  // works only while that mapping stays one-to-one and silently mis-attributes
  // the moment it does not.
  //
  // Fixing it costs a round trip, and it is worth it. The four child writes used
  // to go out concurrently with `return=minimal`; recommendations now need the
  // issue ids, so the issue insert is pulled ahead and asks for the rows back.
  // The other three still go concurrently behind it.
  //
  // ⚠️ The ordering guarantee this function has always had is UNCHANGED: every
  // child is written before the parent is marked `completed`, so a partial
  // failure leaves the audit visibly `running` rather than appearing as a
  // finished audit with a score and no evidence behind it — which is the shape
  // a user would reasonably screenshot and act on.
  let issueIdByCode = new Map();
  if (issueRows.length) {
    const written = await insert("audit_issues", issueRows, "return=representation");
    if (!written.ok) {
      await markAuditFailed(auditId, `persist failed: ${written.error}`);
      return { ok: false, error: written.error, degraded: written.degraded };
    }
    issueIdByCode = new Map(
      (Array.isArray(written.data) ? written.data : []).map((row) => [row.code, row.id]),
    );
  }

  // `audit_issues` is UNIQUE on (audit_id, code), so a code identifies exactly
  // one issue within an audit and this map cannot collide. A recommendation
  // whose code found no issue keeps a null link rather than guessing at one —
  // that happens for the unreachable-page path, where the recommendation is
  // built from a code the issue list may have been packed out of.
  const recRows = (result.recommendations || []).map((r) => recRow(r, issueIdByCode.get(r.code)));

  const writes = [insert("audit_results", [resultRow], "return=minimal")];
  if (signalRows.length) writes.push(insert("audit_signals", signalRows, "return=minimal"));
  if (recRows.length) writes.push(insert("audit_recommendations", recRows, "return=minimal"));

  const results = await Promise.all(writes);
  const failed = results.find((r) => !r.ok);
  if (failed) {
    await markAuditFailed(auditId, `persist failed: ${failed.error}`);
    return { ok: false, error: failed.error, degraded: failed.degraded };
  }

  const done = await rest(`audits?id=eq.${encodeURIComponent(auditId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "completed",
      page_type: result.target?.page_type || null,
      // The profile the run ACTUALLY applied, which may have been settled by
      // the page after the row was opened. Same reason page_type is corrected
      // here: the row must say what happened, not what was requested.
      ...(result.target?.audit_profile ? { audit_profile: result.target.audit_profile } : {}),
      ...(result.target?.audit_profile_source ? { audit_profile_source: result.target.audit_profile_source } : {}),
      completed_at: new Date().toISOString(),
    }),
  });
  return done.ok ? { ok: true } : { ok: false, error: done.error, degraded: done.degraded };
}

export async function markAuditFailed(auditId, error) {
  return rest(`audits?id=eq.${encodeURIComponent(auditId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "failed",
      error: String(error || "unknown").slice(0, 500),
      completed_at: new Date().toISOString(),
    }),
  });
}

/** Store the sampled answer-engine runs, excerpt-capped by the caller. */
export async function persistPromptRuns(userId, auditId, sample, promptSetId = null) {
  if (!sample || !Array.isArray(sample.runs) || sample.runs.length === 0) return { ok: true };
  const rows = sample.runs.slice(0, 20).map((r) => ({
    audit_id: auditId, user_id: userId, prompt_set_id: promptSetId,
    engine_name: sample.engine,
    // ⚠️ PER-RUN, NOT PER-SAMPLE. A grounded engine falls back to its own
    // weights whenever search returns nothing useful, so within one sampling
    // pass some answers are retrieved and others recalled. Stamping the whole
    // set with the sample-level flag would label recalled answers as live.
    live: r.live !== undefined ? Boolean(r.live) : Boolean(sample.live),
    prompt: String(r.prompt || "").slice(0, 500),
    mention_detected: r.mention ?? null,
    citation_detected: r.citation ?? null,
    // W6.3 — the seven states and what they were derived from. `misrepresented`
    // stays three-valued: null means could-not-check, not checked-and-fine.
    state: r.state ?? null,
    prompt_kind: r.kind ?? null,
    commercial: r.commercial ?? null,
    kind_confidence: Number.isFinite(r.kindConfidence) ? r.kindConfidence : null,
    recommended: r.recommended ?? null,
    misrepresented: r.misrepresented ?? null,
    competitors_json: r.competitors && r.competitors.length ? r.competitors : null,
    cited_domains_json: r.citedDomains || null,
    sentiment_score: Number.isFinite(r.sentiment) ? r.sentiment : null,
    // Excerpt only. Answer-engine output is volatile and can be
    // policy-sensitive; normalised evidence plus a short excerpt is enough to
    // show a user why their citation score is what it is.
    raw_response_excerpt: String(r.excerpt || "").slice(0, 300),
  }));
  return insert("audit_prompt_runs", rows, "return=minimal");
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getAudit(userId, auditId) {
  const r = await rest(
    `audits?id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&limit=1`,
  );
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** An audit plus every child. The `/results` endpoint's payload. */
export async function getAuditFull(userId, auditId) {
  const audit = await getAudit(userId, auditId);
  if (!audit) return null;
  const scope = `audit_id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(userId)}`;
  const [results, signals, issues, recs, runs] = await Promise.all([
    rest(`audit_results?${scope}&${SELECT_ALL}&limit=1`),
    rest(`audit_signals?${scope}&${SELECT_ALL}&order=pillar.asc,signal_code.asc`),
    rest(`audit_issues?${scope}&${SELECT_ALL}&order=severity.asc`),
    rest(`audit_recommendations?${scope}&${SELECT_ALL}&order=priority_score.desc`),
    rest(`audit_prompt_runs?${scope}&${SELECT_ALL}&limit=20`),
  ]);
  return {
    audit,
    result: results.ok && Array.isArray(results.data) ? results.data[0] || null : null,
    signals: signals.ok ? signals.data || [] : [],
    issues: issues.ok ? issues.data || [] : [],
    recommendations: recs.ok ? recs.data || [] : [],
    promptRuns: runs.ok ? runs.data || [] : [],
  };
}

/**
 * Cache an audit's executive summary.
 *
 * Written once, on first report view, and then travels with the audit into
 * every export — so the PDF and the markdown cannot end up describing the same
 * run differently, which is what generating it per format would guarantee.
 *
 * Never throws: a summary that could not be cached is a summary that gets
 * regenerated next time, not a report that fails to load.
 */
export async function saveAuditSummary(userId, auditId, { summary, model }) {
  if (!userId || !auditId || !summary) return { ok: false };
  const r = await rest(
    `audit_results?audit_id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        summary_md: String(summary).slice(0, 4000),
        summary_model: model ? String(model).slice(0, 80) : null,
        summary_generated_at: new Date().toISOString(),
      }),
    },
  );
  return { ok: Boolean(r.ok) };
}

export async function listAudits(userId, { limit = 25, offset = 0, targetId = null, status = null } = {}) {
  const params = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    "select=*,audit_results(final_score,seo_score,aeo_score,geo_score,coverage,issue_count,critical_count)",
    "order=created_at.desc",
    `limit=${Math.max(1, Math.min(100, limit))}`,
    `offset=${Math.max(0, offset)}`,
  ];
  if (targetId) params.push(`target_id=eq.${encodeURIComponent(targetId)}`);
  if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
  const r = await rest(`audits?${params.join("&")}`);
  return r.ok ? r.data || [] : [];
}

export async function listTargets(userId, { limit = 50 } = {}) {
  const r = await rest(
    `audit_targets?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=updated_at.desc&limit=${Math.max(1, Math.min(200, limit))}`,
  );
  return r.ok ? r.data || [] : [];
}

/** Score history for a target — the trend chart, via the migration's function. */
export async function getTargetTrend(userId, targetId, limit = 30) {
  const conn = db();
  if (!conn) return [];
  // Ownership is checked here rather than relying on the SECURITY DEFINER
  // function, which is scoped by target only. The service key bypasses RLS, so
  // this check is the one that stops a caller reading somebody else's trend.
  const owns = await rest(
    `audit_targets?id=eq.${encodeURIComponent(targetId)}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
  );
  if (!owns.ok || !Array.isArray(owns.data) || owns.data.length === 0) return [];
  try {
    const res = await fetch(`${conn.base}/rpc/audit_target_trend`, {
      method: "POST", headers: conn.headers,
      body: JSON.stringify({ p_target_id: targetId, p_limit: limit }),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Move a recommendation through the queue.
 *
 * A dismissal REQUIRES a reason, enforced here as well as by the UI. A
 * dismissal with no reason is indistinguishable from a mis-click three months
 * later, and the recommendation-acceptance metric becomes unreadable.
 */
export async function setRecommendationStatus(userId, recId, status, reason = null) {
  const allowed = ["open", "accepted", "dismissed", "done"];
  if (!allowed.includes(status)) return { ok: false, error: "invalid status" };
  if (status === "dismissed" && !String(reason || "").trim()) {
    return { ok: false, error: "A dismissal needs a reason." };
  }
  const r = await rest(
    `audit_recommendations?id=eq.${encodeURIComponent(recId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status, dismiss_reason: status === "dismissed" ? String(reason).slice(0, 500) : null }),
    },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  // No row means it is not theirs, or does not exist. 404, never 403 — a 403
  // confirms the id is real, which is how an id space gets enumerated.
  if (!row) return { ok: false, notFound: true, error: "Recommendation not found." };
  return { ok: true, recommendation: row };
}

/**
 * Hand a recommendation to a person, or put it down.
 *
 * ⚠️ THE MEMBERSHIP CHECK IS THE DATABASE'S, NOT OURS. `assign_recommendation`
 * verifies the assignee shares a workspace with the owner, and this function
 * only translates its verdict. Doing the check here instead would leave the
 * column settable to any account id by any other path into the table — and
 * would turn this endpoint into a membership oracle, where a caller assigns to
 * a guessed uuid and learns from the response whether the account is real.
 *
 * `not_found` covers both "no such recommendation" and "not yours", so an id
 * space cannot be enumerated by comparing the two.
 */
export async function setRecommendationAssignee(userId, recId, assigneeId) {
  const conn = db();
  if (!conn) return { ok: false, error: "Audit storage is unavailable." };
  try {
    const res = await fetch(`${conn.base}/rpc/assign_recommendation`, {
      method: "POST",
      headers: conn.headers,
      body: JSON.stringify({ p_user_id: userId, p_rec_id: recId, p_assignee: assigneeId || null }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `assign failed: ${res.status} ${detail}`.trim() };
    }
    const verdict = await res.json();
    if (verdict === "not_found") return { ok: false, notFound: true, error: "Recommendation not found." };
    if (verdict === "not_a_member") {
      return { ok: false, error: "You can only assign work to someone who shares a workspace with you." };
    }
    if (verdict !== "ok") return { ok: false, error: "Assignment was refused." };

    const row = await rest(
      `audit_recommendations?id=eq.${encodeURIComponent(recId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,audit_id,code,assigned_to,assigned_at`,
    );
    const rec = Array.isArray(row.data) ? row.data[0] : row.data;
    return { ok: true, recommendation: rec || { id: recId, assigned_to: assigneeId || null } };
  } catch (err) {
    return { ok: false, error: err?.message || "assign failed" };
  }
}

export async function deleteAudit(userId, auditId) {
  const r = await rest(
    `audits?id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const rows = Array.isArray(r.data) ? r.data : [];
  return rows.length ? { ok: true } : { ok: false, notFound: true };
}

/** Append to the audit trail. Never throws — a lost event must not fail a request. */
export async function recordEvent(userId, { auditId = null, eventType, payload = {} }) {
  try {
    await insert("audit_events", [{
      user_id: userId, audit_id: auditId, event_type: eventType, payload_json: payload,
    }], "return=minimal");
  } catch { /* the trail is best-effort; the request is not */ }
}

// ── Benchmarks ─────────────────────────────────────────────────────────────

export async function createBenchmark(userId, { name, description, primaryUrl, auditProfile, urls }) {
  const b = await insert("audit_benchmarks", [{
    user_id: userId, name, description, primary_url: primaryUrl,
    audit_profile: auditProfile, status: "running",
  }]);
  if (!b.ok) return { ok: false, error: b.error };
  const benchmark = Array.isArray(b.data) ? b.data[0] : b.data;

  const memberRows = urls.map((url, idx) => ({
    benchmark_id: benchmark.id, user_id: userId, url,
    label: null, is_primary: primaryUrl ? url === primaryUrl : idx === 0,
  }));
  const m = await insert("audit_benchmark_members", memberRows);
  if (!m.ok) return { ok: false, error: m.error };
  return { ok: true, benchmark, members: Array.isArray(m.data) ? m.data : [] };
}

export async function attachBenchmarkAudit(memberId, auditId) {
  return rest(`audit_benchmark_members?id=eq.${encodeURIComponent(memberId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ audit_id: auditId }),
  });
}

export async function completeBenchmark(benchmarkId) {
  return rest(`audit_benchmarks?id=eq.${encodeURIComponent(benchmarkId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "completed" }),
  });
}

export async function getBenchmark(userId, benchmarkId) {
  const scope = `user_id=eq.${encodeURIComponent(userId)}`;
  const [b, members] = await Promise.all([
    rest(`audit_benchmarks?id=eq.${encodeURIComponent(benchmarkId)}&${scope}&${SELECT_ALL}&limit=1`),
    rest(`audit_benchmark_members?benchmark_id=eq.${encodeURIComponent(benchmarkId)}&${scope}` +
      `&select=*,audits(id,status,target_url,audit_results(final_score,seo_score,aeo_score,geo_score,coverage,issue_count,critical_count))`),
  ]);
  const benchmark = b.ok && Array.isArray(b.data) ? b.data[0] : null;
  if (!benchmark) return null;
  return { benchmark, members: members.ok ? members.data || [] : [] };
}

export async function listBenchmarks(userId) {
  const r = await rest(
    `audit_benchmarks?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=created_at.desc&limit=50`);
  return r.ok ? r.data || [] : [];
}

export async function deleteBenchmark(userId, benchmarkId) {
  const r = await rest(
    `audit_benchmarks?id=eq.${encodeURIComponent(benchmarkId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

// ── Prompt sets ────────────────────────────────────────────────────────────

export async function createPromptSet(userId, { name, description, prompts }) {
  const r = await insert("audit_prompt_sets", [{
    user_id: userId, name, description, prompts_json: prompts,
  }]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, promptSet: Array.isArray(r.data) ? r.data[0] : r.data };
}

export async function listPromptSets(userId) {
  const r = await rest(
    `audit_prompt_sets?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=created_at.desc&limit=50`);
  return r.ok ? r.data || [] : [];
}

export async function getPromptSet(userId, id) {
  const r = await rest(
    `audit_prompt_sets?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function deletePromptSet(userId, id) {
  const r = await rest(
    `audit_prompt_sets?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

// ── Webhooks ───────────────────────────────────────────────────────────────

/**
 * Register a webhook.
 *
 * The signing secret is generated here, stored ENCRYPTED, and returned to the
 * caller exactly once. No endpoint reads it back: a secret a GET can retrieve
 * is not a secret, it is a second copy of the credential sitting behind the
 * same session that could already read everything it protects.
 */
export async function createWebhook(userId, { targetUrl, events }) {
  const { randomBytes } = await import("node:crypto");
  const { encryptSecret } = await import("../integrationSecrets.js");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const r = await insert("audit_webhooks", [{
    user_id: userId, target_url: targetUrl, events,
    secret_encrypted: encryptSecret(secret),
  }]);
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: true, webhook: scrubWebhook(row), secret };
}

export async function listWebhooks(userId) {
  const r = await rest(
    `audit_webhooks?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=created_at.desc&limit=50`);
  return r.ok ? (r.data || []).map(scrubWebhook) : [];
}

/** Active webhooks subscribed to one event — the dispatcher's read. */
export async function webhooksForEvent(userId, eventType) {
  const r = await rest(
    `audit_webhooks?user_id=eq.${encodeURIComponent(userId)}&active=is.true&${SELECT_ALL}`);
  if (!r.ok) return [];
  return (r.data || []).filter((w) => (w.events || []).includes(eventType));
}

export async function recordWebhookDelivery(id, status) {
  return rest(`audit_webhooks?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      last_status: status,
      last_delivered_at: new Date().toISOString(),
      // Reset on success so one bad afternoon does not permanently mark a
      // healthy endpoint as failing.
      failure_count: status >= 200 && status < 300 ? 0 : undefined,
    }),
  });
}

export async function deleteWebhook(userId, id) {
  const r = await rest(
    `audit_webhooks?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

/** Never let the encrypted secret leave this module. */
function scrubWebhook(row) {
  if (!row) return row;
  const { secret_encrypted, ...rest_ } = row;
  return { ...rest_, has_secret: Boolean(secret_encrypted) };
}

// ── Schedules ──────────────────────────────────────────────────────────────

export async function createSchedule(userId, {
  targetId, name, cadence, deviceProfile, auditProfile, alertEmail, alertThreshold,
  primaryGoal = null, pageTypeHint = null, targetGeography = null, competitorUrls = [],
}) {
  const r = await insert("audit_schedules", [{
    user_id: userId, target_id: targetId, name, cadence,
    device_profile: deviceProfile, audit_profile: auditProfile,
    // Carried onto every run this schedule creates. A monitor that dropped the
    // goal would build a trend line whose first point had context and whose
    // others did not — and the diff would still be drawn, because nothing
    // downstream knows the context changed.
    primary_goal: primaryGoal, page_type_hint: pageTypeHint,
    target_geography: targetGeography || null,
    competitor_urls: Array.isArray(competitorUrls) ? competitorUrls : [],
    alert_email: alertEmail, alert_threshold: alertThreshold,
    next_run_at: nextRunAt(cadence),
  }]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, schedule: Array.isArray(r.data) ? r.data[0] : r.data };
}

export async function listSchedules(userId) {
  const r = await rest(
    `audit_schedules?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=*,audit_targets(canonical_url,host,label)&order=created_at.desc&limit=100`);
  return r.ok ? r.data || [] : [];
}

/**
 * Update a schedule.
 *
 * The platform's pause fields are stripped from the payload here as well as
 * being REVOKEd at the column level. Belt and braces on purpose: the REVOKE is
 * what an attacker cannot route around by calling PostgREST directly, and this
 * is what keeps an honest bug in our own handler from writing them.
 */
export async function updateSchedule(userId, id, body) {
  const patch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (["daily", "weekly", "monthly"].includes(body.cadence)) {
    patch.cadence = body.cadence;
    patch.next_run_at = nextRunAt(body.cadence);
  }
  if (["active", "paused"].includes(body.status)) patch.status = body.status;
  if (body.alert_email !== undefined) patch.alert_email = body.alert_email;
  if (Number.isFinite(Number(body.alert_threshold))) patch.alert_threshold = Number(body.alert_threshold);
  if (body.run_until !== undefined) patch.run_until = body.run_until;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };

  const r = await rest(
    `audit_schedules?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return row ? { ok: true, schedule: row } : { ok: false, notFound: true };
}

export async function deleteSchedule(userId, id) {
  const r = await rest(
    `audit_schedules?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

/** Schedules due to run. Read by the cron with the service key. */
export async function dueSchedules(now = new Date(), limit = 25) {
  const r = await rest(
    `audit_schedules?status=eq.active&system_paused=is.false` +
    `&next_run_at=lte.${encodeURIComponent(now.toISOString())}` +
    `&select=*,audit_targets(canonical_url,host,label)&order=next_run_at.asc&limit=${limit}`);
  if (!r.ok) return [];
  // A schedule past its end date is not due; it is finished.
  return (r.data || []).filter((s) => !s.run_until || new Date(s.run_until) > now);
}

export async function markScheduleRun(id, { auditId, cadence, now = new Date() }) {
  return rest(`audit_schedules?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      last_run_at: now.toISOString(),
      last_audit_id: auditId || null,
      next_run_at: nextRunAt(cadence, now),
    }),
  });
}

export function nextRunAt(cadence, from = new Date()) {
  const d = new Date(from);
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}
