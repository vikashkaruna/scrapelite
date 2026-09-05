// Phase 2 — the dry trace and the guide.
//
// The trace answers the question Phase 1 raises and cannot settle: my rule is
// active, its source is live, and it has still never fired — WHY. The reasons
// are the product; "did not match" is not something a user can act on.
import { describe, expect, it } from "vitest";
import { SAMPLE_EVENTS, traceEvent, nextStep } from "./workflowGraph.js";

const rule = (over = {}) => ({
  id: "r1", name: "Price alerts", status: "active",
  trigger_source: "watchlist", action_type: "slack", conditions: [], ...over,
});
const sample = (id) => SAMPLE_EVENTS.find((s) => s.id === id);

describe("SAMPLE_EVENTS", () => {
  it("uses the field names the REAL producers emit", () => {
    // watchlist-monitor.js emits exactly these keys. A sample with invented
    // names would report every field condition as unmatched and send the user
    // to "fix" a rule that was already correct.
    const p = sample("price_change").payload;
    for (const k of ["domain", "company_name", "watchlist", "field", "category",
                     "old_value", "new_value", "materiality", "source_url"]) {
      expect(p).toHaveProperty(k);
    }
  });

  it("carries `source`, because the evaluator gates on it exactly as the runtime does", () => {
    for (const s of SAMPLE_EVENTS) expect(s.payload.source).toBe(s.source);
  });

  it("covers every trigger_source a rule can declare", () => {
    const covered = new Set(SAMPLE_EVENTS.map((s) => s.source));
    expect([...covered].sort()).toEqual(["bulk_enrichment", "watchlist", "workflow_run"]);
  });
});

describe("traceEvent", () => {
  it("a rule with no conditions fires on anything from its source", () => {
    const r = traceEvent([rule()], sample("price_change"));
    expect(r.wouldFire).toBe(1);
  });

  it("a source mismatch is reported, not silently dropped", () => {
    const r = traceEvent([rule({ trigger_source: "bulk_enrichment" })], sample("price_change"));
    expect(r.wouldFire).toBe(0);
    expect(r.skipped[0].reasons.join(" ")).toMatch(/source/i);
  });

  it("names the CONDITION that turned a rule away, not just 'no match'", () => {
    // The whole point: an actionable reason. "category is 'positioning',
    // expected 'pricing'" tells the user exactly what to change.
    const r = traceEvent(
      [rule({ conditions: [{ field: "category", operator: "equals", value: "pricing" }] })],
      sample("copy_change"),
    );
    expect(r.wouldFire).toBe(0);
    const why = r.skipped[0].reasons.join(" ");
    expect(why).toContain("category");
    expect(why).toContain("positioning");
    expect(why).toContain("pricing");
  });

  it("the same rule fires on the event it was written for", () => {
    const r = traceEvent(
      [rule({ conditions: [{ field: "category", operator: "equals", value: "pricing" }] })],
      sample("price_change"),
    );
    expect(r.wouldFire).toBe(1);
  });

  it("a PAUSED rule is reported as skipped WITH the reason, never omitted", () => {
    // Omitting it would leave the user asking why their rule is not listed at
    // all — which is the same silence this screen exists to remove.
    const r = traceEvent([rule({ status: "paused" })], sample("price_change"));
    expect(r.wouldFire).toBe(0);
    expect(r.skipped[0].reasons.join(" ")).toMatch(/paused/i);
  });

  it("every rule appears in exactly one bucket", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b", status: "paused" }),
                   rule({ id: "c", trigger_source: "workflow_run" })];
    const r = traceEvent(rules, sample("price_change"));
    expect(r.matched.length + r.skipped.length).toBe(3);
    const ids = [...r.matched, ...r.skipped].map((x) => x.rule.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("no rules means nothing fires, and does not throw", () => {
    expect(traceEvent([], sample("price_change")).wouldFire).toBe(0);
    expect(traceEvent(undefined, sample("price_change")).wouldFire).toBe(0);
  });

  it("no sample returns an empty trace rather than throwing", () => {
    expect(traceEvent([rule()], null)).toEqual({ event: null, matched: [], skipped: [], wouldFire: 0 });
  });

  it("an ICP threshold behaves as written", () => {
    // `gte`, not `greater_than` — the operator vocabulary is ruleModel.js's
    // (equals / not_equals / in / gte / lte / contains / not_empty). Writing
    // this test against a guessed name is how a sample that never matches gets
    // shipped, so it is pinned here against the real one.
    const r = rule({ trigger_source: "bulk_enrichment",
                     conditions: [{ field: "icp_score", operator: "gte", value: 70 }] });
    expect(traceEvent([r], sample("good_fit")).wouldFire).toBe(1);
    expect(traceEvent([r], sample("poor_fit")).wouldFire).toBe(0);
  });
});

describe("nextStep — one action, in pipeline order", () => {
  const g = (counts, issues = []) => ({ counts: { lists: 0, watchlists: 0, rules: 0, ...counts }, issues });

  it("an empty account is told how to start, with both entry points", () => {
    const s = nextStep(g({}));
    expect(s.id).toBe("start");
    expect(s.actions).toHaveLength(2);
  });

  it("enrichment outranks creating a rule — a rule with nothing upstream is not progress", () => {
    const s = nextStep(g({ lists: 1 }, [{ code: "list_not_enriched" }]));
    expect(s.id).toBe("enrich");
  });

  it("an empty watchlist outranks creating a rule", () => {
    const s = nextStep(g({ watchlists: 1 }, [{ code: "watchlist_no_targets" }]));
    expect(s.id).toBe("targets");
  });

  it("with data flowing and no rules, routing is the next step", () => {
    const s = nextStep(g({ lists: 1, watchlists: 1 }));
    expect(s.id).toBe("route");
  });

  it("an unreachable rule is surfaced before 'never fired'", () => {
    const s = nextStep(g({ lists: 1, rules: 1 }, [{ code: "rule_unreachable" }]));
    expect(s.id).toBe("reconnect");
  });

  it("a wired-but-silent rule points at the dry trace", () => {
    const s = nextStep(g({ watchlists: 1, rules: 1 }, [{ code: "rule_never_fired" }]));
    expect(s.id).toBe("verify");
    expect(s.actions[0].href).toBe("#wf-trace");
  });

  it("a complete pipeline says so rather than inventing busywork", () => {
    expect(nextStep(g({ lists: 1, watchlists: 1, rules: 2 })).id).toBe("done");
  });

  it("always returns exactly one step with at least one action", () => {
    for (const s of [g({}), g({ lists: 1 }), g({ rules: 1, watchlists: 1 })]) {
      const step = nextStep(s);
      expect(step.title).toBeTruthy();
      expect(step.body.length).toBeGreaterThan(40);
      expect(step.actions.length).toBeGreaterThan(0);
    }
  });

  it("survives a missing graph rather than crashing the page", () => {
    expect(nextStep(undefined).id).toBe("start");
  });
});
