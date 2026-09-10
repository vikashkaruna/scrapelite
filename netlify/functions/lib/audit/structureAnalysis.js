// structureAnalysis.js — the Structural Hierarchy pillar.
//
// Retrieval systems chunk a document on its heading tree. A broken tree does
// not merely look untidy: it merges sections that should be separate and
// splits an answer away from the question it answers, so good content becomes
// unretrievable in pieces.
//
// This pillar also owns the FAQ/HowTo alignment checks, which are the only
// place in the engine that compares MARKUP against VISIBLE TEXT. That
// comparison is what separates the two opposite findings: "you have FAQs and no
// markup" (add markup) from "your markup describes text nobody can see"
// (remove or correct it).

import {
  headingTreeIntegrityScore, singleH1Score,
} from "../../../../src/lib/discoverability/signalScorers.js";
import { findSchema } from "./htmlParse.js";
import { nullEvidenceCollector } from "./evidenceCollector.js";

/**
 * How many visible Q&A pairs make a page an FAQ.
 *
 * One question-shaped H2 with an answer under it is an ARTICLE SECTION. Telling
 * every explainer with a single "How does X work?" heading to add FAQPage
 * markup is noise, and noise is what makes an audit get ignored. A set of them
 * is an FAQ.
 */
const MIN_FAQ_PAIRS = 2;

/** Minimum average words per step before a list counts as a procedure. */
const MIN_STEP_WORDS = 4;

/** Normalise for comparison — punctuation and spacing must not create a mismatch. */
function normaliseForMatch(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

/**
 * Does a marked-up string appear in the visible text?
 *
 * Deliberately lenient. The guidance is that markup should REPRESENT visible
 * content, not be a byte-identical copy of it — an answer shortened for the
 * markup is normal and fine. We therefore ask whether the marked-up text is
 * substantially present, and only report a mismatch when it is plainly not,
 * because a false SH-07 accuses the author of bad faith over a trailing full
 * stop.
 */
export function textIsVisible(markupText, visibleText) {
  const needle = normaliseForMatch(markupText);
  const hay = normaliseForMatch(visibleText);
  if (!needle) return true;
  if (needle.length < 12) return hay.includes(needle);
  if (hay.includes(needle)) return true;
  // Substantial overlap: most of the marked-up words appear in the page.
  const words = needle.split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return true;
  const present = words.filter((w) => hay.includes(w)).length;
  return present / words.length >= 0.7;
}

export function analyseStructure(parsed, ctx = {}) {
  const signals = {};
  const reasons = {};
  const issues = [];
  // Absent in unit tests, which call this with a bare `{}`. See
  // nullEvidenceCollector's own comment for why that is a real collector rather
  // than an optional chain at every call site.
  const E = ctx.evidence || nullEvidenceCollector();

  const stats = parsed.headingStats || {};
  const jsonLd = parsed.jsonLd || [];
  const visible = parsed.text || "";

  // ── heading tree ─────────────────────────────────────────────────────────
  signals.heading_tree_integrity = headingTreeIntegrityScore({
    skipped: stats.skipped ?? 0, empty: stats.empty ?? 0, total: stats.total ?? 0,
  });
  E.signal("heading_tree_integrity", {
    method: "raw_html",
    selector: "h1, h2, h3, h4, h5, h6",
    section: "Heading outline",
    observedValue: { total: stats.total ?? 0, skipped: stats.skipped ?? 0, empty: stats.empty ?? 0 },
    excerpt: (parsed.headings || []).slice(0, 6).map((h) => `H${h.level} ${h.text}`).join(" › "),
    structured: { outline: (parsed.headings || []).slice(0, 40).map((h) => ({ level: h.level, text: h.text })) },
  });

  if ((stats.total ?? 0) === 0) {
    issues.push({
      code: "SH-10", signalCode: "heading_tree_integrity", measuredScore: 0,
      evidence: "The page contains no heading elements, so the whole document is one undifferentiated chunk.",
      details: {},
    });
  } else {
    if ((stats.skipped ?? 0) > 0) {
      issues.push({
        code: "SH-04", signalCode: "heading_tree_integrity",
        measuredScore: signals.heading_tree_integrity,
        evidence: `${stats.skipped} place${stats.skipped === 1 ? "" : "s"} in the outline drop more than one heading level at once.`,
        details: { skipped: stats.skipped, outline: (parsed.headings || []).slice(0, 40).map((h) => ({ level: h.level, text: h.text })) },
      });
    }
    if ((stats.empty ?? 0) > 0) {
      issues.push({
        code: "SH-05", signalCode: "heading_tree_integrity",
        measuredScore: signals.heading_tree_integrity,
        evidence: `${stats.empty} heading tag${stats.empty === 1 ? " contains" : "s contain"} no text — almost always a styling shortcut.`,
        details: { empty: stats.empty },
      });
    }
  }

  // ── H1 ───────────────────────────────────────────────────────────────────
  signals.single_h1 = singleH1Score({
    h1Count: stats.h1Count ?? 0,
    h1Text: stats.h1Text || "",
    titleText: parsed.meta?.title || "",
  });
  E.signal("single_h1", {
    method: "raw_html",
    selector: "h1",
    section: "Page H1",
    observedValue: { h1_count: stats.h1Count ?? 0 },
    excerpt: stats.h1Text || "",
    structured: { h1: stats.h1Text || null, title: parsed.meta?.title || null },
  });
  if ((stats.h1Count ?? 0) === 0) {
    issues.push({
      code: "SH-01", signalCode: "single_h1", measuredScore: 0,
      evidence: "The page has no H1, so it never declares its own subject.",
      details: {},
    });
  } else if (stats.h1Count > 1) {
    issues.push({
      code: "SH-02", signalCode: "single_h1", measuredScore: signals.single_h1,
      evidence: `${stats.h1Count} H1 elements compete to describe this page.`,
      details: { h1Count: stats.h1Count },
    });
  } else if (signals.single_h1 <= 55 && parsed.meta?.title) {
    issues.push({
      code: "SH-03", signalCode: "single_h1", measuredScore: signals.single_h1,
      evidence: `The H1 ("${stats.h1Text}") and the title ("${parsed.meta.title}") share almost no vocabulary.`,
      details: { h1: stats.h1Text, title: parsed.meta.title },
      confidenceOverride: 65,   // vocabulary overlap is a heuristic, not a fact
    });
  }

  // ── FAQ: markup vs what a reader sees ────────────────────────────────────
  const faqSchema = findSchema(jsonLd, "FAQPage");
  const visibleFaq = parsed.faqPairs || [];
  const markupQuestions = faqSchema
    ? [].concat(faqSchema.mainEntity || []).filter(Boolean).map((q) => ({
        question: typeof q?.name === "string" ? q.name : "",
        answer: typeof q?.acceptedAnswer?.text === "string" ? q.acceptedAnswer.text
          : typeof q?.acceptedAnswer === "string" ? q.acceptedAnswer : "",
      }))
    : [];

  const hasFaqSection = visibleFaq.length >= MIN_FAQ_PAIRS;

  // Recorded BEFORE the branching, because every branch below is a reading of
  // these same two counts and a reader comparing markup against visible text
  // needs both numbers whichever way the comparison came out.
  E.signal("faq_schema_alignment", {
    method: faqSchema ? "json_ld" : "raw_html",
    selector: faqSchema ? "script[type='application/ld+json'] FAQPage" : null,
    section: "FAQ content and markup",
    observedValue: { visible_pairs: visibleFaq.length, marked_up_questions: markupQuestions.length },
    excerpt: (visibleFaq[0]?.question) || (markupQuestions[0]?.question) || "",
    structured: {
      visible_questions: visibleFaq.slice(0, 8).map((f) => f.question),
      marked_up_questions: markupQuestions.slice(0, 8).map((q) => q.question),
    },
  });

  if (!faqSchema && !hasFaqSection) {
    // No FAQ section and no FAQ markup. This is NOT a defect — an article that
    // is not an FAQ has nothing to mark up, and scoring it 0 would push authors
    // to bolt a fake FAQ onto every page. The signal drops out instead.
    signals.faq_schema_alignment = null;
    reasons.faq_schema_alignment = "not_applicable";
  } else if (faqSchema && markupQuestions.length > 0) {
    const invisible = markupQuestions.filter(
      (q) => !textIsVisible(q.question, visible) || !textIsVisible(q.answer, visible),
    );
    if (invisible.length > 0) {
      signals.faq_schema_alignment = Math.max(
        0, Math.round(100 * (1 - invisible.length / markupQuestions.length)),
      );
      issues.push({
        code: "SH-07", signalCode: "faq_schema_alignment",
        measuredScore: signals.faq_schema_alignment,
        evidence: `${invisible.length} of ${markupQuestions.length} marked-up FAQ entries describe text that is not on the page.`,
        details: { invisible: invisible.slice(0, 5).map((q) => q.question) },
      });
    } else {
      signals.faq_schema_alignment = 100;
    }
  } else {
    // Visible FAQs, no markup — usually the cheapest single AEO win on a page.
    signals.faq_schema_alignment = 25;
    issues.push({
      code: "SH-06", signalCode: "faq_schema_alignment", measuredScore: 25,
      evidence: `${visibleFaq.length} visible question-and-answer pair${visibleFaq.length === 1 ? "" : "s"} carry no FAQPage markup.`,
      details: { questions: visibleFaq.slice(0, 8).map((f) => f.question) },
    });
  }

  // ── HowTo: same test, procedural content ─────────────────────────────────
  const howToSchema = findSchema(jsonLd, "HowTo");
  const visibleSteps = parsed.steps || [];

  // A three-item list is not a procedure. "Audit / Fix / Re-run" is a summary
  // bullet list, and recommending HowTo markup for it produces markup that
  // describes nothing — the SH-07 defect, manufactured by our own advice. A
  // real procedure has steps with substance, or announces itself in a heading.
  const avgStepWords = visibleSteps.length
    ? visibleSteps.reduce((a, s) => a + String(s.text || "").trim().split(/\s+/).filter(Boolean).length, 0) / visibleSteps.length
    : 0;
  const proceduralHeading = (parsed.headings || []).some(
    (h) => /\b(how to|step\s*\d|tutorial|walkthrough|instructions|setup guide)\b/i.test(h.text || ""),
  );
  const looksProcedural = visibleSteps.length >= 3
    && (avgStepWords >= MIN_STEP_WORDS || proceduralHeading);

  E.signal("howto_schema_alignment", {
    method: howToSchema ? "json_ld" : "raw_html",
    selector: howToSchema ? "script[type='application/ld+json'] HowTo" : "ol > li",
    section: "Procedural content and markup",
    observedValue: {
      visible_steps: visibleSteps.length,
      avg_step_words: Math.round(avgStepWords),
      procedural_heading: proceduralHeading,
      has_markup: Boolean(howToSchema),
    },
    excerpt: visibleSteps[0]?.text || visibleSteps[0]?.name || "",
    structured: { steps: visibleSteps.slice(0, 8).map((st) => st.name || st.text) },
  });

  if (!howToSchema && !looksProcedural) {
    signals.howto_schema_alignment = null;
    reasons.howto_schema_alignment = "not_applicable";
  } else if (howToSchema) {
    const steps = [].concat(howToSchema.step || []).filter(Boolean);
    const invisible = steps.filter((s) => {
      const t = typeof s?.text === "string" ? s.text : typeof s?.name === "string" ? s.name : "";
      return t && !textIsVisible(t, visible);
    });
    signals.howto_schema_alignment = steps.length === 0 ? 40
      : Math.max(0, Math.round(100 * (1 - invisible.length / steps.length)));
    if (invisible.length > 0) {
      issues.push({
        code: "TA-14", signalCode: "howto_schema_alignment",
        measuredScore: signals.howto_schema_alignment,
        evidence: `${invisible.length} HowTo step${invisible.length === 1 ? "" : "s"} describe content not visible on the page.`,
        details: {},
      });
    }
  } else {
    signals.howto_schema_alignment = 25;
    issues.push({
      code: "SH-08", signalCode: "howto_schema_alignment", measuredScore: 25,
      evidence: `${visibleSteps.length} visible ordered steps carry no HowTo markup.`,
      details: { steps: visibleSteps.slice(0, 8).map((s) => s.name) },
    });
  }

  // ── breadcrumbs ──────────────────────────────────────────────────────────
  const crumb = findSchema(jsonLd, "BreadcrumbList");
  const isRootPage = (() => {
    try {
      const u = new URL(parsed.url || "");
      return u.pathname === "" || u.pathname === "/";
    } catch { return false; }
  })();

  E.signal("breadcrumb_semantics", {
    method: crumb ? "json_ld" : "raw_html",
    selector: crumb ? "script[type='application/ld+json'] BreadcrumbList" : null,
    section: "Site hierarchy",
    observedValue: {
      has_breadcrumb: Boolean(crumb),
      items: crumb ? [].concat(crumb.itemListElement || []).filter(Boolean).length : 0,
      is_root_page: isRootPage,
    },
  });

  if (crumb) {
    const items = [].concat(crumb.itemListElement || []).filter(Boolean);
    signals.breadcrumb_semantics = items.length >= 2 ? 100 : 60;
  } else if (isRootPage) {
    // The root homepage is the apex of the site hierarchy and has no parent breadcrumbs.
    signals.breadcrumb_semantics = 100;
  } else {
    signals.breadcrumb_semantics = 20;
    issues.push({
      code: "SH-09", signalCode: "breadcrumb_semantics", measuredScore: 20,
      evidence: "No BreadcrumbList markup places this page within the site.",
      details: {},
    });
  }

  return {
    signals, reasons, issues,
    facts: {
      heading_outline: (parsed.headings || []).slice(0, 60).map((h) => ({ level: h.level, text: h.text })),
      h1_count: stats.h1Count ?? 0,
      skipped_levels: stats.skipped ?? 0,
      empty_headings: stats.empty ?? 0,
      faq_items_visible: visibleFaq.length,
      faq_items_marked_up: markupQuestions.length,
      howto_steps_visible: visibleSteps.length,
      has_breadcrumb: Boolean(crumb),
    },
  };
}
