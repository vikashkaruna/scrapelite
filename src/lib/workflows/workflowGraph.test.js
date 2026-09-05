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
});
