// evidenceModel.js — the shape every observation in an audit has to take.
//
// PURE. Zero I/O, no clock, no randomness — imported by BOTH the React app and
// the Netlify functions, exactly like signalRegistry.js and entitlementModel.js.
// `collectedAt` is therefore a PARAMETER, never `Date.now()`: a module that
// reads the clock cannot be replayed, and an audit that cannot be replayed
// cannot be diffed against itself.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE REQUIREMENT THIS FILE EXISTS TO SATISFY
// ═══════════════════════════════════════════════════════════════════════════
// The BRD is unambiguous, and it is the sentence the whole product rests on:
//
//   "Every signal and issue must retain evidence. Evidence includes source URL,
//    selector or extracted section, observed value, excerpt/structured object,
//    collection timestamp and confidence."
//
// Before this file, a signal's evidence was free-form JSON that nothing wrote
// and an issue's evidence was a single `text` column holding a sentence. Both
// were readable and neither was checkable: nothing could answer "where exactly
// on the page did you see that, and when, and how sure are you?" — which is the
// question a customer asks the moment a finding surprises them.
//
// ── WHY AN ENVELOPE AND NOT JUST MORE COLUMNS ──────────────────────────────
// Six consumers read an observation: the scorer, the issue list, the
// recommendation engine, the report writer, the diff engine and (from P2) the
// entity graph. If each one reaches into a different ad-hoc shape, adding a
// seventh means auditing six call sites. One constructor, one shape, and a
// record that fails to build returns `null` rather than a half-populated object
// that reads as evidence downstream.
//
// ── THE RULE THAT SHAPES THE CONSTRUCTOR: NO SOURCE, NO EVIDENCE ───────────
// `makeEvidence` returns `null` for an unknown method or a missing source URL.
// It does NOT fill in a default. An evidence record whose provenance was
// guessed is worse than an absent one, because absence is visible in the UI
// ("not measured") while a fabricated source is indistinguishable from a real
// observation and gets quoted back to the customer as fact.
//
// ── OBSERVATION IS NOT INFERENCE, AND THE METHOD IS WHAT SAYS SO ───────────
// The BRD requires observed facts and model inference to be separate fields,
// and the design principles give the canonical example: "JSON-LD is invalid" is
// a measured fact; "this may suppress citation likelihood" is a reasoned
// inference. Rather than ask every call site to remember the distinction, it is
// carried by `method`: each method declares `observed: true|false`, so
// `isObserved(record)` is a property of how the thing was learned rather than a
// flag someone can forget to set. `model_inference` and `derived` are the two
// methods that are NOT observations, and they are the two whose confidence
// defaults are lowest.

/**
 * How an observation was made, what it is worth, and whether it is an
 * observation at all.
 *
 * `confidence` is the DEFAULT for that method — a call site may lower it (a
 * lenient text match, a partial parse) but the default encodes how much the
 * method itself can be trusted before anything specific to this page is known.
 *
 * The values are ordered deliberately, not sprinkled:
 *
 *   0.95-0.99  we read it directly out of bytes the server sent us
 *   0.85-0.90  we derived it, or a third party measured it for us
 *   0.50-0.60  a model or a volatile external system produced it
 *
 * `observed: false` marks the two methods that produce a CONCLUSION rather than
 * a reading. Everything the product says about them must be labelled as
 * inference wherever it is shown.
 */
export const EVIDENCE_METHODS = Object.freeze({
  http_response: {
    confidence: 0.99, observed: true, label: "HTTP response",
    describes: "Status, headers, redirect chain and final URL as returned by the origin.",
  },
  raw_html: {
    confidence: 0.99, observed: true, label: "Raw HTML",
    describes: "The markup as delivered, before any JavaScript ran — what a non-rendering crawler receives.",
  },
  rendered_dom: {
    confidence: 0.97, observed: true, label: "Rendered DOM",
    describes: "The document after hydration, as a rendering crawler or a human would see it.",
  },
  json_ld: {
    confidence: 0.99, observed: true, label: "JSON-LD",
    describes: "A parsed structured-data node lifted from a script tag.",
  },
  microdata: {
    confidence: 0.95, observed: true, label: "Microdata",
    describes: "Inline itemscope/itemprop markup read from the document.",
  },
  robots_txt: {
    confidence: 0.95, observed: true, label: "robots.txt",
    describes: "A directive read from the host's own robots.txt.",
  },
  sitemap: {
    confidence: 0.90, observed: true, label: "Sitemap",
    describes: "A declaration read from an XML sitemap or a sitemap reference.",
  },
  external_api: {
    confidence: 0.85, observed: true, label: "External measurement",
    describes: "A reading taken by a third-party service, such as lab performance data.",
  },
  answer_engine: {
    confidence: 0.60, observed: true, label: "Answer-engine sample",
    describes: "One sampled answer from a live answer engine. Real, but volatile between runs.",
  },
  model_inference: {
    confidence: 0.50, observed: false, label: "Model inference",
    describes: "A judgement produced by a language model rather than measured from the page.",
  },
  derived: {
    confidence: 0.90, observed: false, label: "Derived",
    describes: "A conclusion computed from other observations in this same audit.",
  },
});

export const EVIDENCE_METHOD_IDS = Object.freeze(Object.keys(EVIDENCE_METHODS));

/**
 * Excerpt cap, in characters.
 *
 * 300 is not arbitrary — it is the same cap `audit_prompt_runs` already applies
 * to answer-engine output, and the reasoning transfers: an excerpt exists to
 * let a human recognise the thing being described, not to reproduce it. Keeping
 * one number for both means a reviewer reading a report cannot tell which
 * subsystem produced a given quote, which is the point.
 */
export const EVIDENCE_EXCERPT_MAX = 300;

/**
 * Cap on the serialised size of `structured`, in characters.
 *
 * Evidence rides along on every signal and every issue, so an unbounded object
 * here multiplies across ~20 signals and up to ~44 issues per audit and then
 * across every audit in a trend query. A structured payload that does not fit
 * is DROPPED rather than truncated: half a JSON object is not a smaller fact,
 * it is a different and possibly wrong one.
 */
export const EVIDENCE_STRUCTURED_MAX = 4000;

/** Clamp to the [0,1] range confidence is expressed in everywhere else. */
function clampConfidence(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** Normalise a timestamp to ISO-8601, or null if it is not a real instant. */
function toIso(collectedAt) {
  if (collectedAt == null) return null;
  const d = collectedAt instanceof Date ? collectedAt : new Date(collectedAt);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return d.toISOString();
}

/** Trim, collapse whitespace and cap. Returns null for nothing worth keeping. */
function toExcerpt(value) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > EVIDENCE_EXCERPT_MAX ? `${s.slice(0, EVIDENCE_EXCERPT_MAX - 1)}…` : s;
}

/**
 * Keep a structured payload only if it is a plain object AND fits the cap.
 *
 * Anything else — an array at the top level, a class instance, a cyclic graph —
 * is dropped. `structured` is meant to be a small record of what was read, and
 * accepting arbitrary shapes here is how a jsonb column becomes a dumping
 * ground nothing dares to query.
 */
function toStructured(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let serialised;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return null;                      // cyclic, or carries something unserialisable
  }
  if (!serialised || serialised === "{}") return null;
  if (serialised.length > EVIDENCE_STRUCTURED_MAX) return null;
  return JSON.parse(serialised);      // a detached plain-object copy
}

/**
 * Build one evidence record.
 *
 * @param {object}  input
 * @param {string}  input.method         one of EVIDENCE_METHOD_IDS. REQUIRED.
 * @param {string}  input.sourceUrl      where the observation was made. REQUIRED.
 * @param {string} [input.selector]      CSS selector, JSON path or header name.
 * @param {string} [input.section]       human-readable location ("first viewport", "H2 #3").
 * @param {*}      [input.observedValue] the measured value itself.
 * @param {string} [input.excerpt]       a short quote of what was read.
 * @param {object} [input.structured]    a small structured record of the reading.
 * @param {number|string|Date} input.collectedAt  when. REQUIRED — no clock in here.
 * @param {number} [input.confidence]    0-1 override; defaults from `method`.
 * @returns {object|null} a frozen record, or null when it would not be evidence.
 */
export function makeEvidence({
  method,
  sourceUrl,
  selector = null,
  section = null,
  observedValue = undefined,
  excerpt = null,
  structured = null,
  collectedAt,
  confidence,
} = {}) {
  const meta = EVIDENCE_METHODS[method];
  if (!meta) return null;                             // unknown method — never guess one

  const url = typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  if (!url) return null;                              // no source, no evidence

  const at = toIso(collectedAt);
  if (!at) return null;                               // an undated observation cannot be replayed

  return Object.freeze({
    method,
    observed: meta.observed,
    source_url: url,
    selector: selector ? String(selector).slice(0, 400) : null,
    section: section ? String(section).slice(0, 200) : null,
    observed_value: observedValue === undefined ? null : observedValue,
    excerpt: toExcerpt(excerpt),
    structured: toStructured(structured),
    collected_at: at,
    confidence: clampConfidence(confidence, meta.confidence),
  });
}

/** Is this a record `makeEvidence` would have produced? */
export function isEvidence(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.method === "string"
    && EVIDENCE_METHODS[value.method]
    && typeof value.source_url === "string"
    && value.source_url
    && typeof value.collected_at === "string",
  );
}

/** Was this learned by reading something, rather than concluded? */
export function isObserved(value) {
  return isEvidence(value) && value.observed === true;
}

/**
 * Normalise whatever a call site passed into an array of valid records.
 *
 * Accepts one record, an array, or nothing, and silently discards anything that
 * is not evidence. Discarding rather than throwing is deliberate: a malformed
 * evidence record must never be able to fail an audit that otherwise succeeded.
 * The finding still stands on its own; it is simply less well supported, and
 * `evidenceConfidence` will report that.
 */
export function evidenceList(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter(isEvidence);
}

/**
 * How well supported is a claim backed by these records?
 *
 * The STRONGEST record wins rather than the mean, because evidence accumulates
 * — a fact read straight from the HTTP response does not become less certain
 * because a model also had an opinion about it. Averaging would let a
 * low-confidence corroboration drag down a direct reading, which is backwards.
 *
 * Returns null for no evidence, so the caller can say "unsupported" rather than
 * "0% confident" — the same `unknown` is never `0` discipline the scorer uses.
 */
export function evidenceConfidence(value) {
  const list = evidenceList(value);
  if (list.length === 0) return null;
  return list.reduce((best, e) => Math.max(best, e.confidence), 0);
}

/**
 * Split a set of records into what was seen and what was concluded.
 *
 * This is the primitive the issue record uses to keep `observed_fact` and
 * `inference` apart, and the report writer uses to label them differently.
 */
export function partitionEvidence(value) {
  const list = evidenceList(value);
  return {
    observed: list.filter((e) => e.observed),
    inferred: list.filter((e) => !e.observed),
  };
}

/**
 * One human-readable line describing where a record came from.
 *
 * Used in reports and the evidence panel. Deliberately states the METHOD, not
 * just the location: "the H1 said X" and "a model thought the H1 said X" are
 * different claims and a reader is entitled to know which one they are reading.
 */
export function describeEvidence(record) {
  if (!isEvidence(record)) return "";
  const meta = EVIDENCE_METHODS[record.method];
  const where = record.section || record.selector || null;
  const parts = [meta.label];
  if (where) parts.push(where);
  const head = parts.join(" · ");
  return record.excerpt ? `${head} — “${record.excerpt}”` : head;
}

// ═══════════════════════════════════════════════════════════════════════════
// ATTACHING EVIDENCE TO A SCORED AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lift declared thresholds out of a signal's evidence.
 *
 * Most signals are CURVES, not thresholds — conciseness declines either side of
 * a band, heading integrity is a proportion of a tree, render completeness is a
 * ratio — so most signals legitimately have none and this returns null rather
 * than inventing a boundary. Putting a number in front of a customer that the
 * scorer never applied is worse than showing no number.
 *
 * The ones that DO have a published cut-off declare it in the evidence they
 * emit, which keeps the threshold that was applied and the threshold that is
 * reported as one value rather than two that can drift apart.
 */
export function extractThresholds(records = []) {
  for (const r of evidenceList(records)) {
    const st = r.structured;
    if (!st) continue;
    if (st.thresholds && typeof st.thresholds === "object" && !Array.isArray(st.thresholds)) {
      return st.thresholds;
    }
    if (st.ideal_min !== undefined || st.ideal_max !== undefined) {
      return { ideal_min: st.ideal_min ?? null, ideal_max: st.ideal_max ?? null };
    }
  }
  return null;
}

/**
 * Decorate a scored pillar set with the observations behind each signal.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT TWO ───────────────────────────────────
 * Two paths produce a scored audit: the pipeline, which has just made the
 * observations, and `rehydrate()`, which is reading them back out of Postgres.
 * If each attached evidence its own way, a fresh audit and a stored one would
 * render differently — and that is precisely the bug `rehydrate.test.js` exists
 * to pin, in its own words *"the worst shape a bug can take: a fresh audit
 * renders perfectly, so it never reproduces while you are looking at it."*
 * One function, called by both, makes them identical by construction rather
 * than by two field lists happening to agree.
 *
 * ── WHY rawValue AND thresholds ARE DERIVED HERE, NOT READ FROM COLUMNS ────
 * `audit_signals` stores `raw_value` and `threshold_json` as their own columns,
 * and this function ignores them on the way back in. That is deliberate: the
 * columns exist so "twelve months of core_web_vitals raw values" is an index
 * scan rather than a JSON walk, and they are written FROM these same records at
 * persist time. Deriving on read means the two can never disagree, and a
 * mismatch caused by a partial write shows up as a stale query result rather
 * than as a score whose stated workings contradict its own evidence.
 *
 * The FIRST record is the primary reading, not the strongest: the analyser
 * pushes its direct observation first and anything after it is refinement or
 * corroboration, so first-wins preserves "what was actually measured" while
 * `confidence` (which does take the strongest) reports how well supported it is.
 *
 * @param {object} pillars    the scorer's pillar map, unmodified
 * @param {object} bySignal   { [signalCode]: EvidenceRecord[] }
 * @returns {object} a new pillar map; the input is not mutated
 */
export function attachEvidenceToPillars(pillars = {}, bySignal = {}) {
  const out = {};
  for (const [pillarId, pillar] of Object.entries(pillars)) {
    out[pillarId] = {
      ...pillar,
      signals: (pillar.signals || []).map((signal) => {
        const records = evidenceList(bySignal[signal.code]);
        return {
          ...signal,
          evidence: records,
          rawValue: records.length ? records[0].observed_value : null,
          thresholds: extractThresholds(records),
          confidence: evidenceConfidence(records),
        };
      }),
    };
  }
  return out;
}
