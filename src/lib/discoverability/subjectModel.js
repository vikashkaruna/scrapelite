// subjectModel.js — D7. The subject registry, as a pure model.
//
// PURE. Zero I/O. Imported by React AND `netlify/`, exactly like
// `entitlementModel.js` and every other model in this directory, so the subject
// the browser shows and the subject the server stored cannot be computed by two
// different pieces of code.
//
// ── WHAT D7 DECIDED, AND WHY THE OBVIOUS ANSWER WAS REFUSED ───────────────
// P1 audits a PAGE. P2 (W11 onward) audits a BRAND, a PRODUCT, a SERVICE, a
// LOCATION. The recorded default was a polymorphic `subject_type` +
// `subject_id` pair on `audit_issues` — and a uuid that points at
// `audit_targets` on one row and `audit_entities` on the next CANNOT CARRY A
// FOREIGN KEY. This repository has been burned three times by a pointer the
// database could not check; each time the read path returned `null` exactly as
// it would for "not applicable", so the defect was invisible.
//
// Instead the AUDIT is polymorphic, one level up:
//
//   audit_subjects ─< audits ─< audit_issues            ← UNCHANGED
//                           └─< audit_recommendations   ← UNCHANGED
//
// Every reference is a real foreign key and a CHECK constraint decides which
// one applies. `audit_issues` was not touched, so no P1 reader changed.
//
// 🔴 `audits.target_id` IS KEPT. `subject_id` is ADDITIVE and NULL on every
// pre-0057 audit. That is not a gap to be tidied away later — it is the
// backward-compatibility contract, and `sameSubject()` below is written to
// honour it rather than to assume every row has been backfilled.

/**
 * The six kinds, and which reference each one is allowed to carry.
 *
 * ⚠️ `requires` is the model's half of `audit_subjects_kind_matches_ref`. The
 * database enforces it too — deliberately twice, like W9's self-approval rule —
 * because a `page` subject pointing at a brand would score a brand and report
 * it as a page, and nothing downstream would notice.
 */
export const SUBJECT_KINDS = Object.freeze({
  page: {
    id: "page", requires: ["target"], scoreId: null,
    label: "Page",
    describes: "One URL. What P1 has always audited; the fast path, and the reason audits.target_id stays.",
  },
  domain: {
    id: "domain", requires: ["target", "truth_record"], scoreId: null,
    label: "Domain",
    describes: "A whole site, or the business behind it. The one kind that legitimately accepts either reference.",
  },
  brand: {
    id: "brand", requires: ["entity"], scoreId: "brand",
    label: "Brand",
    describes: "Scored by BDS. A brand is the thing a buyer names when they ask an engine who to buy from.",
  },
  product: {
    id: "product", requires: ["entity"], scoreId: "product",
    label: "Product",
    describes: "Scored by PDS.",
  },
  service: {
    id: "service", requires: ["entity"], scoreId: "service",
    label: "Service",
    describes: "Scored by SFS.",
  },
  location: {
    id: "location", requires: ["entity"], scoreId: null,
    label: "Location",
    describes: "A place of business. W12 scores its directory presence; there is no single-number formula for it.",
  },
});

export const SUBJECT_KIND_IDS = Object.freeze(Object.keys(SUBJECT_KINDS));

/** The three reference columns, in the order the database declares them. */
export const SUBJECT_REFS = Object.freeze(["target", "entity", "truth_record"]);

const REF_FIELD = Object.freeze({
  target: "target_id",
  entity: "entity_id",
  truth_record: "truth_record_id",
});

const clean = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Build a subject reference, or return `null` with the reason.
 *
 * Refuses exactly what the two CHECK constraints refuse, and for the same
 * reasons — so a caller learns it was wrong in the model, where the message can
 * say why, rather than as a constraint violation from PostgREST.
 *
 * @returns {{ok:true, subject:object} | {ok:false, reason:string}}
 */
export function makeSubject({
  kind, targetId = null, entityId = null, truthRecordId = null,
  label = "", canonicalDomain = null, workspaceId = null,
} = {}) {
  const spec = SUBJECT_KINDS[kind];
  if (!spec) return { ok: false, reason: `unknown subject kind: ${kind}` };

  const refs = { target: targetId || null, entity: entityId || null, truth_record: truthRecordId || null };
  const present = SUBJECT_REFS.filter((r) => refs[r]);

  if (present.length === 0) return { ok: false, reason: "a subject needs exactly one reference, and none was given" };
  if (present.length > 1) {
    return { ok: false, reason: `a subject needs exactly one reference, and ${present.length} were given (${present.join(", ")})` };
  }
  if (!spec.requires.includes(present[0])) {
    return {
      ok: false,
      reason: `a ${kind} subject must reference ${spec.requires.join(" or ")}, not ${present[0]}`,
    };
  }

  const text = clean(label);
  if (!text) return { ok: false, reason: "a subject needs a label — an unlabelled row is unreadable in every list it appears in" };

  return {
    ok: true,
    subject: {
      subject_kind: kind,
      target_id: refs.target,
      entity_id: refs.entity,
      truth_record_id: refs.truth_record,
      label: text,
      canonical_domain: canonicalDomain ? clean(canonicalDomain).toLowerCase() : null,
      workspace_id: workspaceId || null,
    },
  };
}

/** Which of the three columns a stored subject actually uses. */
export function refOf(subject) {
  if (!subject) return null;
  for (const r of SUBJECT_REFS) if (subject[REF_FIELD[r]]) return r;
  return null;
}

/** The subject-score formula for a kind, or `null` where there is no single number. */
export function scoreIdFor(kind) {
  return SUBJECT_KINDS[kind]?.scoreId ?? null;
}

/**
 * Are two audits about the same thing?
 *
 * 🔴 THE FALLBACK IS THE POINT, NOT A CONVENIENCE. Comparability used to be
 * "same `target_id`". It becomes "same `subject_id`" — but only where BOTH
 * sides have one. A pre-0057 audit carries `subject_id: null`, and treating two
 * nulls as equal would make every old audit comparable with every other old
 * audit regardless of what page it was about, which is far worse than the
 * question being unanswerable.
 *
 * So: both have subjects → compare subjects. Either lacks one → fall back to
 * `target_id`, which every audit has had since 0030. Neither → not comparable.
 */
export function sameSubject(a, b) {
  if (!a || !b) return false;
  const aSub = a.subject_id || null;
  const bSub = b.subject_id || null;
  if (aSub && bSub) return aSub === bSub;

  const aTgt = a.target_id || null;
  const bTgt = b.target_id || null;
  if (aTgt && bTgt) return aTgt === bTgt;

  return false;
}

/**
 * Why two audits are not comparable, in a sentence a customer can act on.
 * Returns `null` when they ARE comparable.
 */
export function subjectMismatchReason(a, b) {
  if (sameSubject(a, b)) return null;
  if (!a || !b) return "One of the two audits could not be read.";
  const aSub = a.subject_id || null;
  const bSub = b.subject_id || null;
  if (aSub && bSub) {
    return "These two audits are about different subjects, so their scores are not comparable.";
  }
  if (!(a.target_id || null) || !(b.target_id || null)) {
    return "One of these audits records no subject and no target, so there is nothing to compare it against.";
  }
  return "These two audits are about different pages, so their scores are not comparable.";
}

/**
 * A stored subject rendered for a list: the kind, the label, and the domain.
 * Never invents a label — a subject without one cannot be created.
 */
export function describeSubject(subject) {
  if (!subject) return null;
  const spec = SUBJECT_KINDS[subject.subject_kind];
  return {
    id: subject.id || null,
    kind: subject.subject_kind,
    kindLabel: spec?.label || subject.subject_kind,
    label: subject.label,
    canonicalDomain: subject.canonical_domain || null,
    ref: refOf(subject),
    scoreId: spec?.scoreId ?? null,
  };
}
