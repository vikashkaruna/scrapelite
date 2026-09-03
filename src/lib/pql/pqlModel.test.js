import { describe, it, expect } from "vitest";
import {
  scorePql, signalsFromEvents, activationFor,
  PQL_SIGNALS, PQL_SIGNAL_KEYS, PQL_THRESHOLD, PERSONA_ACTIVATION, DEFAULT_ACTIVATION,
} from "./pqlModel.js";
import { PERSONAS } from "../personaConfig.js";

const all = (v) => Object.fromEntries(PQL_SIGNAL_KEYS.map((k) => [k, v]));

describe("PQL signal table", () => {
  it("weights sum to exactly 100", () => {
    expect(PQL_SIGNALS.reduce((n, s) => n + s.weight, 0)).toBe(100);
  });

  it("has nine signals with unique keys and a stated rationale", () => {
    expect(PQL_SIGNALS).toHaveLength(9);
    expect(new Set(PQL_SIGNAL_KEYS).size).toBe(9);
    for (const s of PQL_SIGNALS) expect(s.why?.length).toBeGreaterThan(20);
  });

  // Weighting frustration above commitment would point sales at accounts that
  // are about to churn rather than about to buy.
  it("weights buying-intent frustration lowest of all nine", () => {
    const limit = PQL_SIGNALS.find((s) => s.key === "hit_plan_limit");
    expect(Math.min(...PQL_SIGNALS.map((s) => s.weight))).toBe(limit.weight);
  });

  it("covers every shipped persona, so no one falls to the default silently", () => {
    for (const p of PERSONAS) expect(PERSONA_ACTIVATION[p.id]).toBeTruthy();
  });

  it("no persona activates on a single extraction", () => {
    for (const def of [...Object.values(PERSONA_ACTIVATION), DEFAULT_ACTIVATION]) {
      expect(def.requires.length).toBeGreaterThanOrEqual(2);
      expect(def.requires).toContain("completed_workflow");
    }
  });
});

describe("scorePql", () => {
  it("scores 0 with nothing done and 100 with everything", () => {
    expect(scorePql(all(false)).score).toBe(0);
    expect(scorePql(all(true)).score).toBe(100);
    expect(scorePql(all(true)).isPql).toBe(true);
    expect(scorePql(all(false)).isPql).toBe(false);
  });

  it("applies the threshold at exactly 50", () => {
    expect(PQL_THRESHOLD).toBe(50);
    // 18 + 14 + 13 + 6 = 51 → over
    expect(scorePql({ completed_workflow: true, repeat_workflow_7d: true, shared_report: true, hit_plan_limit: true }).isPql).toBe(true);
    // 18 + 14 + 13 = 45 → under
    expect(scorePql({ completed_workflow: true, repeat_workflow_7d: true, shared_report: true }).isPql).toBe(false);
  });

  it("ignores unknown keys instead of throwing", () => {
    expect(() => scorePql({ not_a_signal: true, completed_workflow: true })).not.toThrow();
    expect(scorePql({ not_a_signal: true }).score).toBe(0);
  });

  it("treats only strict true as met — a truthy string is not an observation", () => {
    expect(scorePql({ completed_workflow: "yes" }).score).toBe(0);
    expect(scorePql({ completed_workflow: 1 }).score).toBe(0);
  });
});

describe("unmeasured signals are excluded, not scored zero", () => {
  // The whole point: with an un-instrumented signal, a user who did everything
  // else must still be able to reach 100 — otherwise an instrumentation gap
  // silently disqualifies every account in the database.
  it("redistributes weight so a full house still scores 100", () => {
    const measurable = PQL_SIGNAL_KEYS.filter((k) => k !== "pushed_to_integration");
    const r = scorePql(all(true), { measurable });
    expect(r.score).toBe(100);
    expect(r.excluded).toEqual(["pushed_to_integration"]);
    expect(r.coverage).toBeCloseTo(0.89, 2);
  });

  it("an excluded signal cannot drag a score down", () => {
    const signals = { completed_workflow: true, repeat_workflow_7d: true, shared_report: true };
    const withAll = scorePql(signals).score;
    const withoutIntegration = scorePql(signals, {
      measurable: PQL_SIGNAL_KEYS.filter((k) => k !== "pushed_to_integration"),
    }).score;
    expect(withoutIntegration).toBeGreaterThan(withAll);
  });

  it("reports coverage so a thin score can be labelled thin", () => {
    expect(scorePql(all(true)).coverage).toBe(1);
    expect(scorePql(all(true), { measurable: ["completed_workflow"] }).coverage).toBeCloseTo(0.18, 2);
  });

  // Nothing measurable is the ABSENCE of a score, not a score of zero. A null
  // renders as "no data"; a 0 renders as "unqualified", which is a claim.
  it("returns null — never 0 — when nothing at all is measurable", () => {
    const r = scorePql(all(true), { measurable: [] });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.isPql).toBe(false);
    expect(r.excluded).toHaveLength(9);
  });

  it("contributions add up to the score actually shown", () => {
    const measurable = PQL_SIGNAL_KEYS.filter((k) => k !== "habitual_return");
    const r = scorePql(all(true), { measurable });
    const summed = r.contributions.reduce((n, c) => n + c.points, 0);
    expect(Math.abs(summed - r.score)).toBeLessThanOrEqual(2); // rounding only
  });
});

describe("activation", () => {
  it("names what is still missing rather than just saying false", () => {
    const r = scorePql({ completed_workflow: true }, { persona: "sales" });
    expect(r.activated).toBe(false);
    expect(r.activation.missing).toEqual(["pushed_to_integration"]);
    expect(r.activation.label).toMatch(/CRM/i);
  });

  it("activates when every requirement is met", () => {
    const r = scorePql({ completed_workflow: true, pushed_to_integration: true }, { persona: "sales" });
    expect(r.activated).toBe(true);
    expect(r.activation.missing).toEqual([]);
  });

  it("falls back for an unknown persona instead of throwing", () => {
    expect(activationFor("not-a-persona")).toBe(DEFAULT_ACTIVATION);
    expect(activationFor(undefined)).toBe(DEFAULT_ACTIVATION);
    expect(() => scorePql({}, { persona: null })).not.toThrow();
  });

  // Activation and PQL are different questions: "did they get value?" vs
  // "should sales call?". A user can be activated and not yet a PQL.
  it("is independent of the PQL threshold", () => {
    const r = scorePql({ completed_workflow: true, pushed_to_integration: true }, { persona: "sales" });
    expect(r.activated).toBe(true);
    expect(r.isPql).toBe(false); // 18 + 11 = 29
  });
});

describe("signalsFromEvents", () => {
  const day = 24 * 60 * 60 * 1000;
  const ev = (name, ts, properties = {}) => ({ name, ts: new Date(ts).toISOString(), properties });
  const t0 = Date.parse("2026-09-01T10:00:00Z");

  it("returns all-false for no events", () => {
    const s = signalsFromEvents([]);
    expect(Object.values(s).every((v) => v === false)).toBe(true);
  });

  it("detects a repeat run only inside the 7-day window", () => {
    expect(signalsFromEvents([
      ev("workflow_run_completed", t0), ev("workflow_run_completed", t0 + 3 * day),
    ]).repeat_workflow_7d).toBe(true);
    expect(signalsFromEvents([
      ev("workflow_run_completed", t0), ev("workflow_run_completed", t0 + 8 * day),
    ]).repeat_workflow_7d).toBe(false);
  });

  it("counts distinct domains case-insensitively", () => {
    const s = signalsFromEvents([
      ev("workflow_run_completed", t0, { domain: "Acme.com" }),
      ev("workflow_run_completed", t0, { domain: "acme.com" }),
      ev("workflow_run_completed", t0, { domain: "beta.io" }),
    ]);
    expect(s.multi_domain).toBe(false); // 2 distinct, needs 3
  });

  it("counts habitual return in distinct DAYS, so one long evening cannot fake it", () => {
    const sameDay = [0, 1, 2, 3].map((h) => ev("workflow_run_completed", t0 + h * 3600_000));
    expect(signalsFromEvents(sameDay).habitual_return).toBe(false);
    const threeDays = [0, 1, 2].map((d) => ev("workflow_run_completed", t0 + d * day));
    expect(signalsFromEvents(threeDays).habitual_return).toBe(true);
  });

  it("feeds scorePql without further massaging", () => {
    const s = signalsFromEvents([
      ev("workflow_run_completed", t0, { domain: "a.com" }),
      ev("workflow_run_completed", t0 + day, { domain: "b.com" }),
      ev("report_published", t0 + day),
    ]);
    const r = scorePql(s, { persona: "seo" });
    expect(r.activated).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it("survives malformed events rather than throwing", () => {
    expect(() => signalsFromEvents([{}, null, { name: 123 }, { ts: "nonsense" }])).not.toThrow();
    expect(() => signalsFromEvents(null)).not.toThrow();
  });
});
