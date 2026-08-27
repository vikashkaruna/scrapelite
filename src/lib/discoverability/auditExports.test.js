// auditExports.test.js — every export format carries every segment of the report.
//
// ── WHY ────────────────────────────────────────────────────────────────────
// The four formats had drifted into four different subsets of the report:
//
//   PDF      no pillar breakdown at all, no penalties, no evidence, no
//            comparison — and its "Ready-to-paste assets" section filtered on
//            `implementationAsset.content` while every template in
//            constructTemplates.js emits `body`, so that section had NEVER
//            rendered. It is the section most likely to be why somebody
//            exported a PDF in the first place.
//   CSV      issues OR recommendations, chosen by a query parameter nobody
//            sees. The pillar arithmetic — the part a spreadsheet is actually
//            good at — could not be exported at all.
//   JSON     no evidence, no prompt runs, no constructs, no band labels.
//
// A report forwarded to a client should not depend on which button was pressed.

import { describe, it, expect } from "vitest";
import {
  buildMarkdownReport, toJsonPayload,
  issuesToCsv, recommendationsToCsv, signalsToCsv, scoresToCsv, bundleToCsv,
} from "./auditReport.js";
import { renderAuditPdf } from "./auditPdf.js";
import { scoreAllPillars } from "./scoringModel.js";
import { SIGNALS, PILLAR_IDS, signalsForPillar } from "./signalRegistry.js";

function auditFixture() {
  const values = {};
  const reasons = {};
  let i = 0;
  for (const code of Object.keys(SIGNALS)) {
    if (code === "core_web_vitals") { values[code] = null; reasons[code] = "not_measured"; continue; }
    if (code === "howto_schema_alignment") { values[code] = null; reasons[code] = "not_applicable"; continue; }
    values[code] = (i++ * 37) % 101;
  }
  const pillars = scoreAllPillars(values, reasons);
  return {
    auditId: "aud_1",
    target: {
      url: "https://example.com/pricing", page_type: "pricing",
      page_type_label: "Pricing page", device_profile: "desktop", audit_profile: "balanced",
    },
    finalScore: 61.2, seoScore: 64.1, aeoScore: 55.3, geoScore: 58.8,
    coverage: 84.5,
    frameworks: {
      overall: { score: 61.2, coverage: 84.5 }, seo: { score: 64.1, coverage: 82.1 },
      aeo: { score: 55.3, coverage: 88.4 }, geo: { score: 58.8, coverage: 86.0 },
    },
    pillars,
    penalties: [{ code: "NOINDEX", severity: "critical", factor: 0.5, label: "Page is marked noindex", description: "The page explicitly asks not to be indexed." }],
    penaltyMultiplier: 0.5,
    scoreMath: { prePenaltyTotal: 122.4, penaltyMultiplier: 0.5, finalScore: 61.2 },
    estimatedTotalLift: 18.4,
    issues: [{ code: "AC-01", pillar: "answer_clarity", severity: "critical", frameworks: ["aeo", "geo"], title: "The page never directly answers its own question", evidence: "No passage is self-contained." }],
    recommendations: [{
      id: "r1", code: "AC-01", pillar: "answer_clarity", frameworks: ["aeo"],
      priority: "high", priorityScore: 90, estimatedLift: 9, owner: "content",
      title: "Add a 40-60 word direct answer", rationale: "Answer engines quote a passage, not a page.",
      status: "open",
      implementationAsset: {
        label: "Answer-first block", format: "markdown",
        body: "## What is it?\n\nTODO: 40-60 word direct answer\n",
      },
    }],
    facts: {
      technical: {
        http_status: 200, indexable: true, canonical_url: "https://example.com/pricing",
        core_web_vitals: { lcp_seconds: 2.1, inp_ms: 180, cls: 0.03 },
        rendering: { raw_html_word_count: 940, rendered_dom_word_count: 1180 },
        ai_crawler_access: { GPTBot: true, ClaudeBot: true, Bytespider: false },
      },
      entity: { ai_citation_sample: { engine: "perplexity", prompt_count: 5, mentions: 5, citations: 4, live: true } },
    },
    evidence: {
      heading_outline: [{ level: 1, text: "Pricing" }, { level: 2, text: "What does it cost?" }],
      direct_answer_blocks: [{ text: "It costs $19." }],
      faq_pairs: [{ q: "Is there a free plan?", a: "Yes." }],
      schema_types: ["Organization", "Product"],
    },
    promptRuns: [{ engine_name: "perplexity", live: true, prompt: "best extraction tool", mention_detected: true, citation_detected: true, cited_domains_json: ["example.com"], sentiment_score: 0.4 }],
    meta: { startedAt: "2026-08-27T10:00:00.000Z", engine: { version: "1" } },
    stageErrors: [],
  };
}

const diffFixture = () => ({
  headline: "Overall improved 4.2 points since the last audit.",
  frameworks: {
    overall: { before: 57, after: 61.2, change: 4.2, comparable: true },
    seo: { before: 60, after: 64.1, change: 4.1, comparable: true },
    aeo: { before: null, after: 55.3, change: null, comparable: false, reason: "coverage differs" },
    geo: { before: 55, after: 58.8, change: 3.8, comparable: true },
  },
  issues: { resolved: [{ code: "SH-09" }], introduced: [{ code: "EA-06" }] },
  caveats: ["Citation sampling used a different engine."],
});

/** The text jsPDF actually laid out, across all pages. */
function pdfText(pdf) {
  const pages = pdf.internal.pages.filter(Boolean);
  const out = [];
  for (const page of pages) {
    for (const op of page) {
      if (typeof op !== "string") continue;
      for (const m of op.matchAll(/\((.*?)\)\s*Tj/g)) out.push(m[1]);
    }
  }
  return out.join("\n");
}

describe("PDF — carries every segment", () => {
  const pdf = () => renderAuditPdf(auditFixture(), { includeConstructs: true, diff: diffFixture() });

  it("prints the pillar breakdown with every signal named", () => {
    const t = pdfText(pdf());
    expect(t).toContain("Pillar breakdown");
    for (const code of Object.keys(SIGNALS)) {
      expect(t, `PDF omits signal ${code}`).toContain(SIGNALS[code].label);
    }
  });

  it("says a signal was not measured rather than printing zero", () => {
    // `unknown` is never `0`. Printing 0 here is a different claim entirely.
    const t = pdfText(pdf());
    expect(t).toContain("not measured");
    expect(t).toContain("not applicable to this page type");
  });

  it("prints the penalty layer and shows the arithmetic", () => {
    const t = pdfText(pdf());
    expect(t).toContain("Blocking penalties");
    expect(t).toContain("Page is marked noindex");
  });

  it("prints the evidence section", () => {
    const t = pdfText(pdf());
    expect(t).toContain("Evidence");
    expect(t).toContain("Answer-engine crawler access");
    expect(t).toContain("Heading outline");
    expect(t).toContain("Citation footprint");
  });

  it("flags a BLOCKED answer-engine crawler in words", () => {
    expect(pdfText(pdf())).toContain("Bytespider: BLOCKED");
  });

  it("prints the comparison against the baseline", () => {
    const t = pdfText(pdf());
    expect(t).toContain("Change since the last audit");
    expect(t).toContain("Resolved: SH-09");
  });

  it("renders the ready-to-paste assets", () => {
    // The regression: this filtered on `.content` while templates emit `.body`,
    // so the section rendered empty every single time.
    const t = pdfText(pdf());
    expect(t).toContain("Ready-to-paste assets");
    expect(t).toContain("Answer-first block");
    expect(t).toContain("TODO");
  });
});

describe("CSV — every section is exportable", () => {
  const audit = auditFixture();

  it("exports signals with pillar, weight and state", () => {
    const csv = signalsToCsv(audit);
    expect(csv.split("\n")[0]).toContain("signal_code");
    for (const code of Object.keys(SIGNALS)) expect(csv).toContain(code);
  });

  it("leaves an unmeasured signal BLANK, never 0", () => {
    // A 0 in a spreadsheet gets averaged; a blank does not.
    const row = signalsToCsv(audit).split("\n").find((l) => l.startsWith("Technical Accessibility,") && l.includes("core_web_vitals"));
    expect(row).toBeTruthy();
    expect(row).toContain("not_measured");
    expect(row).not.toMatch(/,0,/);
  });

  it("exports the score summary for frameworks and pillars", () => {
    const csv = scoresToCsv(audit);
    expect(csv).toContain("framework");
    expect(csv).toContain("pillar");
    expect(csv).toContain("coverage_pct");
  });

  it("bundles every section into one file", () => {
    const csv = bundleToCsv(audit);
    for (const marker of ["# scores", "# signals", "# issues", "# recommendations"]) {
      expect(csv).toContain(marker);
    }
  });

  it("still guards against formula injection", () => {
    const hostile = { ...audit, issues: [{ code: "=cmd|'/c calc'!A1", severity: "low", pillar: "x", frameworks: [], title: "t", evidence: "" }] };
    expect(issuesToCsv(hostile)).not.toMatch(/^"?=cmd/m);
  });
});

describe("JSON — carries what the screen shows", () => {
  const payload = () => toJsonPayload(auditFixture());

  it("keeps the existing public keys unchanged", () => {
    // These travel in stored rows and webhook bodies; they are a contract.
    const p = payload();
    for (const k of ["audit_id", "framework_scores", "coverage", "pillar_scores", "penalties", "issues", "recommendations", "score_math"]) {
      expect(p, `dropped public key ${k}`).toHaveProperty(k);
    }
    expect(p.pillar_scores.answer_clarity.signals).toBeTypeOf("object");
  });

  it("carries the evidence the report renders", () => {
    const p = payload();
    expect(p.evidence.heading_outline.length).toBeGreaterThan(0);
    expect(p.evidence.faq_pairs.length).toBeGreaterThan(0);
    expect(p.evidence.schema_types).toContain("Organization");
  });

  it("distinguishes not-measured from not-applicable per signal", () => {
    const byCode = Object.fromEntries(payload().signal_detail.map((s) => [s.code, s]));
    expect(byCode.core_web_vitals.unknown_reason).toBe("not_measured");
    expect(byCode.howto_schema_alignment.applicable).toBe(false);
    expect(byCode.core_web_vitals.score).toBeNull();
  });

  it("carries the copy-ready assets and flags placeholders", () => {
    const a = payload().implementation_assets;
    expect(a.length).toBe(1);
    expect(a[0].body).toContain("TODO");
    expect(a[0].has_placeholders).toBe(true);
  });

  it("carries the citation prompt runs", () => {
    expect(payload().prompt_runs[0].engine).toBe("perplexity");
  });

  it("names the score band for each framework", () => {
    expect(payload().bands.overall).toBeTruthy();
  });
});

describe("Markdown — the baseline every other format is measured against", () => {
  it("names every signal and prints no undefined", () => {
    const md = buildMarkdownReport(auditFixture(), { includeConstructs: true, diff: diffFixture() });
    expect(md).not.toMatch(/undefined/);
    for (const code of Object.keys(SIGNALS)) expect(md).toContain(SIGNALS[code].label);
  });

  it("degrades a label-less penalty to its code, never to undefined", () => {
    // A stored engine_json written by an older build may not carry `label`.
    const a = auditFixture();
    a.penalties = [{ code: "NOINDEX", factor: 0.2 }];
    const md = buildMarkdownReport(a);
    expect(md).not.toMatch(/undefined/);
    expect(md).toContain("Page is marked noindex");
  });

  it("covers the same sections the PDF now does", () => {
    const md = buildMarkdownReport(auditFixture(), { includeConstructs: true, diff: diffFixture() });
    for (const section of ["## Scores", "## Pillars", "## Issues", "## Evidence", "## Change since the last audit"]) {
      expect(md).toContain(section);
    }
  });
});
