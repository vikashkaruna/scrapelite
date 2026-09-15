// answerAnalysis.js — the Answer Clarity pillar.
//
// Answers the question AEO cares about most: if an assistant wanted to quote
// this page, what exactly would it lift, and would that fragment make sense?
//
// Every analyser in this directory returns the same shape, so the pipeline can
// merge them without knowing anything about their internals:
//
//   { signals, reasons, issues, facts }
//
//   signals  code → 0-100, or null for "could not judge"
//   reasons  code → why it is null ("not_measured" | "not_applicable")
//   issues   [{ code, evidence, signalCode, measuredScore, details }]
//   facts    the raw evidence, stored so every score stays explainable

import {
  concisenessScore, answerPositionScore, extractableFormattingScore,
  IDEAL_ANSWER_MIN, IDEAL_ANSWER_MAX,
} from "../../../../src/lib/discoverability/signalScorers.js";
import { passageIndependence } from "./htmlParse.js";
import { nullEvidenceCollector } from "./evidenceCollector.js";

/** Below this a passage is too thin to be considered an answer candidate. */
const MIN_ANSWER_WORDS = 15;
/** Below this an answer reads as a stub rather than a complete statement. */
const FRAGMENT_WORDS = 25;
/** Above this an answer can no longer be quoted whole. */
const MAX_QUOTABLE_WORDS = 200;

/**
 * Pick the passage an answer engine would most likely quote.
 *
 * Ranked, not simply "the first paragraph". Answer engines select by fit, not
 * by document order, so the audit has to model selection rather than position
 * alone — otherwise a page whose real answer sits under the second heading
 * gets told it has no answer at all.
 *
 * Preference order, expressed as an additive score:
 *   • sits under the H1 or a question heading  (this is what "answer-first" means)
 *   • lands in the 40-60 word band             (the length that survives quoting)
 *   • appears early in the document
 */
export function pickAnswerPassage(passages = []) {
  const candidates = passages.filter(
    (p) => p.wordCount >= MIN_ANSWER_WORDS && p.wordCount <= 400,
  );
  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    let s = 0;
    if (p.level === 1 || p.level === 0) s += 40;      // lede, or straight under the H1
    if (p.isQuestion) s += 35;                        // answering an explicit question
    if (p.wordCount >= IDEAL_ANSWER_MIN && p.wordCount <= IDEAL_ANSWER_MAX) s += 30;
    else if (p.wordCount <= MAX_QUOTABLE_WORDS) s += 10;
    s += Math.max(0, 25 - p.position / 4);            // earlier is better
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

export function analyseAnswerClarity(parsed, ctx = {}) {
  const signals = {};
  const reasons = {};
  const issues = [];
  const E = ctx.evidence || nullEvidenceCollector();

  const passages = parsed.passages || [];
  const answer = pickAnswerPassage(passages);
  const structures = parsed.structures || {};

  // ── direct_answer_block ──────────────────────────────────────────────────
  if (!answer) {
    signals.direct_answer_block = 0;
    signals.conciseness = 0;
    signals.passage_independence = 0;
    issues.push({
      code: "AC-01",
      signalCode: "direct_answer_block",
      measuredScore: 0,
      evidence: parsed.wordCount > 0
        ? `No passage on this page is a self-contained answer of at least ${MIN_ANSWER_WORDS} words.`
        : "The page has no extractable body text at all.",
      details: { passageCount: passages.length, pageWordCount: parsed.wordCount },
    });
  } else {
    // Presence is binary; placement is what scales it. A perfect answer at 80%
    // depth is still a buried answer.
    const positionScore = answerPositionScore(answer.position) ?? 50;
    signals.direct_answer_block = Math.round(100 * (0.55 + 0.45 * (positionScore / 100)));

    signals.conciseness = concisenessScore(answer.wordCount);
    signals.passage_independence = passageIndependence(answer.text);

    if (answer.position > 25) {
      issues.push({
        code: "AC-05", signalCode: "direct_answer_block",
        measuredScore: signals.direct_answer_block,
        evidence: `The strongest answer passage starts ${answer.position}% of the way down the page.`,
        details: { position: answer.position, heading: answer.heading },
      });
    }
    if (answer.wordCount > MAX_QUOTABLE_WORDS) {
      issues.push({
        code: "AC-03", signalCode: "conciseness", measuredScore: signals.conciseness,
        evidence: `The primary answer runs to ${answer.wordCount} words; ${IDEAL_ANSWER_MIN}-${IDEAL_ANSWER_MAX} is the band that survives being quoted.`,
        details: { wordCount: answer.wordCount },
      });
    } else if (answer.wordCount < FRAGMENT_WORDS) {
      // NOT `< IDEAL_ANSWER_MIN`. A 34-word answer is near-ideal and scores 88
      // for conciseness — calling it "a fragment" in the same breath would have
      // the report contradicting its own score. The issue fires only where the
      // conciseness curve genuinely reads poorly (below 70), which is the point
      // a passage stops being a complete statement.
      issues.push({
        code: "AC-04", signalCode: "conciseness", measuredScore: signals.conciseness,
        evidence: `The primary answer is only ${answer.wordCount} words — a fragment rather than a self-contained answer.`,
        details: { wordCount: answer.wordCount },
      });
    }
    if (signals.passage_independence !== null && signals.passage_independence < 60) {
      issues.push({
        code: "AC-06", signalCode: "passage_independence",
        measuredScore: signals.passage_independence,
        evidence: `The answer opens with a back-reference, so it loses its meaning when quoted on its own: "${answer.text.slice(0, 120)}…"`,
        details: { opening: answer.text.slice(0, 200) },
        // A deterministic pre-screen, not a verdict. Marked down so it cannot
        // outrank a measured fact in the queue; the AI evaluator raises this
        // when it is available and agrees.
        confidenceOverride: ctx.aiEvaluated ? 85 : 55,
      });
    }
  }

  // ── question headings and visible Q&A ────────────────────────────────────
  const stats = parsed.headingStats || {};
  const faqCount = (parsed.faqPairs || []).length;
  const qHeadings = stats.questionHeadings || 0;

  if (qHeadings === 0 && faqCount === 0) {
    signals.question_headings = stats.total > 0 ? 15 : 0;
    issues.push({
      code: "AC-07", signalCode: "question_headings", measuredScore: signals.question_headings,
      evidence: `None of the ${stats.total || 0} headings on this page is phrased as a question a reader would ask.`,
      details: { headingCount: stats.total || 0 },
    });
  } else {
    // Both matter: question-shaped headings, and real answers beneath them.
    const headingPart = Math.min(60, qHeadings * 20);
    const faqPart = Math.min(40, faqCount * 10);
    signals.question_headings = Math.min(100, headingPart + faqPart + 15);
  }

  // ── answer-first discipline across the whole page ────────────────────────
  // A page can have one good answer at the top and narrative build-up under
  // every other question heading. That is issue AC-02, and it is invisible to
  // any check that only looks at the single best passage.
  const questionSections = passages.filter((p) => p.isQuestion && p.wordCount >= MIN_ANSWER_WORDS);
  const narrativeOpeners = questionSections.filter((p) => {
    const ind = passageIndependence(p.text);
    return ind !== null && ind < 60;
  });
  if (questionSections.length >= 2 && narrativeOpeners.length >= 2) {
    issues.push({
      code: "AC-02", signalCode: "direct_answer_block",
      measuredScore: signals.direct_answer_block ?? 0,
      evidence: `${narrativeOpeners.length} of ${questionSections.length} question sections open with context rather than the answer.`,
      details: { sections: narrativeOpeners.map((p) => p.heading).filter(Boolean).slice(0, 5) },
      confidenceOverride: 70,
    });
  }

  // ── scannable formatting ─────────────────────────────────────────────────
  signals.extractable_formatting = extractableFormattingScore({
    lists: structures.lists ?? 0,
    tables: structures.tables ?? 0,
    listItems: structures.listItems ?? 0,
  });
  // Only worth raising on a page long enough for structure to matter. Telling
  // the author of a 120-word page to add a table is noise.
  if ((signals.extractable_formatting ?? 0) < 40 && (parsed.wordCount || 0) > 400) {
    issues.push({
      code: "AC-08", signalCode: "extractable_formatting",
      measuredScore: signals.extractable_formatting,
      evidence: `${parsed.wordCount} words with ${structures.lists ?? 0} lists and ${structures.tables ?? 0} tables — stepwise and comparative content is being carried as prose.`,
      details: structures,
    });
  }

  // ── record what was read ─────────────────────────────────────────────────
  // Emitted here, once per signal, rather than inside each branch above. The
  // branches decide the SCORE; the reading itself — which passage, how long,
  // how far down — is the same whichever branch ran, and duplicating it into
  // every arm is how one arm ends up silently recording nothing.
  E.signal("direct_answer_block", {
    method: "raw_html",
    section: answer?.heading ? `Passage under “${answer.heading}”` : "Page body",
    observedValue: answer
      ? { position_percent: answer.position, word_count: answer.wordCount }
      : { passages: passages.length, page_word_count: parsed.wordCount ?? 0 },
    excerpt: answer?.text || "",
  });
  E.signal("conciseness", {
    method: "derived",
    section: "Primary answer length",
    observedValue: answer ? answer.wordCount : 0,
    structured: { ideal_min: IDEAL_ANSWER_MIN, ideal_max: IDEAL_ANSWER_MAX },
  });
  E.signal("passage_independence", {
    // ALWAYS `derived`, never `model_inference` — even when the pipeline is
    // about to overwrite the value with a model's. This record describes what
    // THIS function did: a deterministic heuristic over the passage text. When
    // a model also runs, the pipeline adds its own `model_inference` record
    // beside this one rather than relabelling this one, so the pre-screen
    // survives as the only independent check on a model that disagrees with the
    // page. Letting `ctx.aiEvaluated` change the method here would file a
    // deterministic reading as a model judgement and lose that check.
    method: "derived",
    section: "Primary answer, read in isolation",
    observedValue: signals.passage_independence ?? null,
    excerpt: answer?.text || "",
  });
  E.signal("question_headings", {
    method: "raw_html",
    selector: "h2, h3",
    section: "Question-shaped headings and visible Q&A",
    observedValue: { question_headings: qHeadings, faq_pairs: faqCount, headings_total: stats.total || 0 },
    structured: {
      questions: (parsed.faqPairs || []).slice(0, 8).map((f) => f.question),
    },
  });
  E.signal("extractable_formatting", {
    method: "raw_html",
    selector: "ul, ol, table",
    section: "Scannable structures",
    observedValue: {
      lists: structures.lists ?? 0,
      tables: structures.tables ?? 0,
      list_items: structures.listItems ?? 0,
      page_word_count: parsed.wordCount ?? 0,
    },
  });

  return {
    signals, reasons, issues,
    facts: {
      direct_answer_blocks: answer
        ? [{
            anchor_heading: answer.heading,
            word_count: answer.wordCount,
            position_percent: answer.position,
            standalone_score: signals.passage_independence,
            excerpt: answer.text.slice(0, 400),
          }]
        : [],
      question_heading_count: qHeadings,
      faq_item_count: faqCount,
      passage_count: passages.length,
      structures,
    },
  };
}
