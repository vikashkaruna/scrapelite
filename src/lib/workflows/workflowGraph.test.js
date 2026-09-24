// The orchestration graph exists to name the SILENT gaps between Lists,
// Watchlists and Signal Rules. Every case here is a way the pipeline is inert
// today while all three screens look individually correct.
import { describe, expect, it } from "vitest";
import { buildWorkflowGraph, SEVERITY, labelForTrigger } from "./workflowGraph.js";

const codes = (g) => g.issues.map((i) => i.code);
const bySeverity = (g, s) => g.issues.filter((i) => i.severity === s);

describe("buildWorkflowGraph — the broken edges", () => {
  it("an empty account has nothing to report", () => {
    const g = buildWorkflowGraph({});
    expect(g.issues).toEqual([]);
    expect(g.counts).toMatchObject({ lists: 0, watchlists: 0, rules: 0, blocking: 0 });
  });

  it("flags a list imported but never enriched, and calls it blocking", () => {
    const g = buildWorkflowGraph({
      lists: [{ id: "l1", name: "Q4 targets", total_records: 40, completed_records: 0 }],
    });
    const issue = g.issues.find((i) => i.code === "list_not_enriched");
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe(SEVERITY.BLOCKING);
    // The fix has to be actionable, not just descriptive.
    expect(issue.fix.href).toContain("/lists");
  });

  it("does not flag a list that has been enriched", () => {
    const g = buildWorkflowGraph({
      lists: [{ id: "l1", name: "Q4", total_records: 40, completed_records: 40 }],
    });
    expect(codes(g)).not.toContain("list_not_enriched");
  });

  it("flags an empty watchlist as blocking — it can never produce a change", () => {
    const g = buildWorkflowGraph({ watchlists: [{ id: "w1", name: "Rivals", targets: [] }] });
    const issue = g.issues.find((i) => i.code === "watchlist_no_targets");
    expect(issue.severity).toBe(SEVERITY.BLOCKING);
  });

  it("a populated watchlist with no changes is INFO, not an error", () => {
    // A first sighting is a baseline and never alerts. Reporting that as a
    // fault would tell the user something failed when the system did exactly
    // what it is designed to do.
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "Rivals", targets: [{ id: "t1" }], change_count: 0 }],
    });
    const issue = g.issues.find((i) => i.code === "watchlist_no_changes_yet");
    expect(issue.severity).toBe(SEVERITY.INFO);
  });

  it("flags a rule that nothing can ever trigger", () => {
    // The headline case: a rule listening for competitor changes when the user
    // has no watchlists at all. Today this is completely silent.
    const g = buildWorkflowGraph({
      rules: [{ id: "r1", name: "Alert on price drop", status: "active", trigger_source: "watchlist", action_type: "slack" }],
    });
    const issue = g.issues.find((i) => i.code === "rule_unreachable");
    expect(issue.severity).toBe(SEVERITY.BLOCKING);
    expect(issue.detail).toContain("competitor changes");
    expect(issue.fix.href).toContain("/watchlists");
  });

  it("distinguishes an ABSENT source from an IDLE one", () => {
    // Different problems, different fixes: create a watchlist vs put something
    // in the one you have.
    const idle = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "Rivals", targets: [] }],
      rules: [{ id: "r1", name: "R", status: "active", trigger_source: "watchlist", action_type: "slack" }],
    });
    expect(codes(idle)).toContain("rule_upstream_idle");
    expect(codes(idle)).not.toContain("rule_unreachable");
  });

  it("flags an active rule whose live source has never fired it", () => {
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "R", targets: [{ id: "t" }], change_count: 3 }],
      rules: [{ id: "r1", name: "Alert", status: "active", trigger_source: "watchlist", action_type: "slack", execution_count: 0 }],
    });
    const issue = g.issues.find((i) => i.code === "rule_never_fired");
    expect(issue.severity).toBe(SEVERITY.WARNING);
  });

  it("does not call a rule 'never fired' when it has fired", () => {
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "R", targets: [{ id: "t" }], change_count: 3 }],
      rules: [{ id: "r1", name: "A", status: "active", trigger_source: "watchlist", action_type: "slack", execution_count: 5 }],
    });
    expect(codes(g)).not.toContain("rule_never_fired");
  });

  it("flags an upstream nobody listens to — work paid for that reaches no one", () => {
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "Rivals", targets: [{ id: "t" }], change_count: 2 }],
      rules: [], // nothing consuming
    });
    const issue = g.issues.find((i) => i.code === "no_consumer");
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe(SEVERITY.WARNING);
  });

  it("a PAUSED rule does not count as a listener", () => {
    // A paused rule discards matching events, so an upstream feeding only
    // paused rules is still an upstream nobody acts on.
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "R", targets: [{ id: "t" }], change_count: 1 }],
      rules: [{ id: "r1", name: "A", status: "paused", trigger_source: "watchlist", action_type: "slack" }],
    });
    expect(codes(g)).toContain("no_consumer");
    expect(codes(g)).toContain("rule_paused");
  });

  it("a fully wired pipeline reports no blocking or warning issues", () => {
    const g = buildWorkflowGraph({
      lists: [{ id: "l1", name: "Q4", total_records: 10, completed_records: 10 }],
      watchlists: [{ id: "w1", name: "Rivals", targets: [{ id: "t" }], change_count: 4 }],
      rules: [
        { id: "r1", name: "Watch", status: "active", trigger_source: "watchlist", action_type: "slack", execution_count: 2 },
        { id: "r2", name: "Enrich", status: "active", trigger_source: "bulk_enrichment", action_type: "hubspot", execution_count: 1 },
      ],
    });
    expect(bySeverity(g, SEVERITY.BLOCKING)).toEqual([]);
    expect(bySeverity(g, SEVERITY.WARNING)).toEqual([]);
  });

  it("orders issues by severity so the blocking ones lead", () => {
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "R", targets: [{ id: "t" }], change_count: 0 }], // INFO
      rules: [{ id: "r1", name: "A", status: "active", trigger_source: "bulk_enrichment", action_type: "slack" }], // BLOCKING
    });
    expect(g.issues[0].severity).toBe(SEVERITY.BLOCKING);
  });

  it("edges are by KIND and record whether the source is live", () => {
    // Never id-to-id: trigger_source names a class of event, so an id edge
    // would imply a precision the schema does not have.
    const g = buildWorkflowGraph({
      watchlists: [{ id: "w1", name: "R", targets: [{ id: "t" }] }],
      rules: [{ id: "r1", name: "A", status: "active", trigger_source: "watchlist", action_type: "slack" }],
    });
    expect(g.edges).toEqual([{ from: "watchlists", to: "r1", trigger: "watchlist", live: true }]);
  });

  it("names triggers in the user's language, not the schema's", () => {
    expect(labelForTrigger("watchlist")).toBe("competitor changes");
    expect(labelForTrigger("bulk_enrichment")).toBe("account enrichment");
  });

  it("recognizes watchlist targets from watchlist_targets count and target_count", () => {
    const g = buildWorkflowGraph({
      watchlists: [
        { id: "w1", name: "R1", watchlist_targets: [{ count: 3 }] },
        { id: "w2", name: "R2", target_count: 5 },
      ],
      rules: [
        { id: "r1", name: "W-Rule", status: "active", trigger_source: "watchlist", action_type: "slack", execution_count: 1 },
      ],
    });
    expect(codes(g)).not.toContain("watchlist_no_targets");
    expect(codes(g)).not.toContain("rule_upstream_idle");
  });

  it("synthesizes pipelines linking rules and upstreams with execution info", () => {
    const g = buildWorkflowGraph({
      lists: [{ id: "l1", name: "Q4", total_records: 10, completed_records: 10 }],
      watchlists: [{ id: "w1", name: "Rivals", targets: [{ id: "t" }], change_count: 4 }],
      rules: [
        { id: "r1", name: "Watch", status: "active", trigger_source: "watchlist", action_type: "slack", execution_count: 2 },
      ],
      executions: [
        { id: "ex1", rule_id: "r1", status: "delivered", executed_at: "2026-09-16T12:00:00Z" },
      ],
    });
    // Pipelines are real rules only; the unheard list is in `unconnected`.
    expect(g.pipelines).toHaveLength(1);
    expect(g.unconnected).toEqual([
      expect.objectContaining({ trigger_source: "bulk_enrichment", sources: [expect.objectContaining({ id: "l1", name: "Q4" })] }),
    ]);
    const p1 = g.pipelines.find((p) => p.rule_id === "r1");
    expect(p1).toMatchObject({
      name: "Watch",
      upstream_stage: "Competitor Watchlists",
      action_type: "slack",
      health: "healthy",
      execution_count: 2,
    });
    expect(p1.last_execution).toMatchObject({ id: "ex1", status: "delivered" });
  });

  // 0085 — a rule limited to chosen sources.
  describe("rule sources", () => {
    const watchlists = [
      { id: "w1", name: "Rivals", targets: [{ id: "t" }], change_count: 1 },
      { id: "w2", name: "Adjacent", targets: [{ id: "t" }], change_count: 1 },
    ];

    it("a scoped rule's card names only its sources", () => {
      const g = buildWorkflowGraph({
        watchlists,
        rules: [{ id: "r1", name: "Rivals only", status: "active", trigger_source: "watchlist", action_type: "email", source_scope: "selected", sources: [{ type: "watchlist", id: "w1", name: "Rivals" }] }],
      });
      const p = g.pipelines[0];
      expect(p.source_scope).toBe("selected");
      expect(p.upstream_items.map((i) => i.name)).toEqual(["Rivals"]);
      expect(p.upstream_summary).toMatch(/Only 1 chosen watchlist/);
    });

    it("a watchlist no active rule hears is 'not connected', even when a scoped rule exists", () => {
      const g = buildWorkflowGraph({
        watchlists,
        rules: [{ id: "r1", name: "Rivals only", status: "active", trigger_source: "watchlist", action_type: "email", source_scope: "selected", sources: [{ type: "watchlist", id: "w1", name: "Rivals" }] }],
      });
      expect(g.unconnected).toHaveLength(1);
      expect(g.unconnected[0].sources.map((s) => s.id)).toEqual(["w2"]);
    });

    it("a rule listening to all hears every watchlist", () => {
      const g = buildWorkflowGraph({
        watchlists,
        rules: [{ id: "r1", name: "All", status: "active", trigger_source: "watchlist", action_type: "email" }],
      });
      expect(g.unconnected).toEqual([]);
    });

    it("a paused rule hears nothing, and says why when it lost its sources", () => {
      const g = buildWorkflowGraph({
        watchlists,
        rules: [{ id: "r1", name: "Orphan", status: "paused", paused_reason: "no_sources", trigger_source: "watchlist", action_type: "email", source_scope: "selected", sources: [] }],
      });
      expect(g.pipelines[0].health_label).toBe("Paused — no sources left");
      expect(g.unconnected[0].sources).toHaveLength(2);
    });
  });
});
