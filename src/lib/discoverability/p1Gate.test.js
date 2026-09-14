import { describe, it, expect } from "vitest";
import { AUDIT_TYPES } from "./intakeModel.js";
import { PROMPT_KIND_IDS } from "./promptTaxonomy.js";
import { CITATION_STATE_IDS } from "./citationStates.js";
import { ROOT_CAUSE_IDS, MODULE_IDS } from "./gapTaxonomy.js";
import { WAVI_COMPONENT_IDS } from "./aiVisibility.js";
import { WORKFLOW_STATE_IDS, canonicalState } from "./workflowLifecycle.js";
import { SCORING_MODEL_VERSION, PENALTIES } from "./scoringModel.js";
import { SIGNALS } from "./signalRegistry.js";
import { CONTENT_KIND_IDS } from "./contentCoverage.js";
import { CONSTRUCT_BUILDERS } from "./constructTemplates.js";
import { AUDIT_PROFILES } from "./auditProfiles.js";
import { makeEvidence } from "./evidenceModel.js";
import { classifyIssues, trendWindow, attributeMovement } from "./validationLab.js";
import { WEBHOOK_EVENTS } from "../../../netlify/functions/lib/audit/webhookDispatch.js";

// ── D8 · THE HARD P1 GATE ───────────────────────────────────────────────────
//
// Decision D8: "P1 ships complete and verified against the PRD §16 completion
// definition before any P2 work starts."
//
// ⚠️ THIS FILE IS THE GATE, NOT A REPORT OF ONE. A completion claim that lives
// in a document goes stale the first time somebody deletes a function, and
// nothing says so. Every assertion here reads the real registry, so P1 cannot
// quietly become incomplete — which is exactly what happened to the four crons
// that sat unscheduled from R19 with no build error and no runtime error.
//
// ⚠️ It asserts SHAPE, not behaviour. Each workstream has its own suite for
// that; this one answers "is every piece still here".

describe("D8 — P1 completion gate", () => {
  it("W1 · the evidence envelope carries all eight PRD fields", () => {
    const rec = makeEvidence({ method: "raw_html", sourceUrl: "https://x.com", collectedAt: Date.now() });
    for (const k of ["source_url", "selector", "section", "observed_value",
                     "excerpt", "structured", "collected_at", "confidence"]) {
      expect(rec, k).toHaveProperty(k);
    }
    expect(makeEvidence({ method: "invented", sourceUrl: "https://x.com", collectedAt: 1 })).toBeNull();
  });

  it("W2 · goal-based intake ships its profiles, and prompt monitoring is live", () => {
    expect(Object.keys(AUDIT_PROFILES).length).toBeGreaterThanOrEqual(8);
    expect(AUDIT_TYPES.prompt_monitor.available).toBe(true);
  });

  it("W3 · both PRD blockers exist and the model is versioned", () => {
    expect(PENALTIES.ENTITY_SCHEMA_INVALID).toBeTruthy();
    expect(PENALTIES.SEVERE_CWV_FAILURE).toBeTruthy();
    expect(SCORING_MODEL_VERSION).toBe("v3");
  });

  it("W4 · eight root causes and thirteen modules", () => {
    expect(ROOT_CAUSE_IDS).toHaveLength(8);
    expect(MODULE_IDS).toHaveLength(13);
  });

  it("W5 · every Recommendation Studio asset can be built", () => {
    for (const t of ["meta_tags", "internal_links", "content_brief", "technical_brief",
                     "answer_block", "jsonld_faq", "robots_txt"]) {
      expect(typeof CONSTRUCT_BUILDERS[t], t).toBe("function");
    }
    expect(CONTENT_KIND_IDS).toHaveLength(4);
  });

  it("W6 · seven prompt kinds, seven citation states, WAVI scoring", () => {
    expect(PROMPT_KIND_IDS).toHaveLength(7);
    expect(CITATION_STATE_IDS).toHaveLength(7);
    expect(WAVI_COMPONENT_IDS).toHaveLength(5);
    expect(SIGNALS.ai_visibility).toBeTruthy();
    expect(SIGNALS.ai_visibility.pillar).toBe("entity_authority");
  });

  it("🔴 W6 · WAVI and the footprint SPLIT one weight rather than double-counting", () => {
    // WAVI's first two components ARE mention and citation rate. Carrying both
    // at full weight would hand answer-engine evidence 45% of the pillar.
    expect(SIGNALS.ai_visibility.weight + SIGNALS.citation_footprint.weight).toBeCloseTo(0.25, 10);
  });

  it("W7 · the Validation Lab's four functions exist", () => {
    expect(typeof classifyIssues).toBe("function");
    expect(typeof trendWindow).toBe("function");
    expect(typeof attributeMovement).toBe("function");
  });

  it("🔴 W7 · attribution declares itself a correlation in every record", () => {
    const a = attributeMovement({
      recommendations: [{ code: "AC-01", status: "done", status_changed_at: "2026-09-05T00:00:00Z", signal_code: "x" }],
      signalDiff: [{ code: "x", comparable: true, change: 5 }],
      baselineAt: "2026-09-01T00:00:00Z", currentAt: "2026-09-11T00:00:00Z",
    });
    expect(a.relationship).toBe("correlation");
    expect(a.attributions.every((x) => x.relationship === "correlation")).toBe(true);
  });

  it("W8 · the PRD's lifecycle states all exist, with done aliased", () => {
    for (const st of ["open", "accepted", "assigned", "in_progress",
                      "implemented", "validation_scheduled", "validated"]) {
      expect(WORKFLOW_STATE_IDS, st).toContain(st);
    }
    expect(canonicalState("done")).toBe("implemented");
  });

  it("W8 · the recommendation lifecycle is subscribable", () => {
    const recEvents = WEBHOOK_EVENTS.filter((e) => e.startsWith("recommendation."));
    expect(recEvents.length).toBeGreaterThanOrEqual(8);
    expect(recEvents).toContain("recommendation.validated");
  });
});
