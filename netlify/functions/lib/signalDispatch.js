// netlify/functions/lib/signalDispatch.js — PRD 5's missing half.
//
// `ruleModel.js` could always EVALUATE a rule; nothing ever DISPATCHED one.
// `recordExecution` had zero callers, `rule_executions` was never written, and
// `evaluateSignalRule` was reached only from the "test with sample payload"
// sandbox — so a user could build a rule, watch it match, save it, and it would
// never fire. This module is the part that makes a saved rule real.
//
// ── THE SHAPE ───────────────────────────────────────────────────────────────
//
//   producer (watchlist-monitor, bulk-runner, …)
//        │  emits a CANONICAL event
//        ▼
//   dispatchSignal(event)
//        │  loads that user's active rules for the event's trigger source
//        │  evaluates each with the SAME pure evaluator the sandbox uses
//        ▼
//   performAction()  →  Slack | Resend email | webhook POST | HubSpot company
//        │
//        ▼
//   recordExecution()  →  rule_executions  (status, payload, response, latency)
//
// The canonical event vocabulary is the PRD's own (§"Build an internal canonical
// event model before expanding integrations"): monitor.change_detected,
// account.score_changed, enrichment.completed, and so on. Producers emit those
// names and nothing else, so a new integration is a new ACTION here rather than
// a new producer everywhere.
//
// ── RULES THAT KEEP THIS SAFE, EACH LEARNED THE HARD WAY ────────────────────
//
// 1. THE SANDBOX AND THE RUNTIME SHARE ONE EVALUATOR. `evaluateSignalRule` is
//    imported here, not reimplemented. A rule that matches in the "test with
//    sample payload" preview must fire in production, or the preview is a lie —
//    and a preview nobody trusts is worse than no preview.
//
// 2. EVERY OUTBOUND URL IS RE-VALIDATED AT DISPATCH TIME. `ruleStore.js`
//    validates at write time, which is where a bad destination should be
//    refused. It is checked AGAIN here because rows predating that validation
//    exist, and because a hostname that resolved publicly last week can resolve
//    to 169.254.169.254 today. Write-time validation stops the mistake;
//    dispatch-time validation stops the attack.
//
// 3. A FAILED ACTION IS RECORDED, NEVER THROWN. One unreachable Slack workspace
//    must not abort the run and starve every other user's rules. Each dispatch
//    is individually caught and written to `rule_executions` with its error.
//
// 4. NOTHING HERE FANS OUT WITHOUT A CAP. `MAX_ACTIONS_PER_EVENT` bounds how
//    many rules one event can fire, so a user with fifty overlapping rules
//    cannot turn a single pricing change into fifty outbound requests inside a
//    function that has ten seconds to live.

import { evaluateSignalRule, formatActionPayload, ACTION_TYPES } from "../../../src/lib/rules/ruleModel.js";
import { filterRulesByScope, sourcesForRules } from "./ruleSources.js";
import { recordExecution, validateActionConfig, serviceDb } from "./ruleStore.js";
import { isPublicHttpUrlAsync } from "./publicUrl.js";
import { getConnection } from "./integrationConnectionStore.js";
import { mailReady, sendMail } from "./mailTransport.js";
import { EXECUTION_STATUS, MAX_ATTEMPTS } from "../../../src/lib/rules/retryModel.js";

/**
 * The canonical event model from PRD 5. Producers emit these names; rules are
 * written against them. Adding a kind here without a producer is harmless;
 * emitting a kind that is NOT here is refused, so a typo in a producer surfaces
 * as a rejected event rather than a rule that silently never matches.
 */
export const SIGNAL_EVENTS = Object.freeze([
  "extraction.completed",
  "enrichment.completed",
  "enrichment.failed",
  "account.score_changed",
  "monitor.change_detected",
  "monitor.digest_ready",
  "report.shared",
  "report.viewed",
  "integration.action_failed",
  "usage.limit_approaching",
]);

/**
 * Which trigger_source a rule must declare to see a given event kind.
 *
 * 🔴 EVERY VALUE HERE MUST BE ONE A RULE CAN ACTUALLY DECLARE.
 * `findMatchingRules` filters `.eq("trigger_source", source)`, and
 * `signal_rules.trigger_source` carries a CHECK constraint (migration 0043)
 * limiting it to 'watchlist' | 'bulk_enrichment' | 'workflow_run'. This map
 * previously emitted 'account', 'extraction', 'report' and 'system' — values
 * no row can hold — so EIGHT of the ten canonical kinds queried for a
 * trigger_source that cannot exist, matched zero rules every time, and
 * dispatched nothing. Silently: an empty result is indistinguishable from
 * "no rule wanted this event".
 *
 * The mirror of the same bug: 'bulk_enrichment' and 'workflow_run' are offered
 * in the rule builder and accepted by the database, but NO event produced
 * them — so a rule a user could save and see listed as active could never
 * fire. Both halves are fixed by mapping onto the three real sources.
 *
 * `signalDispatch.parity.test.js` now asserts this map only emits values the
 * CHECK constraint permits, and that every declarable source has at least one
 * producing event. One side declares, the other executes — the failure is
 * silence, so it needs a test rather than care.
 *
 * ⚠️ `integration.action_failed` and `usage.limit_approaching` are DELIBERATELY
 * absent. They are platform faults, not user signals: routing an
 * integration failure to a user rule whose action is that same integration is
 * a loop, and neither is something a customer rule should act on. An unmapped
 * kind returns no rules, which is the honest outcome — not an oversight.
 */
const EVENT_TO_SOURCE = Object.freeze({
  "monitor.change_detected": "watchlist",
  "monitor.digest_ready": "watchlist",
  // Produced by the bulk enricher and the ICP scorer.
  "account.score_changed": "bulk_enrichment",
  "enrichment.completed": "bulk_enrichment",
  "enrichment.failed": "bulk_enrichment",
  // Produced by template/extraction runs and the sharing surface.
  "extraction.completed": "workflow_run",
  "report.shared": "workflow_run",
  "report.viewed": "workflow_run",
});

/** Kinds that deliberately route to no user rule, with the reason. */
export const UNROUTED_EVENTS = Object.freeze({
  "integration.action_failed": "A failed integration is a platform fault; routing it to a rule whose action is that same integration would loop.",
  "usage.limit_approaching": "A billing signal belongs on an account surface, not in a customer's routing rules.",
});

export { EVENT_TO_SOURCE };

/** One event may fire at most this many rules. See rule 4 above. */
export const MAX_ACTIONS_PER_EVENT = 10;

/** Outbound request ceiling. Netlify kills a synchronous function at 10s. */
const ACTION_TIMEOUT_MS = 6000;

const SLACK_WEBHOOK_HOST = "hooks.slack.com";
const HUBSPOT_COMPANIES = "https://api.hubapi.com/crm/v3/objects/companies";

async function fetchWithTimeout(url, init = {}, timeoutMs = ACTION_TIMEOUT_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Load the active rules a given event could fire.
 * Scoped to the event's own user — a rule never sees another tenant's events.
 */
export async function rulesForEvent(event, env = process.env) {
  const db = serviceDb(env);
  if (!db) return [];

  const source = EVENT_TO_SOURCE[event.kind];
  if (!source) return [];

  const { data, error } = await db
    .from("signal_rules")
    .select("*")
    .eq("user_id", event.userId)
    .eq("status", "active")
    .eq("trigger_source", source)
    .limit(MAX_ACTIONS_PER_EVENT);

  if (error) {
    console.error("[signalDispatch] rule lookup failed:", error.message);
    return [];
  }
  const rules = data || [];
  // A rule scoped to chosen lists/watchlists (0085) fires only for events from
  // one of them — and never widens to "all" when it has none left.
  const scoped = rules.filter((r) => r.source_scope === "selected");
  if (!scoped.length) return rules;
  const sources = await sourcesForRules(db, event.userId, scoped.map((r) => r.id));
  return filterRulesByScope(rules, sources, event);
}

/**
 * Resolve and re-check the outbound destination for a rule. Returns the URL to
 * call, or a refusal. See rule 2 above for why this repeats ruleStore's check.
 */
async function resolveDestination(rule, env = process.env) {
  const type = rule.action_type || ACTION_TYPES.SLACK;
  const cfg = rule.action_config || {};

  // Shape/scheme/recipient validation, shared with the write path.
  const shape = await validateActionConfig(type, cfg);
  if (!shape.ok) return { ok: false, reason: shape.reason };

  if (type === ACTION_TYPES.EMAIL) return { ok: true, type, to: cfg.to || cfg.email };
  if (type === ACTION_TYPES.HUBSPOT) return { ok: true, type };

  // Slack through the stored connection. Resolved here, at dispatch, so a
  // disconnected integration refuses honestly at send time instead of the rule
  // silently pointing at a webhook the user has since revoked.
  if (type === ACTION_TYPES.SLACK && cfg.use_connection === true) {
    const conn = await getConnection({
      userId: rule.user_id,
      provider: "slack",
      includeSecrets: true,
      env,
    });
    const stored = conn?.ok ? (conn.connection?.config?.webhook_url || "") : "";
    if (!stored) {
      return { ok: false, reason: "Slack is not connected for this account. Connect it under Integrations." };
    }
    return { ok: true, type, url: stored };
  }

  const url = String(cfg.url || cfg.webhook_url || cfg.webhookUrl || "").trim();

  // Re-resolve DNS at dispatch time: a host that was public when the rule was
  // saved can point at a private address by the time we call it.
  let safe = false;
  try {
    safe = await isPublicHttpUrlAsync(url);
  } catch (e) {
    return { ok: false, reason: `destination rejected: ${e.message}` };
  }
  if (!safe) return { ok: false, reason: "destination resolves to a private or reserved address" };

  if (type === ACTION_TYPES.SLACK) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ""; }
    if (host !== SLACK_WEBHOOK_HOST) {
      return { ok: false, reason: `a slack action must post to ${SLACK_WEBHOOK_HOST}` };
    }
  }
  return { ok: true, type, url };
}

/** Human-readable one-liner used as the Slack text / email subject. */
function headline(event, payload) {
  if (event.kind === "monitor.change_detected") {
    return `${payload.materiality ? payload.materiality.toUpperCase() + ": " : ""}` +
      `${payload.domain || "A monitored competitor"} changed ${payload.field || "a tracked field"}`;
  }
  if (event.kind === "account.score_changed") {
    return `${payload.domain || "An account"} scored ${payload.icp_score ?? "?"} against your ICP`;
  }
  return `DatIQ signal: ${event.kind}`;
}

/**
 * Perform one rule's action. Returns a result object; NEVER throws — see rule 3.
 */
export async function performAction(rule, event, env = process.env) {
  const payload = formatActionPayload(rule, event.payload || {});
  const dest = await resolveDestination(rule, env);
  if (!dest.ok) {
    return { ok: false, status: "refused", error: dest.reason, response: null };
  }

  const title = headline(event, event.payload || {});

  try {
    if (dest.type === ACTION_TYPES.SLACK) {
      const res = await fetchWithTimeout(dest.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: title,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `*${title}*` } },
            { type: "section", text: { type: "mrkdwn", text: "```" + JSON.stringify(payload, null, 2).slice(0, 2500) + "```" } },
          ],
        }),
      });
      // Slack answers "ok" as plain text, not JSON.
      const body = await res.text().catch(() => "");
      return res.ok
        ? { ok: true, status: "success", response: { code: res.status, body: body.slice(0, 200) } }
        : { ok: false, status: "failed", httpStatus: res.status, error: `slack responded ${res.status}`, response: { code: res.status, body: body.slice(0, 200) } };
    }

    if (dest.type === ACTION_TYPES.WEBHOOK) {
      const res = await fetchWithTimeout(dest.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "DatIQBot/1.0 (+https://datiq.app)" },
        body: JSON.stringify({ event: event.kind, rule: rule.name, occurred_at: event.occurredAt, data: payload }),
      });
      const body = await res.text().catch(() => "");
      return res.ok
        ? { ok: true, status: "success", response: { code: res.status, body: body.slice(0, 200) } }
        : { ok: false, status: "failed", httpStatus: res.status, error: `webhook responded ${res.status}`, response: { code: res.status } };
    }

    if (dest.type === ACTION_TYPES.EMAIL) {
      // An unconfigured mailer is an operator problem, not a rule failure. It is
      // recorded as `skipped` so it never looks like the user's rule is broken.
      if (!mailReady(env)) return { ok: false, status: "skipped", error: "no mail transport configured", response: null };
      const from = env.ALERT_EMAIL_FROM || "DatIQ Alerts <alerts@datiq.app>";
      const r = await sendMail({
        from,
        to: [dest.to],
        subject: title,
        text: `${title}\n\n${JSON.stringify(payload, null, 2)}\n\n— DatIQ`,
      }, env);
      return r.ok
        ? { ok: true, status: "success", response: { id: r.id || null } }
        : { ok: false, status: "failed", httpStatus: r.status, error: `resend responded ${r.status}`, response: { code: r.status } };
    }

    if (dest.type === ACTION_TYPES.HUBSPOT) {
      // The destination is the workspace's own stored connection — never a URL
      // from the rule body, which is why validateActionConfig accepts a HubSpot
      // action with no URL at all.
      const conn = await getConnection({ userId: event.userId, provider: "hubspot", includeSecrets: true, env });
      const token = conn?.connection?.access_token;
      if (!token) return { ok: false, status: "skipped", error: "no HubSpot connection for this account", response: null };

      const domain = (event.payload || {}).domain;
      if (!domain) return { ok: false, status: "skipped", error: "event carries no domain to sync", response: null };

      const res = await fetchWithTimeout(HUBSPOT_COMPANIES, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: {
            domain,
            name: (event.payload || {}).company_name || domain,
            datiq_last_signal: event.kind,
            datiq_signal_summary: title.slice(0, 250),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok
        ? { ok: true, status: "success", response: { id: body?.id || null } }
        : { ok: false, status: "failed", httpStatus: res.status, error: `hubspot responded ${res.status}`, response: { code: res.status } };
    }

    return { ok: false, status: "refused", error: `unknown action type: ${dest.type}`, response: null };
  } catch (e) {
    // A timeout, a DNS failure, a TLS error. Recorded, not thrown.
    return { ok: false, status: "failed", error: e.name === "AbortError" ? "action timed out" : e.message, response: null };
  }
}

/**
 * The entry point producers call.
 *
 * @param {{kind:string, userId:string, payload:object, occurredAt?:string}} event
 * @returns {Promise<{ok:boolean, evaluated:number, fired:number, results:Array}>}
 */
export async function dispatchSignal(event, env = process.env) {
  if (!event || !SIGNAL_EVENTS.includes(event.kind)) {
    // An unrecognised kind is a producer bug. Surfacing it as a refusal makes a
    // typo visible, where silently matching nothing would not.
    return { ok: false, reason: "unknown_event_kind", evaluated: 0, fired: 0, results: [] };
  }
  if (!event.userId) return { ok: false, reason: "event_has_no_owner", evaluated: 0, fired: 0, results: [] };

  const occurredAt = event.occurredAt || new Date().toISOString();
  const rules = await rulesForEvent(event, env);
  const results = [];
  let fired = 0;

  for (const rule of rules) {
    const verdict = evaluateSignalRule(rule, event.payload || {});
    if (!verdict.matches) continue;

    fired += 1;
    const started = Date.now();
    const outcome = await performAction(rule, { ...event, occurredAt }, env);
    const latencyMs = Date.now() - started;

    // Bookkeeping must never break the dispatch it is recording — the same rule
    // withJobRun follows for platform crons.
    try {
      await recordExecution(rule.id, event.userId, {
        status: outcome.status,
        httpStatus: outcome.httpStatus ?? null,
        eventPayload: { kind: event.kind, occurred_at: occurredAt, ...(event.payload || {}) },
        actionResponse: outcome.response,
        error: outcome.error || null,
        latencyMs,
        attempt: event.attempt || 1,
      }, env);
    } catch (e) {
      console.error("[signalDispatch] could not record execution:", e.message);
    }

    results.push({ ruleId: rule.id, name: rule.name, status: outcome.status, error: outcome.error || null, latencyMs });
  }

  return { ok: true, evaluated: rules.length, fired, results };
}


/**
 * Re-attempt every dispatch whose backoff has elapsed. PRD 5's "retry failed
 * actions", driven by the `signal-retry` cron.
 *
 * ── WHY THIS RE-DISPATCHES RATHER THAN RE-EVALUATES ─────────────────────────
 *
 * The rule already MATCHED when the event happened. Re-running the conditions
 * now would evaluate them against a world that has moved on — a competitor's
 * price may have changed back, an ICP score may have been recomputed — and the
 * retry would silently drop, leaving a `retrying` row that never settles. The
 * decision to act was made at detection time; a retry is about delivery, not
 * about the decision.
 *
 * ── AND WHY IT CLAIMS BEFORE IT SENDS ───────────────────────────────────────
 *
 * `next_retry_at` is cleared on the row BEFORE the outbound call, so a slow
 * dispatch cannot be picked up twice by two overlapping runs and delivered
 * twice. A duplicate Slack alert is a small harm; a duplicate HubSpot company
 * write is not.
 */
export async function retryDueDispatches({ limit = 25, now = new Date() } = {}, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "supabase_unconfigured", retried: 0, settled: 0 };

  const { data: due, error } = await db
    .from("rule_executions")
    .select("id, rule_id, user_id, attempt, event_payload")
    .eq("status", EXECUTION_STATUS.RETRYING)
    .lte("next_retry_at", now.toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(limit);

  if (error) return { ok: false, reason: error.message, retried: 0, settled: 0 };

  const totals = { ok: true, retried: 0, settled: 0, succeeded: 0, errors: [] };

  for (const row of due || []) {
    // Claim first — see the header.
    await db.from("rule_executions").update({ next_retry_at: null }).eq("id", row.id);

    const { data: rule } = await db
      .from("signal_rules").select("*").eq("id", row.rule_id).eq("status", "active").maybeSingle();

    if (!rule) {
      // The rule was deleted or paused while this was waiting. Settle the row
      // rather than leaving it `retrying` for ever with nothing to drive it.
      await db.from("rule_executions")
        .update({ status: EXECUTION_STATUS.FAILED, error: "rule was removed or paused before the retry" })
        .eq("id", row.id);
      totals.settled += 1;
      continue;
    }

    const payload = row.event_payload || {};
    const attempt = (Number(row.attempt) || 1) + 1;
    const started = Date.now();
    const outcome = await performAction(rule, {
      kind: payload.kind || "monitor.change_detected",
      userId: row.user_id,
      payload,
      occurredAt: payload.occurred_at || new Date().toISOString(),
    }, env);

    totals.retried += 1;
    if (outcome.status === EXECUTION_STATUS.SUCCESS) totals.succeeded += 1;
    if (attempt >= MAX_ATTEMPTS && outcome.status !== EXECUTION_STATUS.SUCCESS) totals.settled += 1;

    try {
      // A NEW row per attempt, not an update: the history is the point. An
      // operator asking "how many times did this fail before it worked?" needs
      // the attempts to exist, not a single row that overwrote itself.
      await recordExecution(rule.id, row.user_id, {
        status: outcome.status,
        httpStatus: outcome.httpStatus ?? null,
        eventPayload: payload,
        actionResponse: outcome.response,
        error: outcome.error || null,
        latencyMs: Date.now() - started,
        attempt,
      }, env);
      // The row we just retried is settled as `failed` — which is what it was.
      // It failed; that is why there was a retry. Its successor row carries
      // whatever the new attempt produced, so the history reads as a sequence of
      // attempts rather than a single row that rewrote its own past.
      await db.from("rule_executions")
        .update({ status: EXECUTION_STATUS.FAILED })
        .eq("id", row.id);
    } catch (e) {
      totals.errors.push(`${row.id}: ${e.message}`);
    }
  }

  return totals;
}

export const _internal = { EVENT_TO_SOURCE, resolveDestination, headline };
