import { describe, it, expect } from "vitest";
import {
  scorePql, signalsFromEvents, activationFor,
  PQL_SIGNALS, PQL_SIGNAL_KEYS, PQL_THRESHOLD, PQL_MAX_POINTS, MEASURABLE_TODAY,
  ACTIVATION_DEFINITIONS, PERSONA_TO_ACTIVATION, ACTIVATION_CONDITIONS,
} from "./pqlModel.js";
import { PERSONAS } from "../personaConfig.js";

const allSignals = (v) => Object.fromEntries(PQL_SIGNAL_KEYS.map((k) => [k, v]));
const ALL = PQL_SIGNAL_KEYS.slice();

// Transcribed from the PRD's own table. If this block and pqlModel disagree,
// pqlModel is wrong — not this test.
const PRD_TABLE = [
  ["used_persona_template", 10],
  ["two_meaningful_extractions", 10],
  ["created_shareable_report", 10],
  ["connected_integration", 20],
  ["created_recurring_monitor", 20],
  ["imported_enriched_10_companies", 20],
  ["invited_teammate", 15],
  ["pricing_viewed_twice_7d", 10],
  ["icp_fit", 15],
];

describe("the PRD's signal table is reproduced exactly", () => {
  it("has the same nine signals with the same points, in order", () => {
    expect(PQL_SIGNALS.map((s) => [s.key, s.points])).toEqual(PRD_TABLE);
  });

  // The PRD's points sum to 130. Normalising to 100 would silently re-scale
  // the 50-point threshold into a 65-point one and suppress outreach the PRD
  // wants triggered.
  it("sums to 130, not 100, and the threshold is 50 RAW points", () => {
    expect(PQL_MAX_POINTS).toBe(130);
    expect(PQL_THRESHOLD).toBe(50);
  });

  it("a perfect score is 130 and 'nothing done' is 0", () => {
    expect(scorePql(allSignals(true), { measurable: ALL }).points).toBe(130);
    expect(scorePql(allSignals(false), { measurable: ALL }).points).toBe(0);
  });

  it("the threshold bites at exactly 50 points", () => {
    // 20 + 20 + 10 = 50 → PQL
    const at = scorePql({ connected_integration: true, created_recurring_monitor: true, used_persona_template: true }, { measurable: ALL });
    expect(at.points).toBe(50);
    expect(at.isPql).toBe(true);
    // 20 + 20 = 40 → not
    const below = scorePql({ connected_integration: true, created_recurring_monitor: true }, { measurable: ALL });
    expect(below.points).toBe(40);
    expect(below.isPql).toBe(false);
  });
});

describe("unmeasured signals are excluded, not scored zero", () => {
  // This is load-bearing NOW, not theoretical: two of the nine cannot be
  // measured by the product as it stands.
  it("defaults to what the product can actually observe today", () => {
    expect(MEASURABLE_TODAY).toHaveLength(7);
    expect(MEASURABLE_TODAY).not.toContain("icp_fit");
    expect(MEASURABLE_TODAY).not.toContain("imported_enriched_10_companies");
  });

  it("a full house still reaches 130 with two signals un-instrumented", () => {
    const r = scorePql(allSignals(true));
    expect(r.points).toBe(130);
    expect(r.rawPoints).toBe(95); // 130 − 20 − 15
    expect(r.excluded.sort()).toEqual(["icp_fit", "imported_enriched_10_companies"]);
  });

  it("does not make the PRD's threshold 35 points harder than written", () => {
    const signals = { connected_integration: true, created_recurring_monitor: true };
    expect(scorePql(signals).isPql).toBe(true);              // 40 raw of 95 → 55
    expect(scorePql(signals, { measurable: ALL }).isPql).toBe(false); // 40 of 130
  });

  it("reports coverage so a thin score can be labelled thin", () => {
    expect(scorePql(allSignals(true), { measurable: ALL }).coverage).toBe(1);
    expect(scorePql(allSignals(true)).coverage).toBeCloseTo(0.731, 3);
  });

  // Nothing measurable is the ABSENCE of a score. A null renders "no data";
  // a 0 renders "unqualified", which is a claim nobody made.
  it("returns null — never 0 — when nothing at all is measurable", () => {
    const r = scorePql(allSignals(true), { measurable: [] });
    expect(r.points).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.isPql).toBe(false);
    expect(r.excluded).toHaveLength(9);
  });

  it("treats only strict true as observed", () => {
    expect(scorePql({ connected_integration: "yes" }).rawPoints).toBe(0);
    expect(scorePql({ connected_integration: 1 }).rawPoints).toBe(0);
  });

  it("ignores unknown keys instead of throwing", () => {
    expect(() => scorePql({ not_a_signal: true })).not.toThrow();
    expect(scorePql({ not_a_signal: true }).rawPoints).toBe(0);
  });
});

describe("activation follows the PRD's own definitions", () => {
  it("defines all six PRD activation groups, each marked as from the PRD", () => {
    const fromPrd = Object.entries(ACTIVATION_DEFINITIONS)
      .filter(([, d]) => d.fromPrd !== false).map(([k]) => k).sort();
    expect(fromPrd).toEqual(["agency", "product-pmm", "revops", "sales-sdr", "seo-content", "vc-analyst"]);
  });

  // The app ships a recruiter persona the PRD's table does not cover. It gets
  // its own definition rather than being folded onto vc-analyst — but it must
  // stay DISTINGUISHABLE from the six the PRD actually specifies, so nobody
  // later cites it back as though the PRD said it.
  it("marks the non-PRD recruiter definition as such", () => {
    expect(ACTIVATION_DEFINITIONS.recruiter.fromPrd).toBe(false);
    for (const k of ["sales-sdr", "revops", "product-pmm", "seo-content", "vc-analyst", "agency"]) {
      expect(ACTIVATION_DEFINITIONS[k].fromPrd).not.toBe(false);
    }
  });

  it("recruiter no longer borrows the vc-analyst definition", () => {
    expect(PERSONA_TO_ACTIVATION.recruiter).toBe("recruiter");
    expect(activationFor("recruiter")).not.toBe(ACTIVATION_DEFINITIONS["vc-analyst"]);
  });

  // Sourcing is inherently repeated across companies. A recruiter who ran one
  // lookup must not read as activated — that is the vanity metric the PRD
  // warns against, wearing a different hat.
  it("recruiter activation requires repetition and an export, not one lookup", () => {
    const one = scorePql({}, { persona: "recruiter", conditions: { sourced_hiring_signals: true } });
    expect(one.activated).toBe(false);
    expect(one.activation.missing).toEqual(["sourced_across_3_companies", "exported_or_routed_shortlist"]);

    const full = scorePql({}, { persona: "recruiter", conditions: {
      sourced_hiring_signals: true, sourced_across_3_companies: true, exported_or_routed_shortlist: true } });
    expect(full.activated).toBe(true);
  });

  // PRD: "Do not use 'a user extracted one URL' as activation. That creates a
  // misleading vanity metric."
  it("no definition activates on a single action", () => {
    for (const def of Object.values(ACTIVATION_DEFINITIONS)) {
      expect(def.requires.length).toBeGreaterThanOrEqual(2);
      for (const c of def.requires) expect(ACTIVATION_CONDITIONS[c]).toBeTruthy();
    }
  });

  it("maps every shipped app persona onto a real definition", () => {
    for (const p of PERSONAS) {
      expect(PERSONA_TO_ACTIVATION[p.id]).toBeTruthy();
      expect(activationFor(p.id)).toBeTruthy();
    }
  });

  it("names what is still missing rather than just saying false", () => {
    const r = scorePql({}, { persona: "sales", conditions: { ran_account_brief: true } });
    expect(r.activated).toBe(false);
    expect(r.activation.missing).toEqual(["exported_or_routed", "saved_or_monitored"]);
    expect(r.activation.label).toMatch(/Account Brief/);
  });

  it("activates only when every condition is met", () => {
    const r = scorePql({}, { persona: "sales", conditions: {
      ran_account_brief: true, exported_or_routed: true, saved_or_monitored: true } });
    expect(r.activated).toBe(true);
    expect(r.activation.missing).toEqual([]);
  });

  // Two different questions: "did they get value?" vs "should the founder
  // reach out?". A user can be activated long before they are a PQL.
  it("is independent of the PQL threshold", () => {
    const r = scorePql({}, { persona: "sales", conditions: {
      ran_account_brief: true, exported_or_routed: true, saved_or_monitored: true } });
    expect(r.activated).toBe(true);
    expect(r.isPql).toBe(false);
  });

  it("falls back for an unknown persona instead of throwing", () => {
    expect(() => scorePql({}, { persona: "not-a-persona" })).not.toThrow();
    expect(activationFor(undefined)).toBe(ACTIVATION_DEFINITIONS["sales-sdr"]);
  });
});

describe("signalsFromEvents", () => {
  const day = 24 * 60 * 60 * 1000;
  const ev = (name, ts, properties = {}) => ({ name, ts: new Date(ts).toISOString(), properties });
  const t0 = Date.parse("2026-09-01T10:00:00Z");

  it("returns all-false for no events", () => {
    expect(Object.values(signalsFromEvents([])).every((v) => v === false)).toBe(true);
  });

  // PRD says "two or more MEANINGFUL extractions" — a failure is not meaningful.
  it("does not count failed extractions toward the two-extraction signal", () => {
    expect(signalsFromEvents([ev("extraction_success", t0), ev("extraction_failed", t0)])
      .two_meaningful_extractions).toBe(false);
    expect(signalsFromEvents([ev("extraction_success", t0), ev("extraction_success", t0)])
      .two_meaningful_extractions).toBe(true);
  });

  it("requires two pricing views WITHIN seven days of each other", () => {
    expect(signalsFromEvents([ev("pricing_viewed", t0), ev("pricing_viewed", t0 + 3 * day)])
      .pricing_viewed_twice_7d).toBe(true);
    expect(signalsFromEvents([ev("pricing_viewed", t0), ev("pricing_viewed", t0 + 9 * day)])
      .pricing_viewed_twice_7d).toBe(false);
    expect(signalsFromEvents([ev("pricing_viewed", t0)]).pricing_viewed_twice_7d).toBe(false);
  });

  it("requires 10+ companies for the bulk signal, not merely a bulk run", () => {
    expect(signalsFromEvents([ev("bulk_enrichment_completed", t0, { count: 9 })])
      .imported_enriched_10_companies).toBe(false);
    expect(signalsFromEvents([ev("bulk_enrichment_completed", t0, { count: 10 })])
      .imported_enriched_10_companies).toBe(true);
  });

  // icp_fit is ACCOUNT FIT, not behaviour — it can never come from events.
  it("never derives icp_fit from product events", () => {
    expect(signalsFromEvents([ev("icp_fit", t0)]).icp_fit).toBeUndefined();
  });

  it("feeds scorePql without further massaging", () => {
    const s = signalsFromEvents([
      ev("template_run_completed", t0),
      ev("extraction_success", t0), ev("extraction_success", t0 + day),
      ev("report_published", t0 + day),
    ]);
    const r = scorePql(s, { persona: "seo" });
    expect(r.rawPoints).toBe(30);
    expect(r.points).toBeGreaterThan(30); // redistributed
  });

  it("survives malformed events rather than throwing", () => {
    expect(() => signalsFromEvents([{}, null, { name: 123 }, { ts: "nonsense" }])).not.toThrow();
    expect(() => signalsFromEvents(null)).not.toThrow();
  });
});
