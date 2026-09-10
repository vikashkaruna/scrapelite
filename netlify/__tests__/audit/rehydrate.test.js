// netlify/__tests__/audit/rehydrate.test.js
//
// A stored audit must rehydrate into the SAME shape a freshly-run one has.
//
// ── THE BUG THESE PIN ──────────────────────────────────────────────────────
// `rehydrate()` rebuilt each pillar's signals by hand from the audit_signals
// rows, and quietly omitted three fields the pipeline puts there: `label`, and
// each pillar's `coverage` and `weight`.
//
// audit_signals stores only `signal_code` — correctly, because signal codes are
// the module's public contract and a stored label would freeze today's wording
// into every historical row. So nothing downstream could recover the label, and
// the omission surfaced as:
//
//   * exported markdown printing `| undefined | 0 | 25% |` for EVERY signal
//     (auditReport.js reads s.label)
//   * blank signal names in the pillar accordion for any audit reopened from
//     history (ScoreTiles.jsx renders {s.label})
//   * toJsonPayload emitting pillar_scores[*].coverage and .weight as null
//   * CoverageNote rendering nothing, so "based on X% of signals" — the whole
//     point of the coverage model — disappeared on reopened audits
//
// It is the worst shape a bug can take: a fresh audit renders perfectly, so it
// never reproduces while you are looking at it. The fix routes the stored values
// back through scorePillar(), the same pure function the pipeline uses, so the
// two paths are identical by construction rather than by two field lists
// happening to agree.

import { describe, it, expect } from "vitest";
import { rehydrate } from "../../functions/discoverability.js";
import { scoreAllPillars } from "../../../src/lib/discoverability/scoringModel.js";
import { makeEvidence, attachEvidenceToPillars } from "../../../src/lib/discoverability/evidenceModel.js";
import { SIGNALS, PILLAR_IDS, signalsForPillar } from "../../../src/lib/discoverability/signalRegistry.js";
import { buildMarkdownReport, toJsonPayload } from "../../../src/lib/discoverability/auditReport.js";

/** Deterministic pseudo-values so the fixture is stable but not uniform. */
function fixtureValues({ unmeasured = [], notApplicable = [] } = {}) {
  const values = {};
  const reasons = {};
  let i = 0;
  for (const code of Object.keys(SIGNALS)) {
    if (unmeasured.includes(code)) { values[code] = null; reasons[code] = "not_measured"; continue; }
    if (notApplicable.includes(code)) { values[code] = null; reasons[code] = "not_applicable"; continue; }
    values[code] = (i * 37) % 101;
    i++;
  }
  return { values, reasons };
}

/**
 * A real evidence record for one signal, so the round trip is PROVEN rather
 * than merely shown not to crash. `single_h1` is chosen because it is a plain
 * deterministic reading with a selector and an excerpt — the shape a reviewer
 * would expect to see quoted back at them in a report.
 */
const EV_AT = "2026-08-27T10:00:00.000Z";
const EVIDENCED_SIGNAL = "single_h1";
function evidenceFixture() {
  return [makeEvidence({
    method: "raw_html",
    sourceUrl: "https://example.com/pricing",
    selector: "h1",
    section: "Page H1",
    observedValue: { h1_count: 2 },
    excerpt: "Pricing that scales",
    collectedAt: EV_AT,
  })];
}

/** The DB rows persistResult() would have written for those values. */
function storedRowsFor(values, reasons) {
  const rows = [];
  for (const pillar of PILLAR_IDS) {
    for (const code of signalsForPillar(pillar)) {
      const v = values[code];
      rows.push({
        pillar,
        signal_code: code,
        normalized_score: v === null || v === undefined ? null : v,
        weight: SIGNALS[code].weight,
        measured: v !== null && v !== undefined,
        unknown_reason: reasons[code] || null,
        evidence_json: code === EVIDENCED_SIGNAL ? evidenceFixture() : null,
        raw_value: code === EVIDENCED_SIGNAL ? { h1_count: 2 } : null,
        threshold_json: null,
      });
    }
  }
  // getAuditFull orders `pillar.asc,signal_code.asc` — alphabetical, NOT the
  // registry's declaration order. Reproduce that, because signal ORDER in the
  // report is one of the things the hand-rolled rebuild got wrong.
  return rows.sort((a, b) =>
    a.pillar.localeCompare(b.pillar) || a.signal_code.localeCompare(b.signal_code));
}

function fullFixture(opts = {}) {
  const { values, reasons } = fixtureValues(opts);
  // `fresh` is what the PIPELINE produces, which is the scorer's output PLUS the
  // evidence decoration — not the bare scorer's. Comparing rehydrate against an
  // undecorated scorer would assert that a stored audit matches something the
  // product never actually renders.
  const pillars = attachEvidenceToPillars(
    scoreAllPillars(values, reasons),
    { [EVIDENCED_SIGNAL]: evidenceFixture() },
  );
  return {
    fresh: pillars,
    full: {
      audit: {
        id: "aud_1",
        target_url: "https://example.com/pricing",
        page_type: "pricing",
        device_profile: "desktop",
        audit_profile: "balanced",
        started_at: "2026-08-27T10:00:00.000Z",
        created_at: "2026-08-27T10:00:00.000Z",
      },
      result: {
        final_score: 61.2, seo_score: 64.1, aeo_score: 55.3, geo_score: 58.8,
        headline_framework: "overall",
        answer_clarity_score: pillars.answer_clarity.score,
        entity_authority_score: pillars.entity_authority.score,
        structural_hierarchy_score: pillars.structural_hierarchy.score,
        technical_accessibility_score: pillars.technical_accessibility.score,
        pre_penalty_score: 61.2, penalty_multiplier: 1, coverage: 84.5,
        estimated_total_lift: 12, issue_count: 0, critical_count: 0,
        facts_json: {}, evidence_json: {}, engine_json: {},
      },
      signals: storedRowsFor(values, reasons),
      issues: [], recommendations: [], promptRuns: [],
    },
  };
}

describe("rehydrate — a stored audit matches a fresh one", () => {
  it("gives every signal a human label", () => {
    // THE headline defect. Before the fix every one of these was undefined.
    const { full } = fullFixture();
    const audit = rehydrate(full);
    const all = PILLAR_IDS.flatMap((p) => audit.pillars[p].signals);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.label, `signal ${s.code} has no label`).toBeTruthy();
      expect(s.label).toBe(SIGNALS[s.code].label);
    }
  });

  it("carries each pillar's coverage and weight", () => {
    const { full, fresh } = fullFixture({ unmeasured: ["core_web_vitals"] });
    const audit = rehydrate(full);
    for (const p of PILLAR_IDS) {
      expect(audit.pillars[p].coverage).toBe(fresh[p].coverage);
      expect(audit.pillars[p].weight).toBe(fresh[p].weight);
    }
  });

  it("lists signals in registry declaration order, not alphabetically", () => {
    // getAuditFull sorts signal_code.asc, so a reopened audit used to list its
    // signals in a different order from a fresh one — same data, different
    // report, for no reason a reader could see.
    const { full } = fullFixture();
    const audit = rehydrate(full);
    for (const p of PILLAR_IDS) {
      expect(audit.pillars[p].signals.map((s) => s.code)).toEqual(signalsForPillar(p));
    }
  });

  it("reproduces the fresh pillar objects field for field", () => {
    const { full, fresh } = fullFixture({ unmeasured: ["core_web_vitals"], notApplicable: ["howto_schema_alignment"] });
    const audit = rehydrate(full);
    for (const p of PILLAR_IDS) {
      expect(audit.pillars[p].signals).toEqual(fresh[p].signals);
    }
  });

  it("brings each signal's evidence back with it", () => {
    // The BRD requires every signal to retain its evidence. A stored audit that
    // has the score but not the workings satisfies the letter of a score column
    // and none of the requirement.
    const { full } = fullFixture();
    const audit = rehydrate(full);
    const all = PILLAR_IDS.flatMap((p) => audit.pillars[p].signals);
    const evidenced = all.find((sig) => sig.code === EVIDENCED_SIGNAL);
    expect(evidenced.evidence).toHaveLength(1);
    expect(evidenced.evidence[0].source_url).toBe("https://example.com/pricing");
    expect(evidenced.evidence[0].selector).toBe("h1");
    expect(evidenced.evidence[0].excerpt).toBe("Pricing that scales");
    expect(evidenced.evidence[0].collected_at).toBe(EV_AT);
    expect(evidenced.rawValue).toEqual({ h1_count: 2 });
    expect(evidenced.confidence).toBe(0.99);
  });

  it("reports a signal with no stored evidence as unsupported, not zero-confidence", () => {
    // Same discipline as the scorer: `unknown` is never `0`. A signal we have
    // no provenance for must not render as one we are 0% sure of.
    const { full } = fullFixture();
    const audit = rehydrate(full);
    const bare = PILLAR_IDS
      .flatMap((p) => audit.pillars[p].signals)
      .find((sig) => sig.code !== EVIDENCED_SIGNAL);
    expect(bare.evidence).toEqual([]);
    expect(bare.confidence).toBeNull();
    expect(bare.rawValue).toBeNull();
  });

  it("stamps the scoring model version, defaulting pre-0048 rows to v1", () => {
    const { full } = fullFixture();
    expect(rehydrate(full).scoringModelVersion).toBe("v1");
    full.result.scoring_model_version = "v2";
    expect(rehydrate(full).scoringModelVersion).toBe("v2");
  });

  it("preserves not-measured and not-applicable as distinct states", () => {
    // `unknown` is never `0` — and "could not measure" is not the same as
    // "does not apply to this page type". Both must survive the round trip.
    const { full } = fullFixture({ unmeasured: ["core_web_vitals"], notApplicable: ["howto_schema_alignment"] });
    const audit = rehydrate(full);
    const byCode = Object.fromEntries(
      PILLAR_IDS.flatMap((p) => audit.pillars[p].signals).map((s) => [s.code, s]),
    );
    expect(byCode["core_web_vitals"].measured).toBe(false);
    expect(byCode["core_web_vitals"].applicable).toBe(true);
    expect(byCode["core_web_vitals"].score).toBeNull();
    expect(byCode["howto_schema_alignment"].applicable).toBe(false);
    expect(byCode["howto_schema_alignment"].score).toBeNull();
  });

  it("keeps the STORED pillar scores authoritative", () => {
    // Recomputing presentation fields must not silently restate the numbers
    // that were persisted — those are what the trend chart plots and what a
    // historical diff compares against.
    const { full } = fullFixture();
    full.result.answer_clarity_score = 41.5;
    const audit = rehydrate(full);
    expect(audit.pillars.answer_clarity.score).toBe(41.5);
  });

  it("gives every framework a coverage, not just a score", () => {
    const { full } = fullFixture({ unmeasured: ["core_web_vitals"] });
    const audit = rehydrate(full);
    for (const f of ["overall", "seo", "aeo", "geo"]) {
      expect(Number.isFinite(audit.frameworks[f].coverage)).toBe(true);
    }
    // Framework-weighted, so the four are not all the same number: a missing
    // TECHNICAL signal must cost the tech-heavy SEO view more coverage than
    // the answer-heavy AEO view.
    expect(audit.frameworks.seo.coverage).not.toBe(audit.frameworks.aeo.coverage);
  });

  it("resolves the page type to its human label", () => {
    const { full } = fullFixture();
    const audit = rehydrate(full);
    expect(audit.target.page_type_label).toBeTruthy();
    expect(audit.target.page_type_label).not.toBe("pricing");
  });
});

describe("rehydrate — the exports that consume it", () => {
  it("markdown prints no `undefined` anywhere", () => {
    // This is the literal symptom from the shipped report:
    //   | undefined | 0 | 25% |
    const { full } = fullFixture({ unmeasured: ["core_web_vitals"], notApplicable: ["howto_schema_alignment"] });
    const md = buildMarkdownReport(rehydrate(full));
    expect(md).not.toMatch(/undefined/);
  });

  it("markdown names every signal", () => {
    const { full } = fullFixture();
    const md = buildMarkdownReport(rehydrate(full));
    for (const code of Object.keys(SIGNALS)) {
      expect(md, `missing label for ${code}`).toContain(SIGNALS[code].label);
    }
  });

  it("JSON carries pillar coverage and weight rather than null", () => {
    const { full } = fullFixture();
    const payload = toJsonPayload(rehydrate(full));
    for (const p of PILLAR_IDS) {
      expect(payload.pillar_scores[p].coverage).not.toBeNull();
      expect(payload.pillar_scores[p].weight).not.toBeNull();
    }
  });
});
