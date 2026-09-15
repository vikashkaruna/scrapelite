/**
 * P2 · W13 — Trust & Proof.
 *
 * W11 shipped three scores with a hole in each: `trust_credibility` (20% of
 * BDS), `trust_proof` (15% of PDS) and `trust_signals` (10% of SFS) all bind to
 * a `trust_proof` source that did not exist, so all three read `null` and were
 * redistributed. This is that source.
 *
 * ── 🔴 THE ONE RULE THIS MODULE EXISTS FOR ────────────────────────────────
 *
 * **EVIDENCE QUALITY, NEVER EVIDENCE VOLUME.** Ten unattributed testimonials on
 * a page the business controls must never outscore one verifiable third-party
 * record. A model that counts is trivially gamed by the party being measured —
 * and worse, it *rewards* the behaviour, so the number goes up while the thing
 * it claims to measure goes down. Every signal here is scored by
 * `INDEPENDENCE` × `VERIFIABILITY`, and a self-published claim is capped no
 * matter how many of them there are.
 *
 * ⚠️ AND IT NEVER FABRICATES. A review, a customer name, a credential or an
 * award that the audit did not observe is `absent`, not zero-rated and not
 * invented — the same rule `constructTemplates` follows when it emits a
 * `TODO:` rather than a plausible founder name. These values end up in a score
 * a customer forwards to a client.
 *
 * ── WHERE THE COMPONENT NAMES COME FROM ───────────────────────────────────
 *
 * 🔴 **THE PRD GIVES `TC = 0.25D + 0.20R + 0.20P + 0.15M + 0.10C + 0.10X` AND
 * EXPANDS THE INITIALS NOWHERE IN THIS REPOSITORY** — the fourth time, after
 * W4's "M1–M13", W10's fourteen types and W11's own component ids. **The
 * WEIGHTS are copied verbatim and asserted**; only the names behind the
 * initials are derived, under the same hard constraint W11 used: every
 * component must bind to something this engine can already measure, recorded
 * as `source` on the component.
 *
 * ⚠️ **IF THE PRD'S EXPANSION DIFFERS, CHANGE THE `label` AND `binding` — NEVER
 * THE WEIGHT AND NEVER THE ID.** The weight is the PRD's and is already right;
 * the id travels in stored rows and every historical diff, so renaming one
 * silently mis-attributes history exactly as `audit_recommendations.issue_id`
 * did. That is why the derivation is a declared field rather than a comment.
 *
 * ── WHY THREE COMPONENTS AND NOT ONE ──────────────────────────────────────
 *
 * ⚠️ **TC, TP AND TR ASK DIFFERENT QUESTIONS, AND W11 ALREADY WROTE THEM
 * DOWN.** Its own `describes` strings are the specification:
 *   · TC (brand)   — "third-party evidence that the business is real and well regarded"
 *   · TP (product) — "reviews, ratings and named customers attached to this product"
 *   · TR (service) — "credentials, accreditations and proof of past work"
 * Collapsing them into one number would tell a services business its score is
 * low because it has no product reviews, which is not a defect — it is a
 * category error, and the remedy it implies is work that would not help.
 */

import { weightedMean } from "./scoringModel.js";
import { makeEvidence } from "./evidenceModel.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp100 = (n) => Math.max(0, Math.min(100, n));

// ── How much a claim is worth, by who is making it ─────────────────────────
//
// 🔴 THIS TABLE IS THE WHOLE MODEL. A claim published by the subject about
// itself is the weakest evidence there is, and it is also the easiest to
// produce in bulk — so it is capped, not counted. An independent record the
// reader can go and check is worth several times more, and that ratio is the
// only thing standing between "trust score" and "testimonial counter".
export const INDEPENDENCE = Object.freeze({
  self_published: Object.freeze({
    id: "self_published", weight: 0.25, label: "Published by the subject",
    describes: "A claim on a page the subject controls. Real, but unverified by anyone else.",
  }),
  self_attributed: Object.freeze({
    id: "self_attributed", weight: 0.50, label: "Self-published but attributed",
    describes: "A claim naming a real, checkable party — a named customer, a named awarding body.",
  }),
  third_party: Object.freeze({
    id: "third_party", weight: 1.00, label: "Independent record",
    describes: "Held by somebody other than the subject: a directory, a registry, a review platform.",
  }),
});
export const INDEPENDENCE_IDS = Object.freeze(Object.keys(INDEPENDENCE));

/**
 * The highest score reachable from self-published material alone.
 *
 * 🔴 THIS IS A DERIVED FACT, NOT A SEPARATE CAP, and the difference matters.
 * An earlier draft applied `Math.min(best, 40)` as a ceiling — a guard that
 * could NEVER FIRE, because `INDEPENDENCE.self_published.weight` is 0.25 and
 * already bounds the score at 25. A redundant guard that reads as load-bearing
 * is worse than none: it invites a test pinned to the guard rather than to the
 * mechanism, which is how "ignores a stored listing whose source is no longer
 * in the registry" passed against a deliberately broken model in W12.
 *
 * The weight table IS the mechanism. This constant exists so the property can
 * be ASSERTED — one independent verified record must outscore any quantity of
 * self-published material — and `trustProof.test.js` asserts exactly that.
 */
export const SELF_PUBLISHED_MAX = Math.round(100 * INDEPENDENCE.self_published.weight);

// ── The measurable trust signals ───────────────────────────────────────────
//
// ⚠️ EVERY ENTRY BINDS TO SOMETHING ALREADY EXTRACTED. `binding` names it, so
// a reader can check the claim rather than take it on faith — and so a signal
// that loses its source fails loudly instead of quietly reading zero.
export const TRUST_SIGNALS = Object.freeze({
  ratings: Object.freeze({
    id: "ratings", label: "Ratings and reviews",
    binding: "AggregateRating / Review in JSON-LD; review presence on an authorised directory listing",
    describes: "Whether anyone other than the subject has rated it, and where that rating can be read.",
  }),
  named_customers: Object.freeze({
    id: "named_customers", label: "Named customers",
    binding: "Organization/Brand references in the entity graph; case-study extraction",
    describes: "Customers named specifically enough that a reader could contact one.",
  }),
  case_studies: Object.freeze({
    id: "case_studies", label: "Proof of past work",
    binding: "Visible case-study structures and their outcome statements",
    describes: "Work described with a subject and an outcome, not an adjective.",
  }),
  credentials: Object.freeze({
    id: "credentials", label: "Credentials and accreditations",
    binding: "schema.org hasCredential / award / memberOf; registry listings (W12 tier `registry`)",
    describes: "Accreditations granted by a named body, which that body could confirm.",
  }),
  media: Object.freeze({
    id: "media", label: "Independent mentions",
    binding: "Approved entity-graph edges to organisations the subject does not control",
    describes: "Being written about by somebody with no stake in the outcome.",
  }),
  identity: Object.freeze({
    id: "identity", label: "Attributable identity",
    binding: "detectAuthor + Person/Organization schema + the W9 truth record",
    describes: "A real, named human or legal entity standing behind the claims.",
  }),
  external_profiles: Object.freeze({
    id: "external_profiles", label: "Independent profiles",
    binding: "W12 directory listings above the `vertical` tier",
    describes: "Existing on platforms the subject does not own.",
  }),
});
export const TRUST_SIGNAL_IDS = Object.freeze(Object.keys(TRUST_SIGNALS));

// ── TC — the PRD's six-term formula ────────────────────────────────────────
//
// Weights are the PRD's, verbatim, and `trustProof.test.js` asserts every one
// so an "align the numbers" pass fails the build with the reasoning attached —
// the same guard `scoringModel.test.js` puts on the penalty model after D1.
export const TC_COMPONENTS = Object.freeze({
  documented_proof: Object.freeze({
    id: "documented_proof", abbr: "D", weight: 0.25,
    signals: Object.freeze(["case_studies", "named_customers"]),
    label: "Documented proof of work",
    derivedFrom: "PRD TC term D (0.25). Name derived; weight verbatim.",
  }),
  ratings_reviews: Object.freeze({
    id: "ratings_reviews", abbr: "R", weight: 0.20,
    signals: Object.freeze(["ratings"]),
    label: "Ratings and reviews",
    derivedFrom: "PRD TC term R (0.20). Name derived; weight verbatim.",
  }),
  people_identity: Object.freeze({
    id: "people_identity", abbr: "P", weight: 0.20,
    signals: Object.freeze(["identity"]),
    label: "Attributable people",
    derivedFrom: "PRD TC term P (0.20). Name derived; weight verbatim.",
  }),
  media_mentions: Object.freeze({
    id: "media_mentions", abbr: "M", weight: 0.15,
    signals: Object.freeze(["media"]),
    label: "Independent mentions",
    derivedFrom: "PRD TC term M (0.15). Name derived; weight verbatim.",
  }),
  credentials: Object.freeze({
    id: "credentials", abbr: "C", weight: 0.10,
    signals: Object.freeze(["credentials"]),
    label: "Credentials",
    derivedFrom: "PRD TC term C (0.10). Name derived; weight verbatim.",
  }),
  external_presence: Object.freeze({
    id: "external_presence", abbr: "X", weight: 0.10,
    signals: Object.freeze(["external_profiles"]),
    label: "Independent presence",
    derivedFrom: "PRD TC term X (0.10). Name derived; weight verbatim.",
  }),
});
export const TC_COMPONENT_IDS = Object.freeze(Object.keys(TC_COMPONENTS));

/**
 * Which signals each subject kind's trust component actually reads.
 *
 * ⚠️ A SIGNAL A KIND DOES NOT USE IS NOT SCORED ZERO FOR IT — it is simply not
 * part of that question. Scoring a service on absent product reviews would
 * report a category error as a failing, and send the customer to collect
 * something that would not help them.
 */
export const KIND_SIGNALS = Object.freeze({
  brand:   Object.freeze(["ratings", "named_customers", "case_studies", "credentials", "media", "identity", "external_profiles"]),
  product: Object.freeze(["ratings", "named_customers", "case_studies"]),
  service: Object.freeze(["credentials", "case_studies", "identity", "ratings"]),
});

// ── Observations ───────────────────────────────────────────────────────────

/**
 * One observed trust claim.
 *
 * ⚠️ `absent` IS NOT A SCORE OF ZERO, and the two must never collapse. "We
 * looked at the review markup and there are no reviews" and "we could not read
 * this page" produce the same number under a naive model and opposite advice.
 * An observation that could not be made is simply not made — `null` in,
 * excluded out, exactly as `unknown is never 0` requires everywhere else.
 *
 * ⚠️ `independence` IS NOT ACCEPTED FROM A CLIENT — see `trustRoute` in
 * `discoverability.js`. It is a claim about WHO holds the evidence, and a claim
 * the measured party can set is not a claim: it is `?consented=true` wearing a
 * fourth hat.
 */
export function makeObservation({
  signal, independence, count = 0, verifiable = false,
  sourceUrl = null, excerpt = null, collectedAt = null, method = "raw_html",
} = {}) {
  const sig = TRUST_SIGNALS[signal];
  if (!sig) return null;                                  // unknown signal — never invent one
  const ind = INDEPENDENCE[independence];
  if (!ind) return null;                                  // unknown provenance — never guess one

  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return null;

  // An independent record with no URL cannot be checked, so it is not an
  // independent record — it is a claim about one. Demoting rather than
  // refusing keeps the observation, which is the honest outcome.
  const effective = ind.id === "third_party" && !sourceUrl
    ? INDEPENDENCE.self_attributed
    : ind;

  const evidence = sourceUrl
    ? makeEvidence({
        method, sourceUrl, excerpt,
        observedValue: n,
        collectedAt: collectedAt || new Date().toISOString(),
      })
    : null;

  return Object.freeze({
    signal: sig.id,
    independence: effective.id,
    count: Math.floor(n),
    verifiable: Boolean(verifiable && sourceUrl),
    evidence,
  });
}

/**
 * Score one signal from its observations.
 *
 * 🔴 SATURATING, NOT LINEAR. The second record is worth less than the first and
 * the tenth is worth almost nothing, because "has any independent rating at
 * all" is the question that separates two businesses — not whether one has 40
 * and the other 60. A linear count would make the score a popularity measure of
 * whoever publishes most.
 */
export function scoreSignal(observations = []) {
  const rows = (Array.isArray(observations) ? observations : [])
    .filter((o) => o && TRUST_SIGNALS[o.signal]);
  if (rows.length === 0) return null;                     // absent ≠ zero — see makeObservation

  let best = 0;

  for (const o of rows) {
    const ind = INDEPENDENCE[o.independence] || INDEPENDENCE.self_published;

    // Diminishing returns on count: 1 → 0.60, 2 → 0.84, 3 → 0.94, → 1.00.
    // ⚠️ The base is load-bearing, not a taste: it is what puts ONE independent
    // verified record (60) above ANY quantity of self-published material, which
    // is capped at SELF_PUBLISHED_CEILING (40). Raise the base and volume starts
    // winning again; that is the whole failure this model exists to avoid.
    const n = Math.max(0, o.count);
    const depth = n === 0 ? 0 : 1 - Math.pow(0.4, n);
    const verified = o.verifiable ? 1 : 0.8;

    best = Math.max(best, clamp100(100 * ind.weight * Math.max(0, depth) * verified));
  }

  return Math.round(best * 10) / 10;
}

/**
 * The strongest provenance observed for a signal, or `null` if nothing was.
 *
 * ⚠️ READ DIRECTLY RATHER THAN INFERRED FROM THE SCORE. `trustGaps` used to
 * decide "self-published only" by testing `value < 40`, which is a guess about
 * how the value was produced — and it would start lying the moment a weight
 * moved. Provenance is a fact the observations already carry; asking them is
 * both correct and cheaper.
 */
export function signalProvenance(observations = []) {
  const rows = (Array.isArray(observations) ? observations : [])
    .filter((o) => o && TRUST_SIGNALS[o.signal] && INDEPENDENCE[o.independence]);
  if (rows.length === 0) return null;
  return rows
    .map((o) => INDEPENDENCE[o.independence])
    .sort((a, b) => b.weight - a.weight)[0].id;
}

/**
 * The trust score for one subject kind.
 *
 * Returns `{ score, coverage, signals, unmeasured }`. `score` is `null` when
 * nothing was observed at all — which is the truthful answer, and is what keeps
 * the component redistributed rather than dragging the subject score down for a
 * page nobody audited.
 */
export function trustScore(kind, observationsBySignal = {}) {
  const wanted = KIND_SIGNALS[kind];
  if (!wanted) return null;

  const perSignal = wanted.map((id) => ({
    signal: id,
    value: scoreSignal(observationsBySignal[id] || []),
    provenance: signalProvenance(observationsBySignal[id] || []),
  }));

  // Within a kind every wanted signal carries equal weight: the PRD weights TC's
  // six terms, not this set, and inventing a second weighting here would be a
  // number nobody chose — the same reason `threshold_json` is usually NULL.
  const { score, coverage } = weightedMean(
    perSignal.map((s) => ({ value: s.value, weight: 1 })),
  );

  return Object.freeze({
    kind,
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    signals: Object.freeze(perSignal.map((s) => Object.freeze({
      ...s,
      label: TRUST_SIGNALS[s.signal].label,
      binding: TRUST_SIGNALS[s.signal].binding,
    }))),
    unmeasured: Object.freeze(perSignal.filter((s) => !isNum(s.value)).map((s) => s.signal)),
  });
}

/**
 * TC on the PRD's own six terms, for the brand scorecard.
 *
 * Kept beside `trustScore` rather than replacing it because the two answer
 * different questions: this one reports how the PRD's formula scored, which is
 * what a reader checking our arithmetic against the spec needs.
 */
export function tcScore(observationsBySignal = {}) {
  const entries = TC_COMPONENT_IDS.map((id) => {
    const c = TC_COMPONENTS[id];
    const parts = c.signals
      .map((s) => scoreSignal(observationsBySignal[s] || []))
      .filter(isNum);
    return {
      id,
      abbr: c.abbr,
      weight: c.weight,
      label: c.label,
      value: parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 : null,
    };
  });

  const { score, coverage } = weightedMean(entries.map((e) => ({ value: e.value, weight: e.weight })));

  return Object.freeze({
    code: "TC",
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    components: Object.freeze(entries.map(Object.freeze)),
    unmeasured: Object.freeze(entries.filter((e) => !isNum(e.value)).map((e) => e.id)),
  });
}

/**
 * What would most improve this subject's trust score, and why.
 *
 * ⚠️ ORDERED BY THE GAP EACH ONE CLOSES, NOT BY WHAT IS EASIEST. And an
 * absent signal is reported as absent rather than as a failure: "you have no
 * independent rating anywhere" and "your rating is poor" are opposite findings
 * with opposite remedies, and collapsing them is the BT-01/BT-02 mistake.
 */
export function trustGaps(result) {
  if (!result || !KIND_SIGNALS[result.kind]) return Object.freeze([]);

  return Object.freeze(
    result.signals
      .filter((s) => !isNum(s.value) || s.provenance === "self_published")
      .map((s) => Object.freeze({
        signal: s.signal,
        label: s.label,
        state: !isNum(s.value) ? "absent" : "self_published_only",
        // Said plainly, because the difference decides what the reader does.
        why: !isNum(s.value)
          ? `Nothing was observed for ${TRUST_SIGNALS[s.signal].label.toLowerCase()}.`
          : "Only self-published claims were found. An independent record scores higher because a reader can go and check it.",
        binding: s.binding,
      }))
      .sort((a, b) => (a.state === b.state ? 0 : a.state === "absent" ? -1 : 1)),
  );
}
