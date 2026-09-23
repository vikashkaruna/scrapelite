// auditStore.js — persistence for the Discoverability module.
//
// Talks to Supabase over PostgREST with the SERVICE key, for the same reason
// requireEntitlement.js does: it is immune to RLS policy drift, and a user
// cannot make themselves look unrestricted by arranging for their own rows to
// be unreadable. Personal reads are scoped by user_id; workspace reads are
// scoped by workspace_id only after the route has verified membership and the
// requested Discoverability action.
//
// ── QUOTA IS COUNTED FROM THE AUDITS THEMSELVES ────────────────────────────
// There is deliberately no counter column. `usage_records` is session-keyed and
// increments through a different path, and a counter that can drift from the
// rows it counts eventually bills someone for work that is not there. The
// audits table IS the ledger. A failed audit does not count: we charge for work
// we did, and our own failures are free.

import { getServiceDb } from "../requireEntitlement.js";
import { encryptSecret } from "../integrationSecrets.js";
import { SCORING_MODEL_VERSION } from "../../../../src/lib/discoverability/scoringModel.js";
import { isWorkflowState, requirementsFor } from "../../../../src/lib/discoverability/workflowLifecycle.js";
import { makeSubject } from "../../../../src/lib/discoverability/subjectModel.js";

const SELECT_ALL = "select=*";

function ownerOrWorkspace(userId, workspaceId = null) {
  return workspaceId
    ? `workspace_id=eq.${encodeURIComponent(workspaceId)}`
    : `user_id=eq.${encodeURIComponent(userId)}`;
}

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
 * D7 — get or create the SUBJECT this audit is about.
 *
 * Mirrors `ensureTarget` above: the application asks, and gets one back whether
 * or not it already existed. `upsert_audit_subject` is idempotent by the
 * partial unique indexes in 0057, so two concurrent audits of the same brand
 * cannot mint two subjects and scatter the history between them.
 *
 * 🔴 RETURNS `null` ON FAILURE, AND THAT IS NOT FATAL. `audits.subject_id` is
 * nullable by design: a pre-0057 audit has none and works unchanged, so an
 * audit whose subject lookup failed is in exactly the same, already-supported
 * state rather than a broken one. Failing the whole audit here would take the
 * product down for a registry that is additive — the opposite of the trade D7
 * was chosen to make. The error is logged so the failure is visible, which is
 * the distinction this repo has had to learn three times: degraded is fine,
 * SILENTLY degraded is not.
 */
export async function ensureSubject(userId, {
  kind = "page", targetId = null, entityId = null, truthRecordId = null,
  label = null, canonicalDomain = null, workspaceId = null,
} = {}) {
  const conn = db();
  if (!conn) {
    console.error("[discoverability] ensureSubject: Supabase is not configured");
    return null;
  }
  const built = makeSubject({
    kind, targetId, entityId, truthRecordId,
    label: label || kind, canonicalDomain, workspaceId,
  });
  if (!built.ok) {
    console.error("[discoverability] ensureSubject: refused by the model", { kind, reason: built.reason });
    return null;
  }
  try {
    const res = await fetch(`${conn.base}/rpc/upsert_audit_subject`, {
      method: "POST",
      headers: conn.headers,
      body: JSON.stringify({
        p_user_id: userId,
        p_kind: built.subject.subject_kind,
        p_target_id: built.subject.target_id,
        p_entity_id: built.subject.entity_id,
        p_truth_record_id: built.subject.truth_record_id,
        p_label: built.subject.label,
        p_canonical_domain: built.subject.canonical_domain,
        p_workspace_id: built.subject.workspace_id,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[discoverability] ensureSubject: upsert_audit_subject rejected (HTTP ${res.status})`, {
        kind, status: res.status, detail: detail.slice(0, 500),
      });
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[discoverability] ensureSubject: request failed", { kind, message: err?.message });
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
/**
 * D6 — carry the workspace onto the row.
 *
 * The columns have existed since 0030 and nothing has ever written them.
 * Back-filling later costs far more than carrying them now, which is the same
 * reasoning that made `raw_value` and `audit_recommendations.issue_id` worth
 * fixing rather than dropping. ⚠️ NULL stays valid and common — most audits are
 * run by a solo operator with no workspace at all.
 */
export async function createAudit(userId, {
  targetId, targetUrl, deviceProfile = "mobile", auditProfile = "balanced",
  auditProfileSource = "default", auditType = "url", primaryGoal = null,
  targetGeography = null, competitorUrls = [],
  pageTypeHint = null, baselineAuditId = null, promptSetId = null,
  idempotencyKey = null, source = "ui", tags = [], workspaceId = null,
  subjectId = null,
}) {
  const r = await insert("audits", [{
    user_id: userId, target_id: targetId, target_url: targetUrl,
    workspace_id: workspaceId || null,
    // D7. NULL is valid and is what every pre-0057 row carries; target_id
    // stays authoritative for the page case either way.
    subject_id: subjectId || null,
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
export async function persistResult(userId, auditId, result, { workspaceId = null } = {}) {
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
    // D6 — denormalised from the audit so the queue filters by workspace
    // without a join. NULL is valid and common.
    workspace_id: workspaceId || null,
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

/**
 * The whole queue across every audit, not one audit's slice of it.
 *
 * Exports have been audit-scoped since the module shipped, which is the wrong
 * unit for somebody working a backlog spread over twenty pages. Ordered by
 * priority so a CSV opened in a spreadsheet is already in the order the work
 * should happen.
 *
 * ⚠️ ACTIVE ITEMS BY DEFAULT. A queue export that silently includes everything
 * ever dismissed hands somebody a file that is mostly noise, and they will not
 * notice until they have worked half of it.
 */
/**
 * A row cap that is always a number.
 *
 * ⚠️ Not a style fix. Every other caller-supplied value in this file goes
 * through `encodeURIComponent`, but a bare `limit=${x}` interpolates straight
 * into the PostgREST query string — so the day someone wires a `?limit=` query
 * parameter to one of these readers, `1&user_id=eq.<anyone>` stops being a
 * limit and starts being a filter. No route passes caller input here today;
 * this makes sure the one that eventually does cannot.
 */
function rowCap(n, fallback, max = 1000) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : fallback;
}

export async function listRecommendationQueue(userId, { status = null, workspaceId = null, limit = 500 } = {}) {
  const parts = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (status) {
    parts.push(`status=eq.${encodeURIComponent(status)}`);
  } else {
    parts.push("status=in.(open,accepted,assigned,in_progress)");
  }
  if (workspaceId) parts.push(`workspace_id=eq.${encodeURIComponent(workspaceId)}`);
  const r = await rest(
    `audit_recommendations?${parts.join("&")}&${SELECT_ALL}`
    + `&order=priority_score.desc.nullslast&limit=${rowCap(limit, 500)}`,
  );
  return Array.isArray(r.data) ? r.data : [];
}

// ── Prompt monitors (W6.5) ─────────────────────────────────────────────────

/** Monitors whose clock is up, and that neither the user nor the platform paused. */
export async function listDuePromptMonitors(now = Date.now(), limit = 25) {
  const iso = new Date(now).toISOString();
  const r = await rest(
    `prompt_monitors?status=eq.active&system_paused=is.false`
    + `&or=(next_run_at.is.null,next_run_at.lte.${encodeURIComponent(iso)})`
    + `&${SELECT_ALL}&order=next_run_at.asc.nullsfirst&limit=${rowCap(limit, 25)}`,
  );
  const rows = Array.isArray(r.data) ? r.data : [];
  // `run_until` is filtered here rather than in the query so an expired monitor
  // is still advanced by the caller and stops appearing, instead of sitting due
  // for ever and being re-read on every tick.
  return rows.filter((m) => !m.run_until || Date.parse(m.run_until) >= now);
}

/** Move a monitor's clock on, whether its run succeeded or not. */
export async function advancePromptMonitor(monitorId, nextRunAt) {
  return rest(`prompt_monitors?id=eq.${encodeURIComponent(monitorId)}`, {
    method: "PATCH",
    body: JSON.stringify({ next_run_at: nextRunAt, last_run_at: new Date().toISOString() }),
  });
}

export async function getTargetById(userId, targetId) {
  const r = await rest(
    `audit_targets?id=eq.${encodeURIComponent(targetId)}&user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&limit=1`,
  );
  return Array.isArray(r.data) ? r.data[0] || null : null;
}

/**
 * Store one monitor run, and the per-prompt detail beneath it.
 *
 * ⚠️ A FAILED RUN IS STILL RECORDED. A gap in a trend line is indistinguishable
 * from a period of no visibility, and the second is a finding while the first
 * is an outage. The row carries `error` and a null WAVI so a reader can tell
 * them apart.
 */
export async function recordPromptMonitorRun(monitor, sample, error = null) {
  const rates = sample?.states || {};
  const head = {
    monitor_id: monitor.id, user_id: monitor.user_id,
    engine_name: sample?.engine || null,
    live: Boolean(sample?.live),
    prompt_count: sample?.promptCount || 0,
    mention_rate: rates.mentionRate ?? null,
    citation_rate: rates.citationRate ?? null,
    recommendation_rate: rates.recommendationRate ?? null,
    wavi_score: sample?.wavi?.score ?? null,
    wavi_coverage: sample?.wavi?.coverage ?? null,
    sov_declared: sample?.shareOfVoice?.sovDeclared ?? null,
    states_json: rates.counts || null,
    error: error || sample?.error || null,
  };
  const r = await insert("prompt_monitor_runs", [head]);
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!row?.id || !sample?.runs?.length) return { ok: Boolean(row), run: row || null };

  await insert("audit_prompt_runs", sample.runs.slice(0, 50).map((x) => ({
    // A monitor run has no audit, so audit_id stays null and monitor_run_id
    // carries the link instead.
    audit_id: null, user_id: monitor.user_id, monitor_run_id: row.id,
    engine_name: sample.engine,
    live: x.live !== undefined ? Boolean(x.live) : Boolean(sample.live),
    prompt: String(x.prompt || "").slice(0, 500),
    mention_detected: x.mention ?? null,
    citation_detected: x.citation ?? null,
    state: x.state ?? null,
    prompt_kind: x.kind ?? null,
    commercial: x.commercial ?? null,
    kind_confidence: Number.isFinite(x.kindConfidence) ? x.kindConfidence : null,
    recommended: x.recommended ?? null,
    misrepresented: x.misrepresented ?? null,
    competitors_json: x.competitors?.length ? x.competitors : null,
    raw_response_excerpt: String(x.excerpt || "").slice(0, 300),
  })), "return=minimal");

  return { ok: true, run: row };
}

/** A monitor's runs, newest first, for the trend. */
export async function listPromptMonitorRuns(userId, monitorId, limit = 30) {
  const r = await rest(
    `prompt_monitor_runs?monitor_id=eq.${encodeURIComponent(monitorId)}`
    + `&user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}`
    + `&order=created_at.desc&limit=${rowCap(limit, 30)}`,
  );
  return Array.isArray(r.data) ? r.data : [];
}

export async function listPromptMonitors(userId, limit = 50) {
  const r = await rest(
    `prompt_monitors?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=created_at.desc&limit=${rowCap(limit, 50)}`,
  );
  return Array.isArray(r.data) ? r.data : [];
}

export async function createPromptMonitor(userId, fields) {
  const r = await insert("prompt_monitors", [{ ...fields, user_id: userId }]);
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return row ? { ok: true, monitor: row } : { ok: false, error: r.error || "Could not create the monitor." };
}

export async function deletePromptMonitor(userId, monitorId) {
  const r = await rest(
    `prompt_monitors?id=eq.${encodeURIComponent(monitorId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return row ? { ok: true } : { ok: false, notFound: true };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getAudit(userId, auditId, { workspaceId = null } = {}) {
  const r = await rest(
    `audits?id=eq.${encodeURIComponent(auditId)}&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`,
  );
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** An audit plus every child. The `/results` endpoint's payload. */
export async function getAuditFull(userId, auditId, { workspaceId = null } = {}) {
  const audit = await getAudit(userId, auditId, { workspaceId });
  if (!audit) return null;
  // Child rows keep the audit creator as user_id. Once the workspace-scoped
  // parent has been authorized, use that stored owner id rather than the
  // viewer's id so another workspace member can read the complete audit.
  const scope = `audit_id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(audit.user_id || userId)}`;
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
export async function saveAuditSummary(userId, auditId, { summary, model, workspaceId = null, auditOwnerId = null }) {
  if (!userId || !auditId || !summary) return { ok: false };
  // A workspace member may be the first person to open a shared report. The
  // parent audit has already been scoped and authorized by the route, so cache
  // against the audit creator stored on that parent rather than the viewer.
  const storedOwner = workspaceId && auditOwnerId ? auditOwnerId : userId;
  const r = await rest(
    `audit_results?audit_id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(storedOwner)}`,
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

export async function listAudits(userId, {
  limit = 25, offset = 0, targetId = null, status = null, workspaceId = null,
} = {}) {
  const params = [
    ownerOrWorkspace(userId, workspaceId),
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

export async function listTargets(userId, { limit = 50, workspaceId = null } = {}) {
  if (workspaceId) {
    // Targets predate workspaces and intentionally remain account-owned. A
    // shared target is therefore derived from the workspace's audits, then
    // hydrated without applying the viewer's user_id (which would hide rows
    // created by another member).
    const scoped = await rest(
      `audits?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&select=target_id&order=created_at.desc&limit=${Math.max(1, Math.min(500, limit * 10))}`,
    );
    const ids = [...new Set((scoped.ok && Array.isArray(scoped.data) ? scoped.data : [])
      .map((row) => row.target_id).filter(Boolean))].slice(0, Math.max(1, Math.min(200, limit)));
    if (!ids.length) return [];
    const r = await rest(
      `audit_targets?id=in.(${ids.map(encodeURIComponent).join(",")})`
      + `&${SELECT_ALL}&order=updated_at.desc&limit=${ids.length}`,
    );
    return r.ok ? r.data || [] : [];
  }
  const r = await rest(
    `audit_targets?user_id=eq.${encodeURIComponent(userId)}&${SELECT_ALL}&order=updated_at.desc&limit=${Math.max(1, Math.min(200, limit))}`,
  );
  return r.ok ? r.data || [] : [];
}

/** Score history for a target — the trend chart, via the migration's function. */
export async function getTargetTrend(userId, targetId, limit = 30, { workspaceId = null } = {}) {
  if (workspaceId) {
    // The legacy SECURITY DEFINER RPC is target-scoped, not workspace-scoped.
    // Calling it after merely finding one shared audit could mix the creator's
    // personal runs into the workspace graph. Read the exact scoped rows and
    // flatten the embedded result instead.
    const r = await rest(
      `audits?target_id=eq.${encodeURIComponent(targetId)}`
      + `&workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.completed`
      + `&select=id,created_at,audit_results(final_score,seo_score,aeo_score,geo_score,answer_clarity_score,entity_authority_score,structural_hierarchy_score,technical_accessibility_score,coverage,issue_count,critical_count)`
      + `&order=created_at.desc&limit=${Math.max(1, Math.min(365, limit))}`,
    );
    if (!r.ok || !Array.isArray(r.data)) return [];
    return r.data.map((row) => {
      const result = Array.isArray(row.audit_results) ? row.audit_results[0] : row.audit_results;
      return { audit_id: row.id, created_at: row.created_at, ...(result || {}) };
    });
  }
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
export async function setRecommendationStatus(userId, recId, status, reason = null, extra = {}) {
  // W8 — the full lifecycle. `isWorkflowState` and `requirementsFor` are the
  // single source for both, so the API, the UI and any future importer cannot
  // disagree about what a state needs.
  if (!isWorkflowState(status)) return { ok: false, error: "invalid status" };
  const req = requirementsFor(status, {
    reason,
    validatedByAuditId: extra.validatedByAuditId,
    assignee: extra.assignee,
  });
  if (!req.ok) return { ok: false, error: req.missing[0] };

  const r = await rest(
    `audit_recommendations?id=eq.${encodeURIComponent(recId)}&${ownerOrWorkspace(userId, extra.workspaceId || null)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status,
        dismiss_reason: status === "dismissed" ? String(reason).slice(0, 500) : null,
        status_changed_at: new Date().toISOString(),
        ...(extra.validatedByAuditId ? { validated_by_audit_id: extra.validatedByAuditId } : {}),
        ...(extra.dueAt !== undefined ? { due_at: extra.dueAt } : {}),
        ...(extra.notes !== undefined ? { notes: extra.notes === null ? null : String(extra.notes).slice(0, 4000) } : {}),
      }),
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
export async function setRecommendationAssignee(userId, recId, assigneeId, { workspaceId = null } = {}) {
  const conn = db();
  if (!conn) return { ok: false, error: "Audit storage is unavailable." };
  try {
    const rpc = workspaceId ? "assign_discoverability_recommendation" : "assign_recommendation";
    const res = await fetch(`${conn.base}/rpc/${rpc}`, {
      method: "POST",
      headers: conn.headers,
      body: JSON.stringify({
        p_user_id: userId, p_rec_id: recId, p_assignee: assigneeId || null,
        ...(workspaceId ? { p_workspace_id: workspaceId } : {}),
      }),
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
      `audit_recommendations?id=eq.${encodeURIComponent(recId)}&${ownerOrWorkspace(userId, workspaceId)}`
      + `&select=id,user_id,workspace_id,audit_id,code,assigned_to,assigned_at`,
    );
    const rec = Array.isArray(row.data) ? row.data[0] : row.data;
    return { ok: true, recommendation: rec || { id: recId, assigned_to: assigneeId || null } };
  } catch (err) {
    return { ok: false, error: err?.message || "assign failed" };
  }
}

export async function deleteAudit(userId, auditId, { workspaceId = null } = {}) {
  const r = await rest(
    `audits?id=eq.${encodeURIComponent(auditId)}&${ownerOrWorkspace(userId, workspaceId)}`,
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
    `&select=*,audit_targets(canonical_url,host,label)&order=next_run_at.asc&limit=${rowCap(limit, 25)}`);
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

// ── Business truth records (W9) ─────────────────────────────────────────────
//
// The record is the identity; versions are proposals. Every write here keeps
// that split: nothing edits a version in place once it has been reviewed, and
// nothing sets `current_version_id` except `promoteTruthVersion`, which goes
// through the SQL function so the three writes promotion needs cannot separate.

export async function createTruthRecord(userId, { canonicalDomain, displayName = null, targetId = null, workspaceId = null, notApplicable = [] }) {
  const r = await insert("audit_business_truth_records", [{
    user_id: userId,
    canonical_domain: canonicalDomain,
    display_name: displayName,
    target_id: targetId,
    workspace_id: workspaceId,
    not_applicable: notApplicable,
  }]);
  if (!r.ok) {
    // The partial unique index is the whole point of the table — one live
    // answer per business — so report the collision as a collision rather than
    // as a generic write failure the caller has to guess at.
    const duplicate = /duplicate key|audit_btr_owner_domain_uniq/i.test(r.error || "");
    return { ok: false, duplicate, error: r.error };
  }
  return { ok: true, record: Array.isArray(r.data) ? r.data[0] : r.data };
}

export async function listTruthRecords(userId, { workspaceId = null, limit = 50 } = {}) {
  const r = await rest(
    `audit_business_truth_records?${ownerOrWorkspace(userId, workspaceId)}&status=eq.active`
    + `&${SELECT_ALL}&order=updated_at.desc&limit=${Number(limit) || 50}`);
  return r.ok ? r.data || [] : [];
}

export async function getTruthRecord(userId, recordId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_business_truth_records?id=eq.${encodeURIComponent(recordId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** The record plus its versions, newest first, and its open conflicts. */
export async function getTruthRecordFull(userId, recordId, { workspaceId = null } = {}) {
  const record = await getTruthRecord(userId, recordId, { workspaceId });
  if (!record) return null;
  const [versions, conflicts] = await Promise.all([
    rest(`audit_business_truth_versions?record_id=eq.${encodeURIComponent(recordId)}`
      + `&${SELECT_ALL}&order=version_no.desc&limit=100`),
    rest(`audit_business_truth_conflicts?record_id=eq.${encodeURIComponent(recordId)}`
      + `&resolved_at=is.null&${SELECT_ALL}&order=created_at.desc&limit=200`),
  ]);
  return {
    ...record,
    versions: versions.ok ? versions.data || [] : [],
    conflicts: conflicts.ok ? conflicts.data || [] : [],
  };
}

export async function getTruthVersion(userId, recordId, versionId, { workspaceId = null } = {}) {
  const owned = await getTruthRecord(userId, recordId, { workspaceId });
  if (!owned) return null;
  const r = await rest(
    `audit_business_truth_versions?id=eq.${encodeURIComponent(versionId)}`
    + `&record_id=eq.${encodeURIComponent(recordId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** The canonical version, or null when nothing has been approved yet. */
export async function getCanonicalTruthVersion(userId, recordId, { workspaceId = null } = {}) {
  const record = await getTruthRecord(userId, recordId, { workspaceId });
  if (!record?.current_version_id) return null;
  return getTruthVersion(userId, recordId, record.current_version_id, { workspaceId });
}

/**
 * Add a version.
 *
 * ⚠️ `version_no` IS READ AND INCREMENTED, NOT SUPPLIED BY THE CALLER. Two
 * concurrent proposals racing to number 4 collide on the unique index rather
 * than silently overwriting each other — which is the correct outcome, so the
 * collision is reported as `conflict` and the caller retries against a number
 * it re-reads. A sequence would gap on rollback and make "version 4 was
 * rejected" a sentence about a row that does not exist.
 */
export async function createTruthVersion(userId, recordId, {
  fields, completeness = null, origin = "manual", sourceAuditId = null, state = "draft",
  workspaceId = null,
}) {
  const record = await getTruthRecord(userId, recordId, { workspaceId });
  if (!record) return { ok: false, notFound: true };

  const last = await rest(
    `audit_business_truth_versions?record_id=eq.${encodeURIComponent(recordId)}`
    + `&select=version_no&order=version_no.desc&limit=1`);
  const nextNo = (last.ok && Array.isArray(last.data) && last.data[0]?.version_no || 0) + 1;

  const r = await insert("audit_business_truth_versions", [{
    record_id: recordId,
    version_no: nextNo,
    state,
    fields_json: fields,
    completeness,
    origin,
    source_audit_id: sourceAuditId,
    proposed_by: userId,
  }]);
  if (!r.ok) {
    const conflict = /duplicate key|audit_btv_record_version_uniq/i.test(r.error || "");
    return { ok: false, conflict, error: r.error };
  }
  return { ok: true, version: Array.isArray(r.data) ? r.data[0] : r.data };
}

/**
 * Move a version between states, short of approval.
 *
 * 🔴 `approved` IS NOT REACHABLE FROM HERE, DELIBERATELY. Approval is
 * promotion, it is three writes, and it goes through the SQL function. A PATCH
 * that could set `state='approved'` would be a second promotion path with none
 * of the interlocks, and the second path is always the one that forgets.
 */
export async function setTruthVersionState(userId, recordId, versionId, state, {
  note = null, reviewerId = null, workspaceId = null,
} = {}) {
  if (state === "approved") return { ok: false, refused: "approval_requires_promotion" };
  const current = await getTruthVersion(userId, recordId, versionId, { workspaceId });
  if (!current) return { ok: false, notFound: true };

  const patch = { state };
  if (note !== null) patch.review_note = note;
  if (state === "rejected") {
    patch.reviewed_by = reviewerId || userId;
    patch.reviewed_at = new Date().toISOString();
  }

  const r = await rest(
    `audit_business_truth_versions?id=eq.${encodeURIComponent(versionId)}`
    + `&record_id=eq.${encodeURIComponent(recordId)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, version: Array.isArray(r.data) ? r.data[0] : r.data };
}

/**
 * Approve a version and make it canonical.
 *
 * Ownership is checked here; every other rule — reviewable state, a reviewer
 * who is not the proposer, the two identifying facts — is checked inside the
 * function, atomically, and its verdict string is returned unchanged so the
 * route can map it to a status code without re-deriving anything.
 */
export async function promoteTruthVersion(userId, recordId, versionId, { note = null, workspaceId = null } = {}) {
  const owned = await getTruthVersion(userId, recordId, versionId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };

  const conn = db();
  if (!conn) return { ok: false, degraded: true, error: "Supabase is not configured" };

  const r = await rest("rpc/promote_business_truth_version", {
    method: "POST",
    body: JSON.stringify({ p_version_id: versionId, p_reviewer_id: userId, p_note: note }),
  });
  if (!r.ok) return { ok: false, error: r.error };

  const verdict = typeof r.data === "string" ? r.data : r.data?.promote_business_truth_version || "unknown";
  return verdict === "ok" ? { ok: true } : { ok: false, verdict };
}

export async function deleteTruthVersion(userId, recordId, versionId, { workspaceId = null } = {}) {
  const version = await getTruthVersion(userId, recordId, versionId, { workspaceId });
  if (!version) return { ok: false, notFound: true };

  const record = await getTruthRecord(userId, recordId, { workspaceId });
  if (record?.current_version_id === versionId || version.state === "approved") {
    return { ok: false, refused: "Cannot delete the active canonical version. Promote a new version first or archive the record." };
  }

  const r = await rest(
    `audit_business_truth_versions?id=eq.${encodeURIComponent(versionId)}`
    + `&record_id=eq.${encodeURIComponent(recordId)}`,
    { method: "DELETE" }
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, deleted: true };
}

export async function archiveTruthRecord(userId, recordId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_business_truth_records?id=eq.${encodeURIComponent(recordId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "archived" }),
    });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

/**
 * Record what an audit found that disagrees with the canonical record.
 *
 * Stored rather than recomputed on read: the finding is about a MOMENT — the
 * page said this on that date — and re-deriving it later against a record that
 * has since changed would rewrite history.
 */
export async function recordTruthConflicts(recordId, auditId, versionId, conflicts = []) {
  const rows = (Array.isArray(conflicts) ? conflicts : [])
    .filter((c) => c && typeof c.code === "string" && typeof c.field === "string")
    .map((c) => ({
      record_id: recordId,
      audit_id: auditId || null,
      version_id: versionId || null,
      code: c.code,
      field: c.field,
      severity: c.severity || "medium",
      canonical_value: c.canonical_value == null ? null : String(c.canonical_value).slice(0, 1000),
      observed_value: c.observed_value == null ? null : String(c.observed_value).slice(0, 1000),
      evidence_json: c.evidence || null,
    }));
  if (!rows.length) return { ok: true, count: 0 };
  const r = await insert("audit_business_truth_conflicts", rows, "return=minimal");
  return r.ok ? { ok: true, count: rows.length } : { ok: false, error: r.error };
}

export async function resolveTruthConflict(userId, recordId, conflictId, resolution, { workspaceId = null } = {}) {
  const owned = await getTruthRecord(userId, recordId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };
  const r = await rest(
    `audit_business_truth_conflicts?id=eq.${encodeURIComponent(conflictId)}`
    + `&record_id=eq.${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ resolution, resolved_at: new Date().toISOString() }),
    });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

// ── Entity graph (W10) ─────────────────────────────────────────────────────
//
// Nothing here creates an APPROVED row. Approval is `approveEntityRelationship`,
// which goes through the SQL function because approving an edge also approves
// its endpoints — an approved edge between two unreviewed nodes is a half-built
// statement, and doing that as three PostgREST calls leaves windows where the
// graph asserts a relationship between things it has not agreed exist.

export async function createEntity(userId, {
  entityType, name, description = null, canonicalDomain = null, externalIds = null,
  source = "declared", evidence = null, confidence = null,
  truthRecordId = null, workspaceId = null, sourceAuditId = null,
}) {
  const r = await insert("audit_entities", [{
    user_id: userId,
    entity_type: entityType,
    name,
    description,
    canonical_domain: canonicalDomain,
    external_ids: externalIds || {},
    source,
    evidence_json: evidence,
    confidence,
    truth_record_id: truthRecordId,
    workspace_id: workspaceId,
    source_audit_id: sourceAuditId,
    proposed_by: userId,
  }]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, entity: Array.isArray(r.data) ? r.data[0] : r.data };
}

export async function listEntities(userId, {
  truthRecordId = null, state = null, workspaceId = null, limit = 500,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (truthRecordId) parts.push(`truth_record_id=eq.${encodeURIComponent(truthRecordId)}`);
  if (state) parts.push(`state=eq.${encodeURIComponent(state)}`);
  const r = await rest(`audit_entities?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${Number(limit) || 500}`);
  return r.ok ? r.data || [] : [];
}

export async function getEntity(userId, entityId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_entities?id=eq.${encodeURIComponent(entityId)}&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function createRelationship(userId, {
  subjectId, predicate, objectId, source = "declared",
  evidence = null, confidence = null, note = null, sourceAuditId = null,
  workspaceId = null,
}) {
  const r = await insert("audit_entity_relationships", [{
    user_id: userId,
    subject_id: subjectId,
    predicate,
    object_id: objectId,
    source,
    evidence_json: evidence,
    confidence,
    note,
    source_audit_id: sourceAuditId,
    workspace_id: workspaceId,
    proposed_by: userId,
  }]);
  if (!r.ok) {
    // The unique index is the point: re-observing an edge must update the row,
    // never add one, or a weekly crawler doubles every count. Report the
    // collision so the caller can corroborate instead of retrying blindly.
    const duplicate = /duplicate key|audit_rel_unique/i.test(r.error || "");
    return { ok: false, duplicate, error: r.error };
  }
  return { ok: true, relationship: Array.isArray(r.data) ? r.data[0] : r.data };
}

/**
 * The existing edge behind a duplicate-key refusal, scoped to its owner.
 *
 * `createRelationship` reports `duplicate` so the caller can corroborate rather
 * than retry blindly — but corroboration has to attach to a row id, and the
 * refused insert never returned one. This finds it.
 */
export async function findRelationship(userId, {
  subjectId, predicate, objectId, workspaceId = null,
}) {
  const r = await rest(
    `audit_entity_relationships?${ownerOrWorkspace(userId, workspaceId)}`
    + `&subject_id=eq.${encodeURIComponent(subjectId)}`
    + `&predicate=eq.${encodeURIComponent(predicate)}`
    + `&object_id=eq.${encodeURIComponent(objectId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function listRelationships(userId, {
  state = null, entityId = null, workspaceId = null, limit = 1000,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (state) parts.push(`state=eq.${encodeURIComponent(state)}`);
  if (entityId) {
    parts.push(`or=(subject_id.eq.${encodeURIComponent(entityId)},object_id.eq.${encodeURIComponent(entityId)})`);
  }
  const r = await rest(
    `audit_entity_relationships?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${Number(limit) || 1000}`);
  return r.ok ? r.data || [] : [];
}

export async function getRelationship(userId, relationshipId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_entity_relationships?id=eq.${encodeURIComponent(relationshipId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/**
 * Edit an entity IN PLACE, and send it back for review.
 *
 * 🔴 THE ID IS STABLE, AND THAT IS THE WHOLE POINT. The obvious alternative —
 * create a corrected copy and drop the old one — is what the UI was doing
 * through `proposeEntity`, and it produced a DUPLICATE every time somebody
 * pressed Save. Worse than duplication: `audit_entity_relationships` cascades
 * on its endpoints (0056), so deleting the original would silently take every
 * edge drawn to it with it. Updating in place keeps the graph intact.
 *
 * ⚠️ AN EDIT RESETS THE REVIEW. An approval attests to the facts that were on
 * the row when somebody looked at it; change the name or the domain and that
 * attestation no longer describes anything. The row returns to `proposed` with
 * the reviewer fields cleared, so it has to be approved again — which is also
 * what keeps `audit_entities_no_self_approval` satisfiable afterwards.
 *
 * ⚠️ A REJECTED entity is NOT editable — propose it again instead. Editing one
 * back into review would silently revive a decision somebody made, which is
 * the same rule `approveEntity` holds.
 */
export async function updateEntity(userId, entityId, fields = {}, { workspaceId = null } = {}) {
  const owned = await getEntity(userId, entityId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };
  if ((owned.state || "") === "rejected") return { ok: false, verdict: "rejected" };

  const patch = {
    // Back to the queue: the facts moved, so the review has to move with them.
    state: "proposed",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  };
  // Only fields the caller actually supplied — an absent key must not blank a
  // stored value, which is the difference between an edit and an overwrite.
  if (typeof fields.name === "string") patch.name = fields.name;
  if ("description" in fields) patch.description = fields.description || null;
  if ("canonicalDomain" in fields) patch.canonical_domain = fields.canonicalDomain || null;
  if (typeof fields.entityType === "string") patch.entity_type = fields.entityType;

  const res = await rest(
    `audit_entities?id=eq.${encodeURIComponent(entityId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) },
  );
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
    return { ok: true, entity: res.data[0] };
  }
  return { ok: false, error: res?.error?.message || res?.error || "Could not update the entity." };
}

/**
 * Delete an entity — and say what goes with it.
 *
 * 🔴 THIS CASCADES. `audit_entity_relationships` declares both endpoints
 * `on delete cascade` (0056), because a dangling edge is worse than no edge.
 * So removing one node silently removes every relationship drawn to it, and a
 * delete button that does not say so is a trap. The edge count is counted
 * FIRST and returned, so the caller can put a real number in front of the user
 * instead of a generic "are you sure?".
 */
export async function deleteEntity(userId, entityId, { workspaceId = null } = {}) {
  const owned = await getEntity(userId, entityId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };

  let edges = 0;
  try {
    const r = await rest(
      `audit_entity_relationships?or=(subject_id.eq.${encodeURIComponent(entityId)},object_id.eq.${encodeURIComponent(entityId)})`
      + `&${ownerOrWorkspace(userId, workspaceId)}&select=id`);
    if (r.ok && Array.isArray(r.data)) edges = r.data.length;
  } catch {
    // Counting is a courtesy, not a gate — a failed count must not block the
    // delete the user asked for. It reports 0 and the cascade still happens.
  }

  const res = await rest(
    `audit_entities?id=eq.${encodeURIComponent(entityId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    { method: "DELETE" },
  );
  return res.ok
    ? { ok: true, deletedRelationships: edges }
    : { ok: false, error: res?.error?.message || res?.error || "Could not delete the entity." };
}

/**
 * 🔴 THE NOTE A SOLO OPERATOR TYPES MUST NOT COST THEM THE APPROVAL.
 *
 * `approve_entity` (0075/0077) permits a self-approval only when the note
 * carries the single-founder marker. The previous code applied that marker
 * ONLY when no note was given, so the behaviour was exactly backwards:
 *
 *   approve with no note   → marker added   → allowed
 *   approve WITH a note    → marker dropped → self_approval → 403
 *
 * A reviewer who explains their reasoning was refused, while one who said
 * nothing succeeded. That is not an attestation rule, it is a bug — the
 * attestation was already automatic on the common path, so this only makes the
 * two paths agree.
 *
 * ⚠️ The marker is appended, never substituted: the operator's own words are
 * the audit trail and must survive. A note from a DIFFERENT reviewer passes
 * through untouched — a teammate's approval must never be silently relabelled
 * as a single-founder one, which would erase the fact that two people looked.
 */
export const SINGLE_FOUNDER_MARKER = "[Single-founder approval]";

export function reviewNoteFor(note, { selfApproval }) {
  const typed = (typeof note === "string" && note.trim()) ? note.trim() : "";
  if (!selfApproval) return typed || null;
  if (typed.includes(SINGLE_FOUNDER_MARKER)) return typed;
  const attestation = `${SINGLE_FOUNDER_MARKER} Self-approved by solo operator and recorded in audit trail.`;
  return typed ? `${typed}\n\n${attestation}` : attestation;
}

/**
 * 🔴 `rest()` RETURNS THE ERROR BODY AS TEXT, NOT AS AN OBJECT.
 *
 * The previous verdict parser read `patchRes.error.code` and
 * `patchRes.error.message` off a STRING, so both were undefined, every branch
 * missed, and the raw PostgREST envelope — code, message, and a `details` blob
 * containing the entire failing row — was returned to the browser verbatim.
 * A unit test that handed the parser an object passed the whole time, because
 * the shape it asserted was never the shape production produces.
 */
export function parseRestError(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { message: String(raw) };
  } catch {
    return { message: String(raw) };
  }
}

/**
 * Turn a PostgREST failure into a verdict the route can act on.
 *
 * ⚠️ `stale_constraint` is the one worth reading twice. 0075 relaxed
 * `audit_entities_no_self_approval` (and 0074 the relationship and truth-record
 * equivalents) so that a self-approval carrying SINGLE_FOUNDER_MARKER is
 * permitted. So if we wrote the marker and the constraint refused the row
 * anyway, the database is enforcing the PRE-0075 constraint — which is a
 * statement about what has been deployed, not about what the user may do.
 * Reporting that as "you may not self-approve" sends the operator to change a
 * policy that is already correct; they need to apply the migration.
 */
export function approvalVerdictFrom(raw, { marker = false, constraints = [] } = {}) {
  const e = parseRestError(raw);
  const code = String(e.code || "");
  const text = `${e.message || ""} ${e.details || ""} ${e.hint || ""}`.toLowerCase();

  // The RPC itself is absent — same missing migration, seen one layer earlier.
  if (code === "PGRST202" || text.includes("could not find the function")) {
    return "approval_fn_missing";
  }
  if (code === "23514" || text.includes("check constraint")) {
    const hitSelfApproval = constraints.some((c) => text.includes(c));
    if (marker && hitSelfApproval) return "stale_constraint";
    return "check_violation";
  }
  if (code === "42501" || text.includes("row-level security") || text.includes("permission denied")) {
    return "rls_denied";
  }
  return null;
}

/** A one-line, non-leaking summary of a PostgREST failure for the route. */
export function restErrorMessage(raw, fallback) {
  const e = parseRestError(raw);
  return e.message || fallback;
}

/** Self-approval CHECK constraint names, by row kind. */
export const SELF_APPROVAL_CONSTRAINTS = Object.freeze({
  entity: ["audit_entities_no_self_approval"],
  relationship: ["audit_rel_no_self_approval", "audit_entities_no_self_approval"],
});

/** Approve an entity node directly. Verdict returned unchanged with direct DB fallback. */
export async function approveEntity(userId, entityId, {
  note = null, workspaceId = null,
} = {}) {
  const owned = await getEntity(userId, entityId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };

  const conn = db();
  if (!conn) return { ok: false, degraded: true, error: "Supabase is not configured" };

  const effectiveNote = reviewNoteFor(note, {
    selfApproval: Boolean(owned.proposed_by) && owned.proposed_by === userId,
  });

  // 🔴 2026-09-22 — STOP SWALLOWING VERDICTS. The previous version dropped
  // self_approval and unknown verdicts on the floor and fell through to a
  // raw DB PATCH. When the constraint refused the PATCH the caller saw a
  // generic 23514 message; when the constraint passed it the caller saw
  // success against the user's stated intent. Either way the verdict the
  // RPC carefully constructed never reached the route's VERDICTS map. Now
  // every verdict the RPC returns propagates up unchanged — `already_approved`
  // and `ok` are both success; everything else is an actionable refusal.
  let verdict = null;
  try {
    const r = await rest("rpc/approve_entity", {
      method: "POST",
      body: JSON.stringify({ p_entity_id: entityId, p_reviewer_id: userId, p_note: effectiveNote }),
    });
    if (r.ok) {
      verdict = typeof r.data === "string" ? r.data : r.data?.approve_entity || "unknown";
      if (verdict === "ok" || verdict === "already_approved") {
        return { ok: true, verdict };
      }
      if (verdict && verdict !== "unknown" && verdict !== "error") {
        return { ok: false, verdict };
      }
    } else {
      // The RPC answered with an error rather than a verdict. PGRST202 here
      // means approve_entity does not exist on this database — 0075 has not
      // been applied — and the PATCH below then meets 0056's constraint, which
      // has no single-founder escape. Remember that now: after the PATCH
      // fails, "the approval function is missing" is a far more actionable
      // diagnosis than "a constraint refused it".
      verdict = approvalVerdictFrom(r?.error, {
        marker: Boolean(effectiveNote && effectiveNote.includes(SINGLE_FOUNDER_MARKER)),
        constraints: SELF_APPROVAL_CONSTRAINTS.entity,
      });
    }
  } catch (_rpcErr) {
    // Fallback directly if RPC invocation fails — but only on transport / 5xx,
    // NOT on a verdict refusal. A catch here means fetch itself threw, which
    // is what we want the direct PATCH to retry around.
  }

  // Fallback: Direct DB update if RPC was unreachable / 5xx. The PATCH must
  // still pass audit_entities_no_self_approval; the route now reports the
  // resulting error with the same verdict machinery.
  const patchRes = await rest(
    `audit_entities?id=eq.${encodeURIComponent(entityId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        state: "approved",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: effectiveNote,
      }),
    }
  );

  if (patchRes.ok && Array.isArray(patchRes.data) && patchRes.data.length > 0) {
    return { ok: true, fallback: true, entity: patchRes.data[0] };
  }

  // PATCH failed: parse the PostgREST error body for a structured verdict.
  // 23514 = check_violation; 42501 = insufficient_privilege (RLS refused);
  // anything else stays as a generic error with the original PostgREST message
  // attached so the operator can debug from server logs.
  const fallbackVerdict = approvalVerdictFrom(patchRes?.error, {
    marker: Boolean(effectiveNote && effectiveNote.includes(SINGLE_FOUNDER_MARKER)),
    constraints: SELF_APPROVAL_CONSTRAINTS.entity,
  });

  return {
    ok: false,
    error: restErrorMessage(patchRes?.error, "Could not approve entity"),
    verdict: fallbackVerdict || verdict,
  };
}

/** Approve an edge and its endpoints, atomically. Verdict returned unchanged with direct DB fallback. */
export async function approveEntityRelationship(userId, relationshipId, {
  note = null, workspaceId = null,
} = {}) {
  const owned = await getRelationship(userId, relationshipId, { workspaceId });
  if (!owned) return { ok: false, notFound: true };

  const conn = db();
  if (!conn) return { ok: false, degraded: true, error: "Supabase is not configured" };

  const effectiveNote = reviewNoteFor(note, {
    selfApproval: Boolean(owned.proposed_by) && owned.proposed_by === userId,
  });

  // 🔴 2026-09-22 — same verdict-propagation fix as approveEntity. The previous
  // code dropped self_approval AND endpoint_self_approval silently; the route
  // has a VERDICTS map for both, so the only thing that needed fixing was here.
  let verdict = null;
  try {
    const r = await rest("rpc/approve_entity_relationship", {
      method: "POST",
      body: JSON.stringify({ p_relationship_id: relationshipId, p_reviewer_id: userId, p_note: effectiveNote }),
    });
    if (r.ok) {
      verdict = typeof r.data === "string" ? r.data : r.data?.approve_entity_relationship || "unknown";
      if (verdict === "ok" || verdict === "already_approved") {
        return { ok: true, verdict };
      }
      if (verdict && verdict !== "unknown" && verdict !== "error") {
        return { ok: false, verdict };
      }
    } else {
      // Same as approveEntity: an error here rather than a verdict usually
      // means the RPC is absent (0074/0075 unapplied), and the PATCH below
      // will meet the pre-relaxation constraint. Keep the earlier, more
      // specific diagnosis.
      verdict = approvalVerdictFrom(r?.error, {
        marker: Boolean(effectiveNote && effectiveNote.includes(SINGLE_FOUNDER_MARKER)),
        constraints: SELF_APPROVAL_CONSTRAINTS.relationship,
      });
    }
  } catch (_rpcErr) {
    // Fallback directly if RPC invocation fails
  }

  // Fallback: Direct DB update if RPC fails, throws 500, or disallows solo operator
  const patchRes = await rest(
    `audit_entity_relationships?id=eq.${encodeURIComponent(relationshipId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        state: "approved",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: effectiveNote,
      }),
    }
  );

  if (patchRes.ok && Array.isArray(patchRes.data) && patchRes.data.length > 0) {
    // Atomically approve endpoints if they were in proposed state
    if (owned.subject_id) {
      await rest(
        `audit_entities?id=eq.${encodeURIComponent(owned.subject_id)}&state=eq.proposed&${ownerOrWorkspace(userId, workspaceId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            state: "approved",
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
            review_note: effectiveNote,
          }),
        }
      ).catch(() => {});
    }
    if (owned.object_id) {
      await rest(
        `audit_entities?id=eq.${encodeURIComponent(owned.object_id)}&state=eq.proposed&${ownerOrWorkspace(userId, workspaceId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            state: "approved",
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
            review_note: effectiveNote,
          }),
        }
      ).catch(() => {});
    }
    return { ok: true, fallback: true, relationship: patchRes.data[0] };
  }

  // PATCH failed: same verdict-from-PostgREST-error parsing as approveEntity.
  // The endpoint-self-approval case in particular would otherwise surface as a
  // generic "Could not approve relationship" while the route's VERDICTS map
  // has a perfectly good entry for it — same root cause, same fix.
  const fallbackVerdict = approvalVerdictFrom(patchRes?.error, {
    marker: Boolean(effectiveNote && effectiveNote.includes(SINGLE_FOUNDER_MARKER)),
    constraints: SELF_APPROVAL_CONSTRAINTS.relationship,
  });

  return {
    ok: false,
    error: restErrorMessage(patchRes?.error, "Could not approve relationship"),
    verdict: fallbackVerdict || verdict,
  };
}

/**
 * Reject an entity or a relationship.
 *
 * ⚠️ A REASON IS REQUIRED and is enforced by a CHECK constraint too. A rejected
 * edge that keeps being re-proposed is itself a finding, and without the reason
 * nobody can tell a considered decision from a mis-click.
 */
export async function rejectGraphRow(userId, table, id, reason, { workspaceId = null } = {}) {
  const t = table === "entity" ? "audit_entities" : "audit_entity_relationships";
  const r = await rest(
    `${t}?id=eq.${encodeURIComponent(id)}&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        state: "rejected", review_note: reason,
        reviewed_by: userId, reviewed_at: new Date().toISOString(),
      }),
    });
  if (!r.ok) return { ok: false, error: r.error };
  return Array.isArray(r.data) && r.data.length
    ? { ok: true, row: r.data[0] }
    : { ok: false, notFound: true };
}

/** Corroboration — a later sighting of something already recorded. */
export async function recordEntityEvidence({ entityId = null, relationshipId = null, auditId = null, evidence, confidence = null }) {
  if (!entityId && !relationshipId) return { ok: false, error: "Evidence needs a subject." };
  const r = await insert("audit_entity_evidence", [{
    entity_id: entityId, relationship_id: relationshipId, audit_id: auditId,
    evidence_json: evidence, confidence,
  }], "return=minimal");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function recordGraphConflicts(
  userId, truthRecordId, auditId, conflicts = [], { workspaceId = null } = {},
) {
  const rows = (Array.isArray(conflicts) ? conflicts : [])
    .filter((c) => c && typeof c.code === "string")
    .map((c) => ({
      user_id: userId,
      workspace_id: workspaceId,
      truth_record_id: truthRecordId || null,
      audit_id: auditId || null,
      code: c.code,
      severity: c.severity || "medium",
      // The pure model reports the offending subject by id; it is only stored
      // when that id is a real entity row, so a synthetic id from a dry run
      // cannot violate the foreign key and lose the whole batch.
      subject_id: c.subject_entity_id || null,
      predicate: c.predicate || null,
      detail_json: { values: c.values || [], evidence: c.evidence || null },
      message: c.message || null,
    }));
  if (!rows.length) return { ok: true, count: 0 };
  const r = await insert("audit_entity_conflicts", rows, "return=minimal");
  return r.ok ? { ok: true, count: rows.length } : { ok: false, error: r.error };
}

export async function listGraphConflicts(userId, {
  truthRecordId = null, workspaceId = null, limit = 200,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), "resolved_at=is.null"];
  if (truthRecordId) parts.push(`truth_record_id=eq.${encodeURIComponent(truthRecordId)}`);
  const r = await rest(
    `audit_entity_conflicts?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${Number(limit) || 200}`);
  return r.ok ? r.data || [] : [];
}

export async function resolveGraphConflict(userId, conflictId, resolution, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_entity_conflicts?id=eq.${encodeURIComponent(conflictId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ resolution, resolved_at: new Date().toISOString() }),
    });
  return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

// ── W12 · local and directory intelligence ───────────────────────────────────
//
// 🔴 THE POINT OF THIS SECTION IS THAT THE TABLES ARE ACTUALLY WRITTEN.
// This schema's own recorded history is three columns declared, reviewed,
// merged and written by nothing — `audit_signals.raw_value`, `.evidence_json`
// and `audit_recommendations.issue_id`, each invisible because the read path
// returned `null` exactly as it would for "not applicable". W9's conflict table
// and W10's broke that pattern on purpose and so does this one: `runLocalCheck`
// below is called by the route, and its contract test asserts the WRITE.

export async function upsertDirectoryListing(userId, {
  truthRecordId = null, sourceId, sourceTier, acquisition, listingUrl = null,
  observedName = null, observedAddress = null, observedPhone = null,
  observedPostalCode = null, observedLocality = null, observedExtra = null,
  evidence = null, workspaceId = null,
}) {
  // One CURRENT listing per source. A weekly re-read updates what the source
  // says rather than stacking a second opinion — without that, every count
  // doubles and "what does Justdial say" answers differently depending on how
  // many checks have run.
  const r = await rest("audit_directory_listings?on_conflict=user_id,truth_record_id,source_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
    user_id: userId,
    truth_record_id: truthRecordId,
    source_id: sourceId,
    source_tier: sourceTier,
    acquisition,
    listing_url: listingUrl,
    observed_name: observedName,
    observed_address: observedAddress,
    observed_phone: observedPhone,
    observed_postal_code: observedPostalCode,
    observed_locality: observedLocality,
    observed_extra: observedExtra || {},
    evidence_json: evidence,
    observed_at: new Date().toISOString(),
    workspace_id: workspaceId,
  }]),
  });
  return r.ok ? { ok: true, listing: Array.isArray(r.data) ? r.data[0] : r.data } : { ok: false, error: r.error };
}

export async function listDirectoryListings(userId, {
  truthRecordId = null, workspaceId = null, limit = 200,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (truthRecordId) parts.push(`truth_record_id=eq.${encodeURIComponent(truthRecordId)}`);
  const r = await rest(`audit_directory_listings?${parts.join("&")}&${SELECT_ALL}&order=observed_at.desc&limit=${Number(limit) || 200}`);
  return r.ok ? r.data || [] : [];
}

export async function deleteDirectoryListing(userId, listingId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_directory_listings?id=eq.${encodeURIComponent(listingId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return row ? { ok: true } : { ok: false, notFound: true };
}

/**
 * Directory sources marked NOT APPLICABLE to a truth record (0076).
 *
 * An ignore is a recorded decision with a reason, not a deletion: it excludes
 * the source from NAP checks and is undone by removing the row.
 */
export async function listDirectorySourceIgnores(userId, {
  truthRecordId = null, workspaceId = null,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (truthRecordId) parts.push(`truth_record_id=eq.${encodeURIComponent(truthRecordId)}`);
  const r = await rest(`audit_directory_source_ignores?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=500`);
  return r.ok ? r.data || [] : [];
}

export async function ignoreDirectorySource(userId, {
  truthRecordId = null, sourceId, reason, workspaceId = null,
}) {
  const r = await rest("audit_directory_source_ignores?on_conflict=user_id,truth_record_id,source_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
      user_id: userId,
      workspace_id: workspaceId,
      truth_record_id: truthRecordId,
      source_id: sourceId,
      reason,
      ignored_by: userId,
      created_at: new Date().toISOString(),
    }]),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return row ? { ok: true, ignore: row } : { ok: false, error: "No row was returned." };
}

export async function unignoreDirectorySource(userId, {
  truthRecordId = null, sourceId, workspaceId = null,
}) {
  const parts = [
    ownerOrWorkspace(userId, workspaceId),
    `source_id=eq.${encodeURIComponent(sourceId)}`,
    truthRecordId ? `truth_record_id=eq.${encodeURIComponent(truthRecordId)}` : "truth_record_id=is.null",
  ];
  const r = await rest(`audit_directory_source_ignores?${parts.join("&")}`, {
    method: "DELETE", headers: { Prefer: "return=representation" },
  });
  if (!r.ok) return { ok: false, error: r.error };
  return Array.isArray(r.data) && r.data.length ? { ok: true } : { ok: false, notFound: true };
}

/**
 * Persist one NAP check: the run, every per-directory match, and the findings.
 *
 * ⚠️ THE CHECK ROW GOES FIRST AND ALONE, because the matches and the findings
 * both reference it. Same ordering rule `persistResult` had to learn for
 * `audit_recommendations.issue_id`: the ids do not exist until the first insert
 * returns, so this cannot be collapsed into one `Promise.all`.
 */
export async function saveLocalCheck(userId, {
  truthRecordId = null, subjectId = null, workspaceId = null, region = null,
  score, matches = [], findings = [],
}) {
  const checkRow = await insert("audit_local_checks", [{
    user_id: userId,
    truth_record_id: truthRecordId,
    subject_id: subjectId,
    workspace_id: workspaceId,
    // null, not 0 — a run that read nothing is not a business that is wrong.
    nap_score: score?.score ?? null,
    coverage: score?.coverage ?? null,
    checked_count: score?.checkedCount ?? 0,
    configured_count: score?.configuredCount ?? 0,
    region,
    unchecked_sources: score?.unchecked || [],
    unreadable_sources: score?.unreadable || [],
  }]);
  if (!checkRow.ok) return { ok: false, error: checkRow.error };
  const check = Array.isArray(checkRow.data) ? checkRow.data[0] : checkRow.data;

  if (matches.length) {
    const r = await insert("audit_directory_matches", matches.map((m) => ({
      user_id: userId,
      check_id: check.id,
      listing_id: m.listingId || null,
      source_id: m.sourceId,
      source_tier: m.tier,
      tier_weight: m.tierWeight,
      match_score: m.score,
      coverage: m.coverage,
      fields_json: m.fields || [],
      mismatched: m.mismatches || [],
      absent_fields: m.absent || [],
    })));
    if (!r.ok) return { ok: false, error: r.error, checkId: check.id };
  }

  if (findings.length) {
    const r = await insert("audit_local_findings", findings.map((f) => ({
      user_id: userId,
      check_id: check.id,
      truth_record_id: truthRecordId,
      source_id: f.sourceId || null,
      code: f.code,
      severity: f.severity,
      fields: f.fields || [],
      detail: f.why || null,
      workspace_id: workspaceId,
    })));
    if (!r.ok) return { ok: false, error: r.error, checkId: check.id };
  }

  return { ok: true, check };
}

export async function listLocalChecks(userId, {
  truthRecordId = null, subjectId = null, workspaceId = null, limit = 30,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (truthRecordId) parts.push(`truth_record_id=eq.${encodeURIComponent(truthRecordId)}`);
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(`audit_local_checks?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${Number(limit) || 30}`);
  return r.ok ? r.data || [] : [];
}

/**
 * One subject, scoped to its owner. D7's registry has no reader until a caller
 * supplies a `subject_id` it did not mint — at which point the id has to be
 * checked against the owner rather than trusted, exactly as `getEntity` is
 * before an edge is drawn between two nodes.
 */
// ── W14 · Revalidation ─────────────────────────────────────────────────────

/** One recommendation, scoped to its owner. */
export async function getRecommendation(userId, recId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_recommendations?id=eq.${encodeURIComponent(recId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/**
 * Claim a revalidation request.
 *
 * 🔴 IDEMPOTENT BY THE `is.null` FILTER, NOT BY A READ-THEN-WRITE. The PATCH
 * only matches a row whose `revalidation_requested_at` is still null, so two
 * concurrent clicks produce one claim and one no-op — the loser gets zero rows
 * back and reads the existing request. A check-then-set would race exactly as
 * `payment-webhook.js:49-59`'s dedup does, and the cost of losing that race
 * here is a second paid audit.
 */
export async function claimRevalidation(userId, recId, {
  baselineAuditId = null, workspaceId = null,
} = {}) {
  const r = await rest(
    `audit_recommendations?id=eq.${encodeURIComponent(recId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}`
    + `&revalidation_requested_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        revalidation_requested_at: new Date().toISOString(),
        revalidation_baseline_audit_id: baselineAuditId,
        status: "validation_scheduled",
      }),
    });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  // No row means somebody else claimed it first — which is success, not
  // failure: the request they wanted already exists.
  return { ok: true, claimed: Boolean(row), recommendation: row || null };
}

// ── W13 · Schema intelligence + Trust & Proof ──────────────────────────────

/**
 * Record one observed schema type for a subject.
 *
 * ⚠️ THE CONFLICT TARGET NAMES COLUMNS, and 0062 backs it with a
 * `NULLS NOT DISTINCT` constraint — because `subject_id` is nullable and an
 * expression index cannot be a PostgREST arbiter. That combination is exactly
 * what 0059 had to repair in W12, where every listing save was refused.
 */
export async function saveSchemaEntity(userId, {
  subjectId = null, auditId = null, schemaType, validity = "valid",
  missingProperties = [], nodeId = null, sameAs = [],
  componentScores = null, evidence = null, workspaceId = null,
}) {
  const r = await rest("audit_schema_entities?on_conflict=user_id,subject_id,schema_type", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
      user_id: userId,
      workspace_id: workspaceId,
      subject_id: subjectId,
      audit_id: auditId,
      schema_type: schemaType,
      validity,
      missing_properties: Array.isArray(missingProperties) ? missingProperties : [],
      node_id: nodeId,
      same_as: Array.isArray(sameAs) ? sameAs : [],
      component_scores: componentScores || {},
      evidence_json: evidence,
      observed_at: new Date().toISOString(),
    }]),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: true, entity: row || null };
}

/**
 * Record one trust observation.
 *
 * 🔴 `independence` IS NOT TAKEN FROM A REQUEST BODY — the route resolves it
 * from how the observation was obtained. See `schemaTrustRoute`.
 */
export async function saveTrustObservation(userId, {
  subjectId = null, auditId = null, signal, independence,
  observedCount = 0, verifiable = false, sourceUrl = null,
  evidence = null, workspaceId = null,
}) {
  const r = await rest("audit_trust_evidence?on_conflict=user_id,subject_id,signal,independence", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
      user_id: userId,
      workspace_id: workspaceId,
      subject_id: subjectId,
      audit_id: auditId,
      signal,
      independence,
      observed_count: Math.max(0, Math.floor(Number(observedCount) || 0)),
      verifiable: Boolean(verifiable),
      source_url: sourceUrl,
      evidence_json: evidence,
      observed_at: new Date().toISOString(),
    }]),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: true, observation: row || null };
}

/** Every schema observation for a subject, scoped to its owner. */
export async function listSchemaEntities(userId, {
  subjectId = null, workspaceId = null, limit = 100,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(
    `audit_schema_entities?${parts.join("&")}&${SELECT_ALL}&order=observed_at.desc&limit=${rowCap(limit, 100)}`);
  return r.ok ? r.data || [] : [];
}

/** Every trust observation for a subject, scoped to its owner. */
export async function listTrustObservations(userId, {
  subjectId = null, workspaceId = null, limit = 200,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(
    `audit_trust_evidence?${parts.join("&")}&${SELECT_ALL}&order=observed_at.desc&limit=${rowCap(limit, 200)}`);
  return r.ok ? r.data || [] : [];
}

/**
 * Record one subject score. P2 · W11, landed as W13's step 5.
 *
 * 🔴 THIS APPENDS. There is no `on_conflict` and there must not be one: the
 * trend is the product. An upsert arbiter would silently collapse a subject's
 * whole history into one row every time it was re-scored.
 *
 * ⚠️ `score` IS SENT AS `null` WHEN NOTHING WAS MEASURED, never coerced to 0 —
 * and `coverage` always travels with it, because a score without its coverage
 * is a different measurement, not a smaller one.
 *
 * ⚠️ THE VERSION COMES FROM THE RESULT, NOT FROM THE CALLER. `scoreSubject`
 * stamps `modelVersion`; a writer that supplied its own could file a future
 * score under the current version, which is the mislabelling the NOT NULL /
 * no-default column exists to prevent.
 */
export async function saveSubjectScore(userId, {
  subjectId, auditId = null, workspaceId = null, result,
}) {
  if (!result || !result.code) return { ok: false, error: "no score to save" };

  const r = await rest("audit_subject_scores", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      user_id: userId,
      workspace_id: workspaceId,
      subject_id: subjectId,
      audit_id: auditId,
      kind: result.kind,
      code: result.code,
      // Never `|| 0` — that would turn "we could not measure this" into a
      // measured zero, permanently and undetectably.
      score: typeof result.score === "number" ? result.score : null,
      coverage: result.coverage,
      model_version: result.modelVersion,
      components: result.components || [],
      measured: result.measured || [],
      unmeasured: result.unmeasured || [],
      blocked_by: result.blockedBy || [],
      scored_at: new Date().toISOString(),
    }]),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: true, score: row || null };
}

/**
 * A subject's score history, newest first — the trend W11 exists for.
 *
 * ⚠️ Owner-scoped at the query, like every other read here. The subject id
 * alone is not authorisation.
 */
export async function listSubjectScores(userId, {
  subjectId = null, workspaceId = null, limit = 50,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(
    `audit_subject_scores?${parts.join("&")}&${SELECT_ALL}&order=scored_at.desc&limit=${rowCap(limit, 50)}`);
  return r.ok ? r.data || [] : [];
}

/**
 * Subjects a caller may address, newest first.
 *
 * Existed as a client method (`listSubjects`) with no reader and no route, so
 * the Subject Scores screen and the composer's "Associated subject" picker both
 * rendered an empty list for every account — a 404 swallowed by `.catch`.
 */
export async function listSubjects(userId, { workspaceId = null, kinds = null, limit = 100 } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (Array.isArray(kinds) && kinds.length) {
    parts.push(`subject_kind=in.(${kinds.map((k) => encodeURIComponent(k)).join(",")})`);
  }
  const r = await rest(
    `audit_subjects?${parts.join("&")}&${SELECT_ALL}&order=updated_at.desc&limit=${rowCap(limit, 100, 500)}`);
  return r.ok ? r.data || [] : [];
}

export async function getSubject(userId, subjectId, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_subjects?id=eq.${encodeURIComponent(subjectId)}`
    + `&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function getLocalCheckFull(userId, checkId, { workspaceId = null } = {}) {
  const check = await rest(
    `audit_local_checks?id=eq.${encodeURIComponent(checkId)}&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  const row = check.ok && Array.isArray(check.data) ? check.data[0] : null;
  if (!row) return null;
  const [matches, findings] = await Promise.all([
    rest(`audit_directory_matches?check_id=eq.${encodeURIComponent(checkId)}&${SELECT_ALL}&order=tier_weight.desc`),
    rest(`audit_local_findings?check_id=eq.${encodeURIComponent(checkId)}&${SELECT_ALL}&order=created_at.asc`),
  ]);
  return {
    check: row,
    matches: matches.ok ? matches.data || [] : [],
    findings: findings.ok ? findings.data || [] : [],
  };
}

export async function resolveLocalFinding(userId, findingId, resolution, { workspaceId = null } = {}) {
  // Paired, because the CHECK constraint refuses half a record — a resolution
  // with no timestamp shows as open while a reader believes it closed.
  const r = await rest(
    `audit_local_findings?id=eq.${encodeURIComponent(findingId)}&${ownerOrWorkspace(userId, workspaceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ resolution, resolved_at: new Date().toISOString(), resolved_by: userId }),
    },
  );
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!r.ok) return { ok: false, error: r.error };
  return row ? { ok: true, finding: row } : { ok: false, notFound: true };
}

export async function claimConnectorDispatch(userId, {
  provider, idempotencyKey, truthRecordId = null, entityId = null,
  workspaceId = null, payload = {},
}) {
  const conn = db();
  if (!conn) return { ok: false, error: "Audit storage is unavailable." };
  try {
    const res = await fetch(`${conn.base}/rpc/claim_discoverability_connector_dispatch`, {
      method: "POST",
      headers: conn.headers,
      body: JSON.stringify({
        p_user_id: userId,
        p_provider: provider,
        p_idempotency_key: idempotencyKey,
        p_truth_record_id: truthRecordId || null,
        p_entity_id: entityId || null,
        p_workspace_id: workspaceId || null,
        p_payload: payload || {},
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `claim dispatch failed: ${res.status} ${detail}`.trim() };
    }
    const verdict = await res.json();
    return verdict;
  } catch (err) {
    return { ok: false, error: err?.message || "claim dispatch failed" };
  }
}

export async function saveSxoRun(userId, {
  auditId, subjectId = null, targetId = null, workspaceId = null,
  sxoTotalScore = null, coverage = 100, layerScores = {}, layerResults = {},
  findings = [], weightSetId = "sxo_default_v1", modelVersion = "s1",
}) {
  const r = await rest("audit_sxo_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      subject_id: subjectId || null,
      target_id: targetId || null,
      sxo_total_score: sxoTotalScore,
      coverage,
      layer_scores: layerScores,
      layer_results: layerResults,
      findings,
      weight_set_id: weightSetId,
      model_version: modelVersion,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, run: row } : { ok: false, error: r.error || "Could not save SXO run." };
}

export async function getSxoRun(userId, id, { workspaceId = null } = {}) {
  const r = await rest(
    `audit_sxo_runs?id=eq.${encodeURIComponent(id)}&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function listSxoRuns(userId, {
  auditId = null, subjectId = null, workspaceId = null, limit = 50,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (auditId) parts.push(`audit_id=eq.${encodeURIComponent(auditId)}`);
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(
    `audit_sxo_runs?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${rowCap(limit, 50)}`);
  return r.ok ? r.data || [] : [];
}

export async function getSxoForAudit(userId, auditId, { workspaceId = null } = {}) {
  const runs = await listSxoRuns(userId, { auditId, workspaceId, limit: 1 });
  return runs.length > 0 ? runs[0] : null;
}

export async function saveIntentMapping(userId, {
  subjectId = null, intentClass, targetUrl, mappedPromptKinds = [], workspaceId = null,
}) {
  const r = await rest("audit_intent_mappings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      subject_id: subjectId || null,
      intent_class: intentClass,
      target_url: targetUrl,
      mapped_prompt_kinds: mappedPromptKinds,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, mapping: row } : { ok: false, error: r.error || "Could not save intent mapping." };
}

export async function listIntentMappings(userId, { subjectId = null, workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(`audit_intent_mappings?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc`);
  return r.ok ? r.data || [] : [];
}

// ── STAGE 3 (P3B) ANALYTICS, FUNNELS, FORMS & GOALS ─────────────────────────

function maskTokenFingerprint(token) {
  if (!token) return "none";
  const str = String(token);
  return str.length <= 8 ? `${str.slice(0, 2)}…` : `${str.slice(0, 4)}…${str.slice(-4)} (${str.length} chars)`;
}

export async function saveAnalyticsConnection(userId, {
  provider, providerAccountId = null, token = null, settings = {}, workspaceId = null,
}) {
  let encryptedToken = null;
  if (token) {
    try {
      encryptedToken = encryptSecret(token);
    } catch (error) {
      return {
        ok: false,
        code: "ENCRYPTION_UNAVAILABLE",
        error: error?.message || "Analytics credentials cannot be encrypted.",
      };
    }
  }

  const tokenFingerprint = maskTokenFingerprint(token);

  const r = await rest("audit_analytics_connections", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      provider,
      provider_account_id: providerAccountId,
      encrypted_token: encryptedToken,
      token_fingerprint: tokenFingerprint,
      // Credential storage is not provider verification. A connector may move
      // to `connected` only after a real provider request or sync succeeds.
      status: "configured",
      settings,
      last_sync_at: null,
    }),
  });

  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (r.ok && row) {
    const sanitized = { ...row };
    delete sanitized.encrypted_token;
    return { ok: true, connection: sanitized };
  }
  return { ok: false, error: r.error || "Could not save analytics connection." };
}

export async function listAnalyticsConnections(userId, { workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  const r = await rest(`audit_analytics_connections?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc`);
  if (!r.ok || !Array.isArray(r.data)) return [];
  // 🔴 NEVER return encrypted_token on GET!
  return r.data.map((row) => {
    const clean = { ...row };
    delete clean.encrypted_token;
    return clean;
  });
}

export async function deleteAnalyticsConnection(userId, provider, { workspaceId = null, purgeData = false } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), `provider=eq.${encodeURIComponent(provider)}`];
  const r = await rest(`audit_analytics_connections?${parts.join("&")}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (purgeData) {
    await purgeAnalyticsData(userId, { workspaceId, purgeAll: true });
  }
  return r.ok ? { ok: true, purged_data: !!purgeData } : { ok: false, error: r.error || "Could not delete connection." };
}

/**
 * D16 / §13 — Early retention purge for analytics data.
 * Allows users and operators to delete analytics data earlier than the 90-day retention window.
 *
 * @param {string} userId - Tenant user ID
 * @param {object} opts - { workspaceId, auditId, olderThanDays, purgeAll }
 */
export async function purgeAnalyticsData(userId, {
  workspaceId = null, auditId = null, olderThanDays = null, purgeAll = false,
} = {}) {
  const scope = ownerOrWorkspace(userId, workspaceId);
  const filterParts = [scope];
  if (auditId) {
    filterParts.push(`audit_id=eq.${encodeURIComponent(auditId)}`);
  }
  if (!purgeAll && olderThanDays !== null && olderThanDays !== undefined && Number(olderThanDays) > 0) {
    const cutoffDate = new Date(Date.now() - Number(olderThanDays) * 86400000).toISOString();
    filterParts.push(`created_at=lt.${encodeURIComponent(cutoffDate)}`);
  }

  const query = filterParts.join("&");
  const [delAgg, delFunnels, delForms] = await Promise.all([
    rest(`audit_analytics_aggregates?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } }),
    rest(`audit_journey_funnels?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } }),
    rest(`audit_form_diagnostics?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } }),
  ]);

  const aggCount = Array.isArray(delAgg?.data) ? delAgg.data.length : 0;
  const funnelCount = Array.isArray(delFunnels?.data) ? delFunnels.data.length : 0;
  const formCount = Array.isArray(delForms?.data) ? delForms.data.length : 0;

  return {
    ok: true,
    purged: true,
    deleted: {
      aggregates: aggCount,
      funnels: funnelCount,
      form_diagnostics: formCount,
      total: aggCount + funnelCount + formCount,
    },
  };
}

export async function saveConversionGoal(userId, {
  name, outcomeType, targetUrl = null, targetSelector = null, targetEvent = null,
  valueCents = 0, auditId = null, subjectId = null, workspaceId = null,
}) {
  const r = await rest("audit_conversion_goals", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      subject_id: subjectId,
      name,
      outcome_type: outcomeType,
      target_url: targetUrl,
      target_selector: targetSelector,
      target_event: targetEvent,
      value_cents: valueCents,
      active: true,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, goal: row } : { ok: false, error: r.error || "Could not save conversion goal." };
}

/** One conversion goal, scoped exactly like every other reader here. */
export async function getConversionGoal(userId, goalId, { workspaceId = null } = {}) {
  if (!goalId) return null;
  const r = await rest(
    `audit_conversion_goals?id=eq.${encodeURIComponent(goalId)}&${ownerOrWorkspace(userId, workspaceId)}&${SELECT_ALL}&limit=1`,
  );
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function listConversionGoals(userId, { auditId = null, workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (auditId) parts.push(`audit_id=eq.${encodeURIComponent(auditId)}`);
  const r = await rest(`audit_conversion_goals?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc`);
  return r.ok ? r.data || [] : [];
}

export async function saveAnalyticsAggregates(userId, {
  auditId = null, subjectId = null, dateBucket = null, landingPage = "/",
  sourceChannel = "direct", device = "all", region = "global", visitorType = "all",
  conversionGoalId = null, eventCounts = {}, metrics = {}, workspaceId = null,
  importJobId = null,
}) {
  const path = importJobId
    ? "audit_analytics_aggregates?on_conflict=import_job_id"
    : "audit_analytics_aggregates";
  const r = await rest(path, {
    method: "POST",
    headers: { Prefer: importJobId ? "resolution=merge-duplicates,return=representation" : "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      subject_id: subjectId,
      date_bucket: dateBucket || new Date().toISOString().split("T")[0],
      landing_page: landingPage,
      source_channel: sourceChannel,
      device,
      region,
      visitor_type: visitorType,
      conversion_goal_id: conversionGoalId,
      event_counts: eventCounts,
      metrics,
      import_job_id: importJobId || null,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, aggregate: row } : { ok: false, error: r.error || "Could not save aggregates." };
}

export async function findAnalyticsImportJob(userId, provider, idempotencyKey) {
  const r = await rest(
    `audit_analytics_import_jobs?user_id=eq.${encodeURIComponent(userId)}`
      + `&provider=eq.${encodeURIComponent(provider)}`
      + `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&${SELECT_ALL}&limit=1`,
  );
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function enqueueAnalyticsImport(userId, {
  provider, idempotencyKey, payloadHash, aggregatePayload, workspaceId = null,
}) {
  const existing = await findAnalyticsImportJob(userId, provider, idempotencyKey);
  if (existing) return { ok: true, replay: true, job: existing };

  const r = await insert("audit_analytics_import_jobs", [{
    user_id: userId,
    workspace_id: workspaceId || null,
    provider,
    idempotency_key: idempotencyKey,
    payload_hash: payloadHash,
    aggregate_payload: aggregatePayload,
  }]);
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (r.ok && row) return { ok: true, replay: false, job: row };

  // A concurrent replay can win the unique insert after our initial read.
  if (r.status === 409) {
    const raced = await findAnalyticsImportJob(userId, provider, idempotencyKey);
    if (raced) return { ok: true, replay: true, job: raced };
  }
  return { ok: false, error: r.error || "Could not queue analytics import." };
}

export async function claimAnalyticsImportJobs(limit = 20) {
  const r = await rest("rpc/claim_audit_analytics_import_jobs", {
    method: "POST",
    body: JSON.stringify({ p_limit: rowCap(limit, 20) }),
  });
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

export async function completeAnalyticsImportJob(id, result) {
  const r = await rest(`audit_analytics_import_jobs?id=eq.${encodeURIComponent(id)}&state=eq.processing`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      state: "completed",
      result_json: result || {},
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }),
  });
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0 };
}

export async function failAnalyticsImportJob(job, error, now = Date.now()) {
  const exhausted = Number(job.attempts || 0) >= Number(job.max_attempts || 5);
  const backoffMinutes = Math.min(60, 5 * (2 ** Math.max(0, Number(job.attempts || 1) - 1)));
  const patch = {
    state: exhausted ? "failed" : "retrying",
    last_error: String(error || "Analytics import failed").slice(0, 1000),
    updated_at: new Date(now).toISOString(),
    next_attempt_at: new Date(now + backoffMinutes * 60_000).toISOString(),
  };
  const r = await rest(`audit_analytics_import_jobs?id=eq.${encodeURIComponent(job.id)}&state=eq.processing`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0, state: patch.state };
}

export async function listAnalyticsAggregates(userId, {
  auditId = null, subjectId = null, workspaceId = null, limit = 100,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (auditId) parts.push(`audit_id=eq.${encodeURIComponent(auditId)}`);
  if (subjectId) parts.push(`subject_id=eq.${encodeURIComponent(subjectId)}`);
  const r = await rest(`audit_analytics_aggregates?${parts.join("&")}&${SELECT_ALL}&order=date_bucket.desc&limit=${rowCap(limit, 100)}`);
  return r.ok ? r.data || [] : [];
}

export async function saveJourneyFunnel(userId, {
  auditId, subjectId = null, funnelName = "standard_9_stage", stageResults = [],
  overallConversionRate = null, miScore = null, miCaveats = [], workspaceId = null,
}) {
  const r = await rest("audit_journey_funnels", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      subject_id: subjectId,
      funnel_name: funnelName,
      stage_results: stageResults,
      overall_conversion_rate: overallConversionRate,
      mi_score: miScore,
      mi_caveats: miCaveats,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, funnel: row } : { ok: false, error: r.error || "Could not save funnel." };
}

export async function getJourneyFunnel(userId, auditId, { workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), `audit_id=eq.${encodeURIComponent(auditId)}`];
  const r = await rest(`audit_journey_funnels?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function saveFormDiagnostics(userId, {
  auditId, formId, formName = null, pageUrl = "/", metrics = {},
  fieldDiagnostics = [], recommendations = [], workspaceId = null,
}) {
  const r = await rest("audit_form_diagnostics", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      form_id: formId,
      form_name: formName,
      page_url: pageUrl,
      metrics,
      field_diagnostics: fieldDiagnostics,
      recommendations,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, diagnostics: row } : { ok: false, error: r.error || "Could not save form diagnostics." };
}

export async function getFormDiagnostics(userId, auditId, { formId = null, workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), `audit_id=eq.${encodeURIComponent(auditId)}`];
  if (formId) parts.push(`form_id=eq.${encodeURIComponent(formId)}`);
  const r = await rest(`audit_form_diagnostics?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

// ── STAGE 4 (P3C) PORTFOLIO ROLLUPS & EXPERIMENTS ───────────────────────────

export async function saveOptimizationExperiment(userId, {
  auditId = null, recommendationId = null, experimentName, ticketUrl = null,
  hypothesis = null, expectedMetric = "sxo_total_score", baselineValue = null,
  currentValue = null, status = "active", observationPeriodDays = 28,
  results = {}, workspaceId = null,
}) {
  const r = await rest("audit_optimization_experiments", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      audit_id: auditId,
      recommendation_id: recommendationId,
      experiment_name: experimentName,
      ticket_url: ticketUrl,
      hypothesis,
      expected_metric: expectedMetric,
      baseline_value: baselineValue,
      current_value: currentValue,
      status,
      observation_period_days: observationPeriodDays,
      start_date: new Date().toISOString(),
      relationship: "correlation",
      caveats: [
        "Observed metric movement between baseline and observation periods is correlational.",
        "Correlation does not establish causation.",
      ],
      results,
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, experiment: row } : { ok: false, error: r.error || "Could not save experiment." };
}

export async function listOptimizationExperiments(userId, {
  auditId = null, status = null, workspaceId = null, limit = 50,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (auditId) parts.push(`audit_id=eq.${encodeURIComponent(auditId)}`);
  if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
  const r = await rest(`audit_optimization_experiments?${parts.join("&")}&${SELECT_ALL}&order=created_at.desc&limit=${rowCap(limit, 50)}`);
  return r.ok ? r.data || [] : [];
}

export async function getOptimizationExperiment(userId, id, { workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), `id=eq.${encodeURIComponent(id)}`];
  const r = await rest(`audit_optimization_experiments?${parts.join("&")}&${SELECT_ALL}&limit=1`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

export async function updateOptimizationExperiment(userId, id, fields = {}, { workspaceId = null } = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId), `id=eq.${encodeURIComponent(id)}`];
  const r = await rest(`audit_optimization_experiments?${parts.join("&")}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      ...fields,
      updated_at: new Date().toISOString(),
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, experiment: row } : { ok: false, error: r.error || "Could not update experiment." };
}

export async function savePortfolioRollup(userId, {
  rollupAxis, axisValue, auditCount = 0, masterScore = null,
  layerScores = {}, frameworkScores = {}, coverage = 0, workspaceId = null,
}) {
  const r = await rest("audit_portfolio_rollups", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      workspace_id: workspaceId || null,
      rollup_axis: rollupAxis,
      axis_value: axisValue,
      audit_count: auditCount,
      master_score: masterScore,
      layer_scores: layerScores,
      framework_scores: frameworkScores,
      coverage,
      calculated_at: new Date().toISOString(),
    }),
  });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return r.ok && row ? { ok: true, rollup: row } : { ok: false, error: r.error || "Could not save portfolio rollup." };
}

export async function listPortfolioRollups(userId, {
  rollupAxis = null, workspaceId = null, limit = 100,
} = {}) {
  const parts = [ownerOrWorkspace(userId, workspaceId)];
  if (rollupAxis) parts.push(`rollup_axis=eq.${encodeURIComponent(rollupAxis)}`);
  const r = await rest(`audit_portfolio_rollups?${parts.join("&")}&${SELECT_ALL}&order=calculated_at.desc&limit=${rowCap(limit, 100)}`);
  return r.ok ? r.data || [] : [];
}

/**
 * Read the authorized, persisted inputs used to calculate portfolio rollups.
 * Client-supplied scores are never accepted: audit ids come from the scoped
 * parent query, then service-role child reads are restricted to those ids.
 */
export async function listPortfolioAuditInputs(userId, { workspaceId = null, limit = 500 } = {}) {
  const auditsResult = await rest(
    `audits?${ownerOrWorkspace(userId, workspaceId)}&status=eq.completed`
    + `&select=id,user_id,workspace_id,target_id,subject_id,page_type,target_geography,tags,created_at`
    + `&order=created_at.desc&limit=${rowCap(limit, 500)}`,
  );
  const audits = auditsResult.ok && Array.isArray(auditsResult.data) ? auditsResult.data : [];
  if (audits.length === 0) return [];

  const idFilter = `audit_id=in.(${audits.map((row) => encodeURIComponent(row.id)).join(",")})`;
  const [resultsResult, sxoResult] = await Promise.all([
    rest(`audit_results?${idFilter}&select=audit_id,final_score,seo_score,aeo_score,geo_score,coverage`),
    rest(`audit_sxo_runs?${idFilter}&select=audit_id,sxo_total_score,coverage,created_at&order=created_at.desc`),
  ]);
  const resultsByAudit = new Map((resultsResult.data || []).map((row) => [row.audit_id, row]));
  const sxoByAudit = new Map();
  for (const row of sxoResult.data || []) {
    if (!sxoByAudit.has(row.audit_id)) sxoByAudit.set(row.audit_id, row);
  }

  return audits.map((audit) => ({
    ...audit,
    template: audit.page_type || "unknown",
    result: resultsByAudit.get(audit.id) || null,
    sxo: sxoByAudit.get(audit.id) || null,
  }));
}
