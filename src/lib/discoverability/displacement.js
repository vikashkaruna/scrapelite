// displacement.js — who won the question, and what we can actually say about why.
//
// PURE. Shared by React and `netlify/`.
//
// The PRD asks for "Competitor X is cited for prompt Y because…". The first
// half is measured. The second half is where this module has to be careful.
//
// ── WE REPORT THE BECAUSE WE OBSERVED, NOT THE BECAUSE WE INFERRED ─────────
// We know which prompt was asked, who was cited, whether we were named, and
// what the engine's own answer said. We do NOT know why a model chose a source;
// nobody does, including the model. A sentence like "Clay is cited because they
// have better domain authority" is a plausible-sounding invention about a third
// party, published inside a report the customer forwards to their board.
//
// So the narrative states the OBSERVABLE asymmetry — they were cited on this
// prompt and you were not; here is the question; here is what their answer was
// sourced from — and stops. That is genuinely useful and entirely defensible.
// Anything past it is astrology with a citation count.

import { CITATION_STATES } from "./citationStates.js";

/** Minimum appearances before a rival is worth naming in a narrative. */
export const DISPLACEMENT_MIN_APPEARANCES = 1;

/** How many displacement entries a report will carry. */
export const MAX_DISPLACEMENTS = 10;

/**
 * The prompts where a competitor was present and the brand was not.
 *
 * That asymmetry is the whole finding: a question being answered, and answered
 * by somebody else. A prompt where nobody appeared is a different finding —
 * an open question — and belongs in `openQuestions` below, not here.
 */
export function displacements(runs = [], { limit = MAX_DISPLACEMENTS } = {}) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || r.error) continue;
    const present = CITATION_STATES[r.state]?.present;
    if (present) continue;                            // we were there; not displaced
    const rivals = (r.competitors || []).filter(Boolean);
    if (rivals.length < DISPLACEMENT_MIN_APPEARANCES) continue;

    out.push({
      prompt: r.prompt,
      kind: r.kind || null,
      commercial: Boolean(r.commercial),
      state: r.state,
      // Declared rivals lead: those are the ones the operator is actually
      // competing against by their own account.
      competitors: [...rivals].sort((a, b) => (b.declared - a.declared) || (b.citations - a.citations)),
      // What the engine actually sourced. The observable half of "because".
      sourcedFrom: rivals.map((c) => c.host),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Prompts nobody won — neither us nor a tracked rival.
 *
 * Worth separating because the action is opposite. A displaced prompt means
 * somebody already owns the answer and you are arguing with an incumbent; an
 * open one means the question is unclaimed, which makes it the cheapest thing
 * on the list to win.
 */
export function openQuestions(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .filter((r) => r && !r.error && r.state === "absent" && !(r.competitors || []).length)
    .map((r) => ({ prompt: r.prompt, kind: r.kind || null, commercial: Boolean(r.commercial) }));
}

/**
 * One displacement, as a sentence.
 *
 * ⚠️ EVERY CLAUSE IS SOMETHING WE MEASURED. It names the prompt, who was cited
 * and whether the prompt was one where being named is advocacy. It does not
 * speculate about why the engine chose them, because we did not observe that
 * and neither did anybody else.
 */
export function describeDisplacement(d) {
  if (!d || !d.prompt) return null;
  const names = (d.competitors || []).map((c) => c.host);
  if (!names.length) return null;

  const who = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const inferred = (d.competitors || []).filter((c) => !c.declared).length;

  return [
    `Asked "${d.prompt}", the engine sourced ${who} and did not name you.`,
    d.commercial
      ? "This is a prompt where being named is a recommendation, not just recall."
      : null,
    inferred
      ? `${inferred === names.length ? "These domains were" : `${inferred} of these was`} inferred to be a competitor from the citation, not declared by you — check the list before acting on it.`
      : null,
  ].filter(Boolean).join(" ");
}

/**
 * The whole picture: who is taking the questions, and which are unclaimed.
 *
 * `byCompetitor` ranks rivals by how many prompts they took from us, which is
 * the number that answers "who is actually beating us here" — as opposed to
 * share of voice, which answers "how loud is everyone".
 */
export function displacementReport(runs = [], { limit = MAX_DISPLACEMENTS } = {}) {
  const taken = displacements(runs, { limit });
  const open = openQuestions(runs);

  const tally = new Map();
  for (const d of taken) {
    for (const c of d.competitors) {
      const prev = tally.get(c.host) || { host: c.host, declared: c.declared, prompts: 0 };
      prev.prompts += 1;
      prev.declared = prev.declared || c.declared;
      tally.set(c.host, prev);
    }
  }

  return {
    displaced: taken.map((d) => ({ ...d, narrative: describeDisplacement(d) })),
    openQuestions: open,
    byCompetitor: [...tally.values()].sort((a, b) =>
      (b.declared - a.declared) || (b.prompts - a.prompts) || a.host.localeCompare(b.host)),
    displacedCount: taken.length,
    openCount: open.length,
  };
}
