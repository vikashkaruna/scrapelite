// workflowGraph.js — PURE. The end-to-end view of Lists → Watchlists → Rules.
//
// Imported by BOTH React and netlify/, exactly like entitlementModel.js and the
// discoverability scoring model, so the graph a user sees and the graph the
// server computes cannot be produced by two different implementations.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Account Lists, Competitor Watchlists and Signal Rules are ONE pipeline —
// accounts you care about, what to watch about them, what to do when it moves —
// presented as three unrelated screens. Nothing told a user that a rule could
// never fire because no watchlist feeds it, or that a watchlist was producing
// changes no rule acts on. Each screen was individually correct and the system
// was silently inert.
//
// ── THE RULE THIS APPLIES ──────────────────────────────────────────────────
// THE VALUE IS THE BROKEN EDGES, NOT THE PRETTY ONES. A diagram that only draws
// what is wired is decoration; the reason to build this is to name the four
// ways the pipeline is disconnected, because every one of them fails SILENTLY
// today. So `issues` is the primary output and `nodes`/`edges` support it.
//
// ⚠️ Edges are by KIND, not by id. `signal_rules.trigger_source` is one of
// 'watchlist' | 'bulk_enrichment' | 'workflow_run' — a rule listens to a class
// of event, not to a specific watchlist. Drawing id-to-id edges would imply a
// precision the schema does not have, and would show a rule as "connected" to
// one watchlist when it in fact fires for all of them.

// The runtime's OWN evaluator, used by the dry-run trace below. Never a copy:
// a preview that disagrees with production is worse than no preview.
import { evaluateSignalRule } from "../rules/ruleModel.js";

/** Stage identifiers, in pipeline order. */
export const STAGES = ["lists", "watchlists", "rules"];

/** Which trigger_source each upstream stage produces. */
export const STAGE_TRIGGER = {
  lists: "bulk_enrichment",
  watchlists: "watchlist",
};

export const SEVERITY = { BLOCKING: "blocking", WARNING: "warning", INFO: "info" };

/**
 * @param {object} data
 * @param {Array} data.lists       — [{ id, name, total_records, completed_records }]
 * @param {Array} data.watchlists  — [{ id, name, cadence, targets:[], change_count }]
 * @param {Array} data.rules       — [{ id, name, status, trigger_source, action_type, execution_count }]
 * @returns {{ nodes, edges, issues, counts }}
 */
export function buildWorkflowGraph({ lists = [], watchlists = [], rules = [] } = {}) {
  const issues = [];
  const add = (i) => issues.push(i);

  // Which upstreams actually exist, and which are LIVE (capable of emitting).
  const liveByTrigger = {
    bulk_enrichment: lists.some((l) => (l.completed_records || 0) > 0),
    watchlist: watchlists.some((w) => (w.targets?.length || 0) > 0),
    // Template runs are always available — there is no object to configure.
    workflow_run: true,
  };
  const existsByTrigger = {
    bulk_enrichment: lists.length > 0,
    watchlist: watchlists.length > 0,
    workflow_run: true,
  };

  // ── Stage 1: lists ────────────────────────────────────────────────────────
  for (const l of lists) {
    if ((l.total_records || 0) > 0 && (l.completed_records || 0) === 0) {
      add({
        code: "list_not_enriched",
        severity: SEVERITY.BLOCKING,
        stage: "lists",
        subjectId: l.id,
        subject: l.name,
        title: "Imported but never enriched",
        detail: `${l.total_records} accounts are waiting. Nothing downstream can score or route them until this runs.`,
        fix: { label: "Open list", href: `/lists?list=${encodeURIComponent(l.id)}` },
      });
    }
  }

  // ── Stage 2: watchlists ───────────────────────────────────────────────────
  for (const w of watchlists) {
    if ((w.targets?.length || 0) === 0) {
      add({
        code: "watchlist_no_targets",
        severity: SEVERITY.BLOCKING,
        stage: "watchlists",
        subjectId: w.id,
        subject: w.name,
        title: "No competitors to watch",
        detail: "This watchlist will never produce a change, because it has nothing in it.",
        fix: { label: "Add competitors", href: `/watchlists?w=${encodeURIComponent(w.id)}` },
      });
    } else if ((w.change_count || 0) === 0) {
      // NOT an error. A first sighting is a baseline and never alerts, so a new
      // watchlist legitimately has zero changes — say which it is rather than
      // implying something failed.
      add({
        code: "watchlist_no_changes_yet",
        severity: SEVERITY.INFO,
        stage: "watchlists",
        subjectId: w.id,
        subject: w.name,
        title: "No changes detected yet",
        detail: "A first check records a baseline and never alerts. Changes appear from the second check onward.",
        fix: { label: "Check now", href: `/watchlists?w=${encodeURIComponent(w.id)}` },
      });
    }
  }

  // ── Stage 3: rules ────────────────────────────────────────────────────────
  for (const r of rules) {
    if (!existsByTrigger[r.trigger_source]) {
      add({
        code: "rule_unreachable",
        severity: SEVERITY.BLOCKING,
        stage: "rules",
        subjectId: r.id,
        subject: r.name,
        title: "Nothing can trigger this rule",
        detail: `It listens for ${labelForTrigger(r.trigger_source)}, and you have none configured. It can never fire.`,
        fix: fixForTrigger(r.trigger_source),
      });
    } else if (!liveByTrigger[r.trigger_source]) {
      add({
        code: "rule_upstream_idle",
        severity: SEVERITY.WARNING,
        stage: "rules",
        subjectId: r.id,
        subject: r.name,
        title: "Its source exists but is not producing",
        detail: `It listens for ${labelForTrigger(r.trigger_source)}, but nothing upstream has produced one yet.`,
        fix: fixForTrigger(r.trigger_source),
      });
    } else if ((r.execution_count || 0) === 0 && r.status === "active") {
      add({
        code: "rule_never_fired",
        severity: SEVERITY.WARNING,
        stage: "rules",
        subjectId: r.id,
        subject: r.name,
        title: "Active but has never fired",
        detail: "Its source is live, so either no event has matched its conditions yet, or the conditions are too narrow.",
        fix: { label: "Review conditions", href: `/rules?rule=${encodeURIComponent(r.id)}` },
      });
    }

    if (r.status === "paused") {
      add({
        code: "rule_paused",
        severity: SEVERITY.INFO,
        stage: "rules",
        subjectId: r.id,
        subject: r.name,
        title: "Paused",
        detail: "Matching events are being discarded while this is paused.",
        fix: { label: "Open rule", href: `/rules?rule=${encodeURIComponent(r.id)}` },
      });
    }
  }

  // ── Cross-stage: an upstream nobody listens to ────────────────────────────
  // The costliest silent gap: work is being done and paid for, and the result
  // reaches nobody.
  for (const [stage, trigger] of Object.entries(STAGE_TRIGGER)) {
    const upstreamCount = stage === "lists" ? lists.length : watchlists.length;
    if (upstreamCount === 0) continue;
    const listeners = rules.filter((r) => r.trigger_source === trigger && r.status === "active");
    if (listeners.length === 0) {
      add({
        code: "no_consumer",
        severity: SEVERITY.WARNING,
        stage,
        subjectId: null,
        subject: stage === "lists" ? "Account lists" : "Watchlists",
        title: "Nothing acts on this",
        detail: `You have ${upstreamCount} ${stage === "lists" ? "list" : "watchlist"}${upstreamCount === 1 ? "" : "s"} and no active rule listening for ${labelForTrigger(trigger)}. The work runs and the result reaches nobody.`,
        fix: { label: "Create a rule", href: "/rules?new=1" },
      });
    }
  }

  const nodes = [
    ...lists.map((l) => ({ stage: "lists", id: l.id, label: l.name, meta: `${l.completed_records || 0}/${l.total_records || 0} enriched` })),
    ...watchlists.map((w) => ({ stage: "watchlists", id: w.id, label: w.name, meta: `${w.targets?.length || 0} tracked · ${w.cadence || "daily"}` })),
    // Rule nodes carry their CONDITIONS so the dry-run trace can evaluate them
    // in the browser with the runtime's own evaluator — no extra round trip, and
    // no second implementation to drift.
    ...rules.map((r) => ({
      stage: "rules", id: r.id, label: r.name,
      meta: `${labelForTrigger(r.trigger_source)} → ${r.action_type}`,
      status: r.status,
      trigger_source: r.trigger_source,
      action_type: r.action_type,
      conditions: r.conditions || [],
    })),
  ];

  // One edge per (upstream stage → rule) pair that is actually wired by kind.
  const edges = [];
  for (const r of rules) {
    for (const [stage, trigger] of Object.entries(STAGE_TRIGGER)) {
      if (r.trigger_source !== trigger) continue;
      const live = liveByTrigger[trigger];
      edges.push({ from: stage, to: r.id, trigger, live });
    }
  }

  return {
    nodes,
    edges,
    issues: issues.sort((a, b) => rank(a.severity) - rank(b.severity)),
    counts: {
      lists: lists.length,
      watchlists: watchlists.length,
      rules: rules.length,
      blocking: issues.filter((i) => i.severity === SEVERITY.BLOCKING).length,
      warning: issues.filter((i) => i.severity === SEVERITY.WARNING).length,
    },
  };
}

function rank(sev) {
  return sev === SEVERITY.BLOCKING ? 0 : sev === SEVERITY.WARNING ? 1 : 2;
}

export function labelForTrigger(t) {
  if (t === "watchlist") return "competitor changes";
  if (t === "bulk_enrichment") return "account enrichment";
  if (t === "workflow_run") return "template runs";
  return t;
}

function fixForTrigger(t) {
  if (t === "watchlist") return { label: "Create a watchlist", href: "/watchlists?new=1" };
  if (t === "bulk_enrichment") return { label: "Import a list", href: "/lists?new=1" };
  return { label: "Run a template", href: "/templates" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — dry-run trace, and the guide that tells a user what to do next.
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Sample events for the dry-run trace.
 *
 * ⚠️ THE FIELD NAMES ARE COPIED FROM THE REAL PRODUCERS, NOT INVENTED.
 * watchlist-monitor.js emits domain/company_name/watchlist/field/category/
 * old_value/new_value/materiality/confidence/source_url; a sample carrying
 * different keys would make every field condition read as unmatched and send
 * the user editing a rule that was correct. `source` is present because
 * evaluateSignalRule gates on it exactly as the runtime does.
 */
export const SAMPLE_EVENTS = Object.freeze([
  {
    id: "price_change",
    source: "watchlist",
    label: "A competitor raised a price",
    kind: "monitor.change_detected",
    payload: {
      source: "watchlist",
      domain: "rival.com",
      company_name: "Rival Inc",
      watchlist: "Close competitors",
      field: "starter_price",
      category: "pricing",
      old_value: "$49/mo",
      new_value: "$79/mo",
      materiality: "high",
      confidence: 1,
      source_url: "https://rival.com/pricing",
    },
  },
  {
    id: "copy_change",
    source: "watchlist",
    label: "A competitor reworded a page (low materiality)",
    kind: "monitor.change_detected",
    payload: {
      source: "watchlist",
      domain: "rival.com",
      company_name: "Rival Inc",
      watchlist: "Close competitors",
      field: "hero_headline",
      category: "positioning",
      old_value: "Ship faster",
      new_value: "Ship faster, together",
      materiality: "low",
      confidence: 1,
      source_url: "https://rival.com",
    },
  },
  {
    id: "good_fit",
    source: "bulk_enrichment",
    label: "An account scored well against your ICP",
    kind: "account.score_changed",
    payload: {
      source: "bulk_enrichment",
      domain: "prospect.com",
      company_name: "Prospect Co",
      icp_score: 82,
      industry: "Software",
      employee_range: "51-200",
    },
  },
  {
    id: "poor_fit",
    source: "bulk_enrichment",
    label: "An account scored poorly against your ICP",
    kind: "account.score_changed",
    payload: {
      source: "bulk_enrichment",
      domain: "smallco.com",
      company_name: "Small Co",
      icp_score: 21,
      industry: "Retail",
      employee_range: "1-10",
    },
  },
  {
    id: "run_done",
    source: "workflow_run",
    label: "A template run finished",
    kind: "extraction.completed",
    payload: {
      source: "workflow_run",
      domain: "target.com",
      template: "Competitor Pricing Tracker",
      status: "completed",
    },
  },
]);

/**
 * Dry-run: which of the user's rules would this event fire, and why not?
 *
 * ⚠️ USES `evaluateSignalRule` — THE RUNTIME'S OWN EVALUATOR, NOT A COPY.
 * A preview that disagrees with production is worse than no preview: the user
 * edits a rule until the preview is happy and the real dispatch still ignores
 * it. Same reasoning that makes the watchlist "Check now" share the cron's
 * differ, and the rule sandbox share the dispatcher's evaluator.
 *
 * @returns {{event, matched:Array, skipped:Array, wouldFire:number}}
 */
export function traceEvent(rules = [], sample) {
  if (!sample) return { event: null, matched: [], skipped: [], wouldFire: 0 };

  const matched = [];
  const skipped = [];

  for (const rule of rules) {
    // A paused rule discards matching events, so it is reported as skipped WITH
    // its reason rather than silently omitted — "why didn't this fire?" is the
    // whole question this screen answers.
    if (rule.status === "paused") {
      skipped.push({ rule, matches: false, reasons: ["This rule is paused, so matching events are discarded."] });
      continue;
    }
    const verdict = evaluateSignalRule(rule, sample.payload);
    (verdict.matches ? matched : skipped).push({ rule, ...verdict });
  }

  return { event: sample, matched, skipped, wouldFire: matched.length };
}

/**
 * The single most valuable next action, given where the pipeline actually is.
 *
 * ⚠️ ONE STEP, NOT A CHECKLIST. A user arriving at an empty pipeline with five
 * equally-weighted suggestions does none of them. The order below is the order
 * the pipeline runs in, because a rule with nothing upstream is not a step
 * forward — it is the unreachable rule this screen exists to warn about.
 */
export function nextStep(graph) {
  const c = graph?.counts || { lists: 0, watchlists: 0, rules: 0 };
  const issues = graph?.issues || [];
  const has = (code) => issues.some((i) => i.code === code);

  if (c.lists === 0 && c.watchlists === 0) {
    return {
      id: "start",
      title: "Start by telling DatIQ what you care about",
      body: "Two ways in, and you can do either first: a list of accounts you sell to, or a watchlist of competitors you want to hear about when they change.",
      actions: [
        { label: "Import an account list", href: "/lists?new=1", primary: true },
        { label: "Watch a competitor", href: "/watchlists?new=1" },
      ],
    };
  }

  if (has("list_not_enriched")) {
    return {
      id: "enrich",
      title: "Your accounts are imported but not enriched",
      body: "Enrichment is what produces the firmographics and ICP scores everything downstream reads. Until it runs, there is nothing for a rule to act on.",
      actions: [{ label: "Run enrichment", href: "/lists", primary: true }],
    };
  }

  if (has("watchlist_no_targets")) {
    return {
      id: "targets",
      title: "Your watchlist has no competitors in it",
      body: "Add at least one domain. The first check records a baseline and never alerts — changes appear from the second check onward.",
      actions: [{ label: "Add competitors", href: "/watchlists", primary: true }],
    };
  }

  if (c.rules === 0) {
    return {
      id: "route",
      title: "Nothing acts on what you are collecting yet",
      body: "A signal rule is the last link: when something changes, it decides who hears about it — Slack, email, a webhook, or HubSpot. Without one, the work runs and the result reaches nobody.",
      actions: [{ label: "Create your first rule", href: "/rules?new=1", primary: true }],
    };
  }

  if (has("rule_unreachable") || has("rule_upstream_idle")) {
    return {
      id: "reconnect",
      title: "A rule is listening for something you do not produce",
      body: "Rules listen for a kind of event — competitor changes, account enrichment, or template runs. One of yours has no matching source, so it can never fire.",
      actions: [{ label: "See which", href: "#wf-issues", primary: true }],
    };
  }

  if (has("rule_never_fired")) {
    return {
      id: "verify",
      title: "Everything is wired — check the conditions match reality",
      body: "A rule that has never fired usually has conditions narrower than the events actually arriving. Run a dry trace below to see exactly which condition rejects them.",
      actions: [{ label: "Run a dry trace", href: "#wf-trace", primary: true }],
    };
  }

  return {
    id: "done",
    title: "Your pipeline is complete",
    body: "Accounts and competitors are feeding rules that fire. Use the dry trace below whenever you change a rule, to confirm it still matches the events you expect.",
    actions: [{ label: "Run a dry trace", href: "#wf-trace", primary: true }],
  };
}
