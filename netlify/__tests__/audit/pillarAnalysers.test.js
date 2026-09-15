// pillarAnalysers.test.js — the three pillar analysers the pipeline composes.
//
// answerAnalysis, structureAnalysis and entityAnalysis had no direct tests:
// they were exercised only through auditPipeline, where a mis-scored signal is
// one number among forty and an issue firing on the wrong page is invisible.
// These pin the decisions each one makes, including the two rules the whole
// module rests on — `unknown` is never `0`, and an absent thing is never a
// defect when it does not apply.

import { describe, it, expect, vi } from "vitest";
import { analyseAnswerClarity, pickAnswerPassage } from "../../functions/lib/audit/answerAnalysis.js";
import { analyseStructure, textIsVisible } from "../../functions/lib/audit/structureAnalysis.js";
import { analyseEntityAuthority, schemaCompleteness } from "../../functions/lib/audit/entityAnalysis.js";
import { parsePage } from "../../functions/lib/audit/htmlParse.js";
import { IDEAL_ANSWER_MIN } from "../../../src/lib/discoverability/signalScorers.js";

const codes = (r) => r.issues.map((i) => i.code);
const words = (n, lead = "DatIQ") => [lead, ...Array.from({ length: n - 1 }, (_, i) => `word${i}`)].join(" ");
const passage = (over = {}) => ({
  heading: "What is DatIQ?", level: 2, isQuestion: true, position: 5,
  wordCount: 50, text: words(50), ...over,
});

// ── Answer clarity ─────────────────────────────────────────────────────────
describe("pickAnswerPassage", () => {
  it("returns null when nothing is long enough to be an answer", () => {
    expect(pickAnswerPassage([])).toBeNull();
    expect(pickAnswerPassage([passage({ wordCount: 12 })])).toBeNull();
  });

  it("models selection by fit, not document order", () => {
    const lede = passage({ heading: null, level: 0, isQuestion: false, position: 0, wordCount: 150 });
    const answer = passage({ heading: "How does it work?", position: 10, wordCount: IDEAL_ANSWER_MIN + 5 });
    expect(pickAnswerPassage([lede, answer])).toBe(answer);
  });
});

describe("analyseAnswerClarity", () => {
  it("scores a page with no body text as a measured failure, not an unknown", () => {
    const r = analyseAnswerClarity({ passages: [], wordCount: 0, headingStats: { total: 0 } });
    expect(r.signals.direct_answer_block).toBe(0);
    expect(r.signals.conciseness).toBe(0);
    expect(r.signals.question_headings).toBe(0);
    expect(codes(r)).toEqual(expect.arrayContaining(["AC-01", "AC-07"]));
    expect(r.issues.find((i) => i.code === "AC-01").evidence).toMatch(/no extractable body text/);
  });

  it("raises nothing against a well-placed, well-sized, self-contained answer", () => {
    const r = analyseAnswerClarity({
      passages: [passage({ text: "DatIQ extracts structured data from any public page without code." , wordCount: 50 })],
      wordCount: 300,
      headingStats: { total: 3, questionHeadings: 1 },
      faqPairs: [],
      structures: { lists: 1, tables: 0, listItems: 4 },
    });
    expect(r.signals.direct_answer_block).toBe(100);
    expect(r.signals.conciseness).toBe(100);
    expect(r.signals.passage_independence).toBe(100);
    expect(codes(r)).not.toEqual(expect.arrayContaining(["AC-01", "AC-03", "AC-04", "AC-05", "AC-06"]));
    expect(r.facts.direct_answer_blocks).toHaveLength(1);
    expect(r.facts.direct_answer_blocks[0].anchor_heading).toBe("What is DatIQ?");
  });

  it("marks a buried answer down and says how far down it sits", () => {
    const r = analyseAnswerClarity({ passages: [passage({ position: 40 })], wordCount: 800, headingStats: { total: 2 } });
    expect(codes(r)).toContain("AC-05");
    expect(r.signals.direct_answer_block).toBe(80);
  });

  it("calls a 20-word answer a fragment, and a 250-word one too long to quote", () => {
    expect(codes(analyseAnswerClarity({ passages: [passage({ wordCount: 20 })], headingStats: {} }))).toContain("AC-04");
    const long = analyseAnswerClarity({ passages: [passage({ wordCount: 250 })], headingStats: {} });
    expect(codes(long)).toContain("AC-03");
    expect(codes(long)).not.toContain("AC-04");
  });

  it("flags a back-referencing answer with LOWER confidence unless a model agreed", () => {
    const opening = "it is also why teams pick the tool over manual copy work.";
    const heuristic = analyseAnswerClarity({ passages: [passage({ text: opening })], headingStats: {} });
    const ac06 = heuristic.issues.find((i) => i.code === "AC-06");
    expect(ac06).toBeTruthy();
    expect(ac06.confidenceOverride).toBe(55);
    const withModel = analyseAnswerClarity({ passages: [passage({ text: opening })], headingStats: {} }, { aiEvaluated: true });
    expect(withModel.issues.find((i) => i.code === "AC-06").confidenceOverride).toBe(85);
  });

  it("raises AC-02 only when several question sections open with narrative", () => {
    const narrative = (h) => passage({ heading: h, text: `it ${words(30, "depends")}`, wordCount: 30 });
    const r = analyseAnswerClarity({ passages: [narrative("Why?"), narrative("How?")], headingStats: { total: 2, questionHeadings: 2 } });
    expect(codes(r)).toContain("AC-02");
    const single = analyseAnswerClarity({ passages: [narrative("Why?")], headingStats: { total: 1, questionHeadings: 1 } });
    expect(codes(single)).not.toContain("AC-02");
  });

  it("only asks a LONG page for lists and tables", () => {
    const flat = { lists: 0, tables: 0, listItems: 0 };
    expect(codes(analyseAnswerClarity({ passages: [], wordCount: 500, structures: flat, headingStats: {} }))).toContain("AC-08");
    expect(codes(analyseAnswerClarity({ passages: [], wordCount: 120, structures: flat, headingStats: {} }))).not.toContain("AC-08");
  });

  it("records evidence once per signal, whichever branch scored it", () => {
    const evidence = { signal: vi.fn() };
    analyseAnswerClarity({ passages: [], headingStats: {} }, { evidence });
    expect(evidence.signal.mock.calls.map((c) => c[0]).sort()).toEqual([
      "conciseness", "direct_answer_block", "extractable_formatting", "passage_independence", "question_headings",
    ]);
    // A deterministic heuristic is always filed as `derived`, never as a model's judgement.
    expect(evidence.signal.mock.calls.find((c) => c[0] === "passage_independence")[1].method).toBe("derived");
  });
});

// ── Structural hierarchy ───────────────────────────────────────────────────
describe("textIsVisible", () => {
  it("tolerates punctuation and a shortened answer, not a different one", () => {
    expect(textIsVisible("How much does it cost?", "... how much does it cost ...")).toBe(true);
    expect(textIsVisible("Plans start at forty dollars a month for teams", "Our plans start at forty dollars every month for small teams")).toBe(true);
    expect(textIsVisible("We offer free lifetime upgrades forever", "Pricing is per seat, billed annually.")).toBe(false);
    expect(textIsVisible("", "anything")).toBe(true);
  });
});

describe("analyseStructure", () => {
  const stats = (over = {}) => ({ total: 3, h1Count: 1, h1Text: "Pricing plans", skipped: 0, empty: 0, ...over });

  it("reports a page with no headings as one undifferentiated chunk", () => {
    const r = analyseStructure({ headingStats: { total: 0, h1Count: 0 } });
    expect(r.signals.heading_tree_integrity).toBe(0);
    expect(codes(r)).toEqual(expect.arrayContaining(["SH-10", "SH-01"]));
  });

  it("names skipped levels, empty headings and competing H1s separately", () => {
    const r = analyseStructure({ headingStats: stats({ skipped: 2, empty: 1, h1Count: 2 }) });
    expect(codes(r)).toEqual(expect.arrayContaining(["SH-04", "SH-05", "SH-02"]));
  });

  it("🔴 excludes FAQ alignment when the page has no FAQ — absence is not a defect", () => {
    const r = analyseStructure({ headingStats: stats(), faqPairs: [{ question: "Only one?", answer: "Yes" }] });
    expect(r.signals.faq_schema_alignment).toBeNull();
    expect(r.reasons.faq_schema_alignment).toBe("not_applicable");
    expect(codes(r)).not.toContain("SH-06");
  });

  it("asks for FAQPage markup when visible Q&A has none", () => {
    const r = analyseStructure({
      headingStats: stats(),
      faqPairs: [{ question: "Is it free?", answer: "Yes." }, { question: "Can I cancel?", answer: "Anytime." }],
    });
    expect(r.signals.faq_schema_alignment).toBe(25);
    expect(codes(r)).toContain("SH-06");
  });

  it("raises SH-07 when the markup describes text nobody can see", () => {
    const faq = {
      "@type": "FAQPage",
      mainEntity: [
        { name: "Is DatIQ free?", acceptedAnswer: { text: "There is a free plan." } },
        { name: "Does DatIQ offer lifetime unlimited licences?", acceptedAnswer: { text: "Contact our enterprise desk for bespoke arrangements." } },
      ],
    };
    const r = analyseStructure({
      headingStats: stats(),
      jsonLd: [faq],
      text: "Is DatIQ free? There is a free plan.",
    });
    expect(codes(r)).toContain("SH-07");
    expect(r.signals.faq_schema_alignment).toBe(50);
  });

  it("scores aligned FAQ markup at 100", () => {
    const r = analyseStructure({
      headingStats: stats(),
      jsonLd: [{ "@type": "FAQPage", mainEntity: [{ name: "Is DatIQ free?", acceptedAnswer: { text: "There is a free plan." } }] }],
      text: "Is DatIQ free? There is a free plan.",
    });
    expect(r.signals.faq_schema_alignment).toBe(100);
  });

  it("does not treat a three-bullet summary as a procedure", () => {
    const r = analyseStructure({
      headingStats: stats(),
      steps: [{ name: "Audit", text: "Audit" }, { name: "Fix", text: "Fix" }, { name: "Re-run", text: "Re-run" }],
    });
    expect(r.signals.howto_schema_alignment).toBeNull();
    expect(codes(r)).not.toContain("SH-08");
  });

  it("asks for HowTo markup on a real procedure", () => {
    const step = (t) => ({ name: t, text: t });
    const r = analyseStructure({
      headingStats: stats(),
      steps: [step("Paste the page URL into the box"), step("Choose what you want extracted"), step("Export the result as CSV")],
    });
    expect(r.signals.howto_schema_alignment).toBe(25);
    expect(codes(r)).toContain("SH-08");
  });

  it("does not ask the homepage for breadcrumbs, but does ask a deep page", () => {
    expect(analyseStructure({ headingStats: stats(), url: "https://example.com/" }).signals.breadcrumb_semantics).toBe(100);
    const deep = analyseStructure({ headingStats: stats(), url: "https://example.com/pricing/teams" });
    expect(deep.signals.breadcrumb_semantics).toBe(20);
    expect(codes(deep)).toContain("SH-09");
  });

  it("carries vague internal anchors as a finding that moves no score", () => {
    const r = analyseStructure({
      headingStats: stats(),
      links: { internal: [{ text: "click here", href: "/a" }, { text: "Pricing for teams", href: "/b" }] },
    });
    const sh11 = r.issues.find((i) => i.code === "SH-11");
    expect(sh11).toBeTruthy();
    expect(sh11.signalCode).toBeNull();
    expect(sh11.details.vague_count).toBe(1);
  });
});

// ── Entity authority ───────────────────────────────────────────────────────
describe("schemaCompleteness", () => {
  it("scores the properties that make an identity resolvable", () => {
    expect(schemaCompleteness({ name: "Acme", url: "https://acme.test", logo: "l.png", sameAs: ["x"] }, "Organization")).toBe(100);
    expect(schemaCompleteness({ name: "Acme", url: "https://acme.test", sameAs: [] }, "Organization")).toBe(50);
    expect(schemaCompleteness({ name: "Acme" }, "Widget")).toBeNull();
  });
});

describe("analyseEntityAuthority", () => {
  const org = (over = {}) => ({
    "@type": "Organization", name: "Acme", url: "https://acme.test", logo: "https://acme.test/logo.png",
    sameAs: ["https://linkedin.com/company/acme", "https://x.com/acme", "https://github.com/acme"],
    ...over,
  });

  it("separates 'no structured data at all' from 'data that identifies nobody'", () => {
    expect(codes(analyseEntityAuthority({ jsonLd: [], schemaTypes: [] }))).toEqual(expect.arrayContaining(["EA-01", "TA-15"]));
    const other = analyseEntityAuthority({ jsonLd: [{ "@type": "BreadcrumbList" }], schemaTypes: ["BreadcrumbList"] });
    expect(codes(other)).toEqual(expect.arrayContaining(["EA-01", "EA-10"]));
    expect(codes(other)).not.toContain("TA-15");
  });

  it("rewards a complete, well-linked organisation", () => {
    const r = analyseEntityAuthority({ jsonLd: [org()], schemaTypes: ["Organization"], wordCount: 100 });
    expect(r.signals.schema_identity_completeness).toBe(100);
    expect(r.signals.sameas_consistency).toBe(100);
    expect(codes(r)).not.toEqual(expect.arrayContaining(["EA-02", "EA-03", "EA-11"]));
    expect(r.facts.brand_name).toBe("Acme");
  });

  it("names the missing Organization properties", () => {
    const r = analyseEntityAuthority({ jsonLd: [org({ logo: undefined, sameAs: undefined })], schemaTypes: ["Organization"] });
    expect(r.issues.find((i) => i.code === "EA-02").details.missing).toEqual(["logo", "sameAs"]);
  });

  it("🔴 EA-11 fires for a declared-but-nameless Product beside a complete Organization", () => {
    const r = analyseEntityAuthority({ jsonLd: [org(), { "@type": "Product", description: "A thing" }], schemaTypes: ["Organization", "Product"] });
    expect(r.issues.find((i) => i.code === "EA-11").details.unresolvable).toEqual(["Product"]);
  });

  it("accepts a language-tagged name and never flags a WebSite for lacking one", () => {
    const tagged = analyseEntityAuthority({ jsonLd: [org({ name: { "@value": "Acme", "@language": "en" } })], schemaTypes: ["Organization"] });
    expect(codes(tagged)).not.toContain("EA-11");
    const site = analyseEntityAuthority({ jsonLd: [org(), { "@type": "WebSite", url: "https://acme.test" }], schemaTypes: ["Organization", "WebSite"] });
    expect(codes(site)).not.toContain("EA-11");
  });

  it("gives profile links that are visible but undeclared partial credit", () => {
    const r = analyseEntityAuthority({
      jsonLd: [], schemaTypes: [],
      links: { profiles: [{ href: "https://linkedin.com/company/acme" }], external: [] },
    });
    expect(r.signals.sameas_consistency).toBe(40);
    expect(codes(r)).toContain("EA-03");
  });

  it("scores author trust by what a reader and a parser can each confirm", () => {
    expect(codes(analyseEntityAuthority({ jsonLd: [], author: {} }))).toContain("EA-04");
    const r = analyseEntityAuthority({ jsonLd: [], author: { name: "Priya", visible: true, inSchema: true } });
    expect(r.signals.author_trust_signals).toBe(75);
    expect(codes(r)).toContain("EA-05");
  });

  it("🔴 leaves citation footprint and AI visibility UNKNOWN when nothing was sampled", () => {
    const r = analyseEntityAuthority({ jsonLd: [] });
    expect(r.signals.citation_footprint).toBeNull();
    expect(r.reasons.citation_footprint).toBe("not_measured");
    expect(r.signals.ai_visibility).toBeNull();
    expect(r.reasons.ai_visibility).toBe("no_engine_configured");
    expect(r.facts.ai_citation_sample).toBeNull();
  });

  it("distinguishes 'never mentioned' from 'mentioned but never cited', trusting live samples more", () => {
    const absent = analyseEntityAuthority({ jsonLd: [] }, { citationSample: { promptCount: 5, mentions: 0, citations: 0, live: true } });
    expect(absent.issues.find((i) => i.code === "EA-08").confidenceOverride).toBe(80);
    const recall = analyseEntityAuthority({ jsonLd: [] }, { citationSample: { promptCount: 5, mentions: 2, citations: 0, live: false } });
    expect(recall.issues.find((i) => i.code === "EA-09").confidenceOverride).toBe(55);
  });

  it("asks for a visible date, and for sourcing only on a long page", () => {
    const short = analyseEntityAuthority({ jsonLd: [], dates: {}, wordCount: 200, links: { external: [], profiles: [] } });
    expect(codes(short)).toContain("EA-06");
    expect(codes(short)).not.toContain("EA-07");
    const long = analyseEntityAuthority({ jsonLd: [], dates: {}, wordCount: 900, links: { external: [], profiles: [] } });
    expect(codes(long)).toContain("EA-07");
  });
});

// ── End to end over the real parser ────────────────────────────────────────
describe("the three analysers over parsePage", () => {
  const html = `<!doctype html><html><head><title>DatIQ pricing plans</title>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Organization", name: "DatIQ", url: "https://datiq.app", logo: "https://datiq.app/logo.png",
      sameAs: ["https://linkedin.com/company/datiq"],
    })}</script></head><body>
    <h1>DatIQ pricing plans</h1>
    <h2>How much does DatIQ cost?</h2>
    <p>DatIQ has a free plan with ten extractions a month, and paid plans that start at a few dollars a month for individuals and scale to agencies that run thousands of extractions across many client workspaces every month.</p>
    <h2>What do paid plans include?</h2>
    <ul><li>Batch extraction for many URLs</li><li>Scheduled monitoring of pages</li><li>Exports to CSV, PDF, Markdown and JSON</li></ul>
  </body></html>`;

  it("agrees with itself about the page it read", () => {
    const parsed = parsePage(html, "https://datiq.app/pricing");
    const answer = analyseAnswerClarity(parsed);
    const structure = analyseStructure(parsed);
    const entity = analyseEntityAuthority(parsed);

    expect(structure.facts.h1_count).toBe(1);
    expect(codes(structure)).not.toContain("SH-01");
    expect(answer.facts.direct_answer_blocks).toHaveLength(1);
    expect(answer.facts.direct_answer_blocks[0].anchor_heading).toBe("How much does DatIQ cost?");
    expect(answer.signals.question_headings).toBeGreaterThan(15);
    expect(entity.facts.brand_name).toBe("DatIQ");
    expect(entity.facts.schema_types).toContain("Organization");
  });
});
