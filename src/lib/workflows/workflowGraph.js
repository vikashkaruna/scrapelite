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
    ...rules.map((r) => ({ stage: "rules", id: r.id, label: r.name, meta: `${labelForTrigger(r.trigger_source)} → ${r.action_type}` })),
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
