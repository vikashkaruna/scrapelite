/**
 * P2 · W13 — Schema intelligence.
 *
 * P1 already answers "is there structured data on this page" — `EA-01` absent,
 * `EA-02` thin, `EA-11` present-but-unusable. That is a per-PAGE verdict. This
 * module answers the SUBJECT-level question a knowledge graph actually asks:
 * *does the markup across this thing describe one coherent entity, and can it
 * be resolved?* Those come apart — eight pages can each carry valid
 * Organization markup and still name the business three different ways, which
 * resolves as three entities and is invisible to every per-page check.
 *
 * ── WHERE THE COMPONENT NAMES COME FROM ───────────────────────────────────
 *
 * 🔴 SAME SITUATION AS `trustProof.js`: the PRD gives
 * `Schema = 0.30O + 0.30L + 0.20S + 0.10F + 0.10G` and expands the initials
 * nowhere in this repository. **The WEIGHTS are verbatim and asserted**; the
 * names are derived under the constraint that each binds to something already
 * extracted, recorded as `binding`.
 *
 * ⚠️ **IF THE PRD DIFFERS, CHANGE THE `label` AND `binding`, NEVER THE WEIGHT
 * AND NEVER THE ID.** The id travels in stored rows and historical diffs.
 *
 * ── THE RULE THAT SHAPES THE SCORING ──────────────────────────────────────
 *
 * 🔴 **MARKUP THAT CONTRADICTS THE PAGE IS WORSE THAN NO MARKUP, AND SCORES
 * BELOW IT.** This is the one place a higher count must produce a LOWER score.
 * An `FAQPage` block describing questions that do not appear on the page is not
 * partial credit — it is a machine-readable false statement, it is what gets a
 * site's rich results revoked, and this engine's own `constructTemplates`
 * refuses to generate one for exactly that reason. A model that rewarded the
 * block's presence would be recommending the defect it elsewhere reports.
 */

import { weightedMean } from "./scoringModel.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp100 = (n) => Math.max(0, Math.min(100, n));

/**
 * The types this module validates.
 *
 * ⚠️ DELIBERATELY A SHORT LIST. schema.org has hundreds of types and almost all
 * of them are irrelevant to whether an answer engine can resolve a business.
 * Validating everything would produce a long report in which the two findings
 * that matter are buried — the same reasoning `gapTaxonomy` applies when it
 * groups 46 codes into eight root causes.
 */
export const APPROVED_TYPES = Object.freeze({
  Organization: Object.freeze({ id: "Organization", identifying: true,  requires: Object.freeze(["name", "url"]) }),
  LocalBusiness: Object.freeze({ id: "LocalBusiness", identifying: true, requires: Object.freeze(["name", "address"]) }),
  Product:      Object.freeze({ id: "Product",      identifying: true,  requires: Object.freeze(["name"]) }),
  Service:      Object.freeze({ id: "Service",      identifying: true,  requires: Object.freeze(["name"]) }),
  Article:      Object.freeze({ id: "Article",      identifying: false, requires: Object.freeze(["headline"]) }),
  FAQPage:      Object.freeze({ id: "FAQPage",      identifying: false, requires: Object.freeze(["mainEntity"]) }),
  HowTo:        Object.freeze({ id: "HowTo",        identifying: false, requires: Object.freeze(["name", "step"]) }),
  BreadcrumbList: Object.freeze({ id: "BreadcrumbList", identifying: false, requires: Object.freeze(["itemListElement"]) }),
});
export const APPROVED_TYPE_IDS = Object.freeze(Object.keys(APPROVED_TYPES));

/**
 * ⚠️ `WebSite` IS EXCLUDED, EXACTLY AS `EA-11` EXCLUDES IT. The sitelinks
 * search-box pattern is a `WebSite` block carrying `url` + `potentialAction`
 * and no name — common AND correct — so validating it would report a finding
 * across a large share of the healthy web and teach its reader to ignore this
 * whole section.
 */
export const EXCLUDED_TYPES = Object.freeze(["WebSite"]);

// ── The PRD's five terms ───────────────────────────────────────────────────
export const SCHEMA_COMPONENTS = Object.freeze({
  entity_object: Object.freeze({
    id: "entity_object", abbr: "O", weight: 0.30,
    label: "Identifying entity present",
    binding: "findSchema(jsonLd, Organization | LocalBusiness | Product | Service)",
    derivedFrom: "PRD Schema term O (0.30). Name derived; weight verbatim.",
  }),
  lint_validity: Object.freeze({
    id: "lint_validity", abbr: "L", weight: 0.30,
    label: "Markup is valid and complete",
    binding: "JSON-LD parse success + required properties per APPROVED_TYPES",
    derivedFrom: "PRD Schema term L (0.30). Name derived; weight verbatim.",
  }),
  type_spread: Object.freeze({
    id: "type_spread", abbr: "S", weight: 0.20,
    label: "Coverage across applicable types",
    binding: "schemaTypes() + extractMicrodataInventory(), scoped to APPLICABLE types only",
    derivedFrom: "PRD Schema term S (0.20). Name derived; weight verbatim.",
  }),
  fidelity: Object.freeze({
    id: "fidelity", abbr: "F", weight: 0.10,
    label: "Markup matches the visible page",
    binding: "detectVisibleFaq / detectVisibleSteps compared against declared FAQPage / HowTo",
    derivedFrom: "PRD Schema term F (0.10). Name derived; weight verbatim.",
  }),
  graph_linkage: Object.freeze({
    id: "graph_linkage", abbr: "G", weight: 0.10,
    label: "Blocks resolve to one entity",
    binding: "@id / sameAs linkage between blocks and against the W9 canonical domain",
    derivedFrom: "PRD Schema term G (0.10). Name derived; weight verbatim.",
  }),
});
export const SCHEMA_COMPONENT_IDS = Object.freeze(Object.keys(SCHEMA_COMPONENTS));

/**
 * ⚠️ SCOPED TO WHAT THE PAGE COULD REASONABLY CARRY, like `checkAgainstTruthRecord`.
 * Unscoped, `type_spread` reports a pricing page as missing `HowTo` and an
 * article as missing `Product` — findings that are true, useless, and would
 * make every audit of a healthy site look broken.
 */
export function applicableTypes(pageType = null) {
  const base = ["Organization", "BreadcrumbList"];
  const byPage = {
    homepage:   ["LocalBusiness"],
    product:    ["Product"],
    pricing:    ["Product"],
    service:    ["Service"],
    location:   ["LocalBusiness"],
    article:    ["Article"],
    blog:       ["Article"],
    faq:        ["FAQPage"],
    guide:      ["HowTo", "Article"],
    comparison: ["Article"],
  };
  return Object.freeze([...new Set([...base, ...(byPage[pageType] || [])])]);
}

/**
 * Validate one JSON-LD block.
 *
 * Returns `{ type, valid, missing, identifying }`, or `null` for a type this
 * module does not judge — silence, not a failing grade, because "we do not
 * check `Recipe`" and "your `Recipe` is broken" are different statements.
 */
export function validateBlock(block) {
  if (!block || typeof block !== "object") return null;
  const raw = block["@type"];
  const type = Array.isArray(raw) ? raw.find((t) => APPROVED_TYPES[t]) || raw[0] : raw;
  if (typeof type !== "string") return null;
  if (EXCLUDED_TYPES.includes(type)) return null;
  const spec = APPROVED_TYPES[type];
  if (!spec) return null;

  const missing = spec.requires.filter((prop) => {
    const v = block[prop];
    if (v === undefined || v === null) return true;
    // A language-tagged value counts as present — `{"@value": "…"}` is the
    // correct way to write a localised name, and EA-11 already treats it so.
    if (typeof v === "object" && !Array.isArray(v)) return !(v["@value"] || Object.keys(v).length);
    if (Array.isArray(v)) return v.length === 0;
    return String(v).trim() === "";
  });

  return Object.freeze({
    type, identifying: spec.identifying,
    valid: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

/**
 * Score the schema intelligence of one subject.
 *
 * @param {object} input
 *   `jsonLd`        parsed blocks, as `extractJsonLd` returns them
 *   `microdata`     `extractMicrodataInventory()` output
 *   `pageType`      scopes `type_spread`
 *   `visibleFaq`    `detectVisibleFaq()` — count of questions actually on the page
 *   `visibleSteps`  `detectVisibleSteps()` — count of steps actually on the page
 *   `canonicalDomain` the W9 truth record's domain, for `graph_linkage`
 *   `parseFailures` blocks that did not parse at all
 */
export function schemaScore({
  jsonLd = [], microdata = [], pageType = null,
  visibleFaq = null, visibleSteps = null,
  canonicalDomain = null, parseFailures = 0,
} = {}) {
  const blocks = Array.isArray(jsonLd) ? jsonLd : [];
  const judged = blocks.map(validateBlock).filter(Boolean);
  const micro = Array.isArray(microdata) ? microdata : [];

  // ── O — is there an identifying entity at all ──────────────────────────
  const identifying = judged.filter((b) => b.identifying);
  const entityObject = blocks.length === 0 && micro.length === 0
    ? null                                   // nothing to judge — absent ≠ zero
    : identifying.length === 0
      ? 0                                    // markup exists but identifies nothing: that IS a failing
      : clamp100(identifying.some((b) => b.valid) ? 100 : 45);

  // ── L — does it parse, and is it complete ──────────────────────────────
  //
  // 🔴 A PARSE FAILURE OUTWEIGHS A COMPLETE BLOCK. Half-built markup gets
  // merged into the WRONG knowledge-graph entry, which is worse than absence
  // and is why `EA-11` earns a penalty multiplier rather than a deduction.
  const lintValidity = judged.length === 0 && parseFailures === 0
    ? null
    : clamp100(
        judged.length === 0
          ? 0
          : (judged.filter((b) => b.valid).length / judged.length) * 100
            - Math.min(60, parseFailures * 30),
      );

  // ── S — spread across the types this page could carry ──────────────────
  const wanted = applicableTypes(pageType);
  const present = new Set([
    ...judged.map((b) => b.type),
    ...micro.map((m) => m && m.type).filter(Boolean),
  ]);
  const typeSpread = wanted.length === 0
    ? null
    : clamp100((wanted.filter((t) => present.has(t)).length / wanted.length) * 100);

  // ── F — does the markup describe the page that is actually there ───────
  const fidelity = scoreFidelity({ judged, blocks, visibleFaq, visibleSteps });

  // ── G — do the blocks resolve to ONE entity ────────────────────────────
  const graphLinkage = scoreLinkage({ blocks, identifying, canonicalDomain });

  const values = {
    entity_object: entityObject,
    lint_validity: lintValidity,
    type_spread: typeSpread,
    fidelity,
    graph_linkage: graphLinkage,
  };

  const { score, coverage } = weightedMean(
    SCHEMA_COMPONENT_IDS.map((id) => ({ value: values[id], weight: SCHEMA_COMPONENTS[id].weight })),
  );

  return Object.freeze({
    code: "SCHEMA",
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    components: Object.freeze(SCHEMA_COMPONENT_IDS.map((id) => Object.freeze({
      ...SCHEMA_COMPONENTS[id],
      value: isNum(values[id]) ? Math.round(values[id] * 10) / 10 : null,
    }))),
    blocks: Object.freeze(judged),
    unmeasured: Object.freeze(SCHEMA_COMPONENT_IDS.filter((id) => !isNum(values[id]))),
  });
}

/**
 * F — fidelity between declared markup and the visible page.
 *
 * 🔴 THE ONE SCORE WHERE MORE MARKUP MEANS A LOWER NUMBER. A declared `FAQPage`
 * with no visible questions is a machine-readable claim the page contradicts.
 * Returns `null` when there is nothing to compare — declaring no FAQ on a page
 * with no FAQ is not a fidelity problem, it is simply not an FAQ page.
 */
export function scoreFidelity({ judged = [], blocks = [], visibleFaq = null, visibleSteps = null } = {}) {
  const pairs = [];

  const declaredFaq = judged.some((b) => b.type === "FAQPage");
  if (declaredFaq || isNum(visibleFaq)) {
    const seen = isNum(visibleFaq) ? visibleFaq : null;
    if (declaredFaq && seen === 0) pairs.push(0);        // declared, contradicted
    else if (declaredFaq && isNum(seen) && seen > 0) pairs.push(100);
    else if (!declaredFaq && isNum(seen) && seen > 0) pairs.push(60); // present but unmarked: a miss, not a lie
  }

  const declaredHowTo = judged.some((b) => b.type === "HowTo");
  if (declaredHowTo || isNum(visibleSteps)) {
    const seen = isNum(visibleSteps) ? visibleSteps : null;
    if (declaredHowTo && seen === 0) pairs.push(0);
    else if (declaredHowTo && isNum(seen) && seen > 0) pairs.push(100);
    else if (!declaredHowTo && isNum(seen) && seen > 0) pairs.push(60);
  }

  if (pairs.length === 0) return null;
  return clamp100(pairs.reduce((a, b) => a + b, 0) / pairs.length);
}

/**
 * G — do the blocks describe one entity, or several?
 *
 * ⚠️ THE FAILURE THIS CATCHES IS INVISIBLE PER-PAGE. Every block can be
 * individually valid while collectively naming three different organisations,
 * and the result resolves as three entities that each carry a third of the
 * authority. Nothing in P1 looks across blocks, which is why this is here.
 */
export function scoreLinkage({ blocks = [], identifying = [], canonicalDomain = null } = {}) {
  if (identifying.length === 0) return null;             // nothing to link

  const ids = blocks
    .map((b) => (b && typeof b === "object" ? b["@id"] : null))
    .filter((v) => typeof v === "string" && v.trim());
  const sameAs = blocks.flatMap((b) => {
    const v = b && typeof b === "object" ? b.sameAs : null;
    return Array.isArray(v) ? v : v ? [v] : [];
  }).filter((v) => typeof v === "string");

  let score = 40;                                        // identified, but unlinked
  if (ids.length > 0) score += 30;                       // addressable by @id
  if (sameAs.length > 0) score += 20;                    // points at itself elsewhere

  // Agreeing with the canonical domain is what makes the graph resolve to the
  // SAME company the truth record describes — the `canonical_domain` bridge W9
  // already established, spelled identically on both sides or it resolves twice.
  if (canonicalDomain) {
    const host = String(canonicalDomain).toLowerCase().replace(/^www\./, "");
    const agrees = [...ids, ...sameAs].some((v) => v.toLowerCase().includes(host));
    score += agrees ? 10 : -10;
  }
  return clamp100(score);
}

/**
 * What to fix, worst first.
 *
 * ⚠️ A CONTRADICTION OUTRANKS AN ABSENCE, whatever the weights say. "Your FAQ
 * markup describes questions that are not on the page" is a live risk to a
 * site's rich results; "you have no HowTo markup" is an opportunity. Sorting
 * these by weight alone would bury the first under the second.
 */
export function schemaGaps(result) {
  if (!result || !Array.isArray(result.components)) return Object.freeze([]);

  const rows = result.components
    .filter((c) => isNum(c.value) && c.value < 100)
    .map((c) => Object.freeze({
      component: c.id,
      abbr: c.abbr,
      label: c.label,
      value: c.value,
      weight: c.weight,
      // `fidelity` at zero is the contradiction case, and it is the only one
      // of these that can actively cost a site something it already has.
      severity: c.id === "fidelity" && c.value === 0 ? "contradiction" : "gap",
      binding: c.binding,
    }));

  return Object.freeze(rows.sort((a, b) =>
    (a.severity === b.severity ? b.weight - a.weight : a.severity === "contradiction" ? -1 : 1)));
}
