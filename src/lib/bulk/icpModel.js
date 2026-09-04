// src/lib/bulk/icpModel.js — Pure ICP evaluation engine.
//
// ── §1.6 COVERAGE RULE ────────────────────────────────────────────────────────
// Unmeasured signals are excluded from the denominator and their weight is
// redistributed, NEVER scored as 0. A score computed from 2 of 5 fields is not
// the same claim as one computed from all 5, so `coverage` travels with every
// evaluation and a zero-coverage evaluation returns score: null (not 0).
//
// ── CUSTOMER EDITABLE ────────────────────────────────────────────────────────
// Rules are data, not code. Persona seeds provide initial baselines, but every
// rule set can be edited, re-weighted, and reset.

export const DEFAULT_THRESHOLD = 50.0;

// ── THE ENRICHER'S FIELD VOCABULARY ──────────────────────────────────────────
// The complete set of fields `netlify/functions/lib/bulkEnrich.js` can produce.
// It lives here, in the pure model both the client and the server import, for
// the same reason `entitlementModel.js` does: a criterion naming a field the
// enricher cannot produce is not a strict rule, it is a DEAD one — permanently
// unmeasured, its weight silently redistributed to whatever is left (§1.6).
//
// That is exactly what happened. The enricher used to fabricate firmographics
// (a hardcoded `employee_count: 55` for every company on earth); rewriting it
// to be honest replaced that with an inferred `employee_band`, and the seeded
// persona rules in 0041 were never migrated off the invented vocabulary. The
// coverage rule then hid it: nothing errored, scores just quietly rested on
// fewer criteria than the rule claimed.
//
// `sample` is what the ICP Rule Simulator evaluates against. Deriving it from
// this one list is the point — a hand-written sample in the page is how the
// simulator came to report a field the enricher never had.
export const ENRICHABLE_FIELDS = Object.freeze({
  company_name:     { sample: "Stripe",                        note: "observed" },
  domain:           { sample: "stripe.com",                    note: "observed" },
  description:      { sample: "Financial infrastructure for the internet", note: "observed, meta" },
  has_pricing:      { sample: true,                            note: "observed" },
  has_careers:      { sample: true,                            note: "observed" },
  has_contact:      { sample: true,                            note: "observed" },
  has_product_tour: { sample: true,                            note: "observed" },
  industry:         { sample: "Software",                      note: "inferred, enum" },
  employee_band:    { sample: "51-200",                        note: "inferred, enum band — NOT a count" },
  employee_count:   { sample: 120,                             note: "observed only — absent unless the page states a headcount" },
  target_customer:  { sample: "B2B revenue teams",             note: "inferred" },
  hq_country:       { sample: "US",                            note: "inferred, ISO-3166 alpha-2" },
});

/** Field names the enricher can actually produce. */
export const ENRICHABLE_FIELD_NAMES = Object.freeze(Object.keys(ENRICHABLE_FIELDS));

/** A representative profile for the simulator, built from the real vocabulary. */
export function sampleProfile(overrides = {}) {
  const out = {};
  for (const [k, v] of Object.entries(ENRICHABLE_FIELDS)) out[k] = v.sample;
  return { ...out, ...overrides };
}

/**
 * Criteria naming a field the enricher cannot produce. These can never be
 * measured, so they are dead weight in every evaluation. Returns [] when clean.
 */
export function deadCriteria(criteria = []) {
  if (!Array.isArray(criteria)) return [];
  return criteria
    .filter((c) => c && !ENRICHABLE_FIELD_NAMES.includes(c.field))
    .map((c) => ({ field: c.field, weight: c.weight ?? 10 }));
}

function isEmpty(val) {
  if (val == null) return true;
  if (typeof val === "string") return val.trim().length === 0;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === "object") return Object.keys(val).length === 0;
  return false;
}

function parseNumber(val) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    // Strip commas, currency symbols, pluses (e.g. "$50k", "50+", "1,000")
    const cleaned = val.replace(/[$€£+,]/g, "").trim().toLowerCase();
    if (cleaned.endsWith("k")) return parseFloat(cleaned) * 1000;
    if (cleaned.endsWith("m")) return parseFloat(cleaned) * 1000000;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Evaluates an account's extracted fields against an array of ICP criteria.
 *
 * @param {Record<string, any>} fields - Extracted company/account attributes
 * @param {Array<{ field: string, operator: string, value?: any, weight: number, required?: boolean }>} criteria - Scoring rules
 * @param {number} [threshold=50] - Qualification cutoff score (0..100)
 */
export function evaluateIcp(fields = {}, criteria = [], threshold = DEFAULT_THRESHOLD) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return {
      score: null,
      rawScore: 0,
      measuredWeight: 0,
      totalWeight: 0,
      coverage: 0,
      passed: false,
      disqualified: false,
      reasons: [],
      unmeasuredFields: [],
    };
  }

  const reasons = [];
  const unmeasuredFields = [];
  let totalWeight = 0;
  let measuredWeight = 0;
  let rawEarned = 0;
  let requiredDisqualified = false;

  for (const rule of criteria) {
    const { field, operator, value, weight = 10, required = false } = rule;
    totalWeight += weight;

    const actual = fields ? fields[field] : undefined;

    // Check if the signal is measurable
    const hasValue = actual !== undefined && actual !== null && actual !== "";
    const isExistenceOp = operator === "exists" || operator === "not_empty" || operator === "empty";

    if (!hasValue && !isExistenceOp) {
      unmeasuredFields.push(field);
      reasons.push({
        field,
        passed: false,
        measured: false,
        reason: `Field '${field}' was not found in extracted data.`,
        weight,
        required,
      });
      continue;
    }

    // Signal is measurable
    measuredWeight += weight;
    let rulePassed = false;
    let explanation = "";

    switch (operator) {
      case "equals": {
        if (typeof value === "boolean") {
          rulePassed = Boolean(actual) === value;
        } else {
          rulePassed = String(actual).trim().toLowerCase() === String(value).trim().toLowerCase();
        }
        explanation = rulePassed
          ? `${field} equals '${value}'`
          : `${field} is '${actual}', expected '${value}'`;
        break;
      }

      case "not_equals": {
        rulePassed = String(actual).trim().toLowerCase() !== String(value).trim().toLowerCase();
        explanation = rulePassed
          ? `${field} is not '${value}'`
          : `${field} equals '${value}'`;
        break;
      }

      case "in": {
        const allowed = Array.isArray(value) ? value.map((v) => String(v).trim().toLowerCase()) : [];
        const actualStr = String(actual).trim().toLowerCase();
        rulePassed = allowed.includes(actualStr);
        explanation = rulePassed
          ? `${field} ('${actual}') is in allowed target set`
          : `${field} ('${actual}') is not in allowed target set`;
        break;
      }

      case "not_in": {
        const disallowed = Array.isArray(value) ? value.map((v) => String(v).trim().toLowerCase()) : [];
        const actualStr = String(actual).trim().toLowerCase();
        rulePassed = !disallowed.includes(actualStr);
        explanation = rulePassed
          ? `${field} ('${actual}') is outside excluded set`
          : `${field} ('${actual}') is in excluded set`;
        break;
      }

      case "contains": {
        const actualStr = String(actual).toLowerCase();
        const expectedStr = String(value).toLowerCase();
        rulePassed = actualStr.includes(expectedStr);
        explanation = rulePassed
          ? `${field} contains '${value}'`
          : `${field} does not contain '${value}'`;
        break;
      }

      case "not_contains": {
        const actualStr = String(actual).toLowerCase();
        const expectedStr = String(value).toLowerCase();
        rulePassed = !actualStr.includes(expectedStr);
        explanation = rulePassed
          ? `${field} does not contain '${value}'`
          : `${field} contains '${value}'`;
        break;
      }

      case "gte": {
        const num = parseNumber(actual);
        const target = parseNumber(value);
        rulePassed = num != null && target != null && num >= target;
        explanation = rulePassed
          ? `${field} (${num}) >= ${target}`
          : `${field} (${num ?? actual}) is less than ${target}`;
        break;
      }

      case "gt": {
        const num = parseNumber(actual);
        const target = parseNumber(value);
        rulePassed = num != null && target != null && num > target;
        explanation = rulePassed
          ? `${field} (${num}) > ${target}`
          : `${field} (${num ?? actual}) is not greater than ${target}`;
        break;
      }

      case "lte": {
        const num = parseNumber(actual);
        const target = parseNumber(value);
        rulePassed = num != null && target != null && num <= target;
        explanation = rulePassed
          ? `${field} (${num}) <= ${target}`
          : `${field} (${num ?? actual}) is greater than ${target}`;
        break;
      }

      case "lt": {
        const num = parseNumber(actual);
        const target = parseNumber(value);
        rulePassed = num != null && target != null && num < target;
        explanation = rulePassed
          ? `${field} (${num}) < ${target}`
          : `${field} (${num ?? actual}) is not less than ${target}`;
        break;
      }

      case "exists":
      case "not_empty": {
        rulePassed = !isEmpty(actual);
        explanation = rulePassed ? `${field} is present` : `${field} is empty or missing`;
        break;
      }

      case "empty": {
        rulePassed = isEmpty(actual);
        explanation = rulePassed ? `${field} is empty` : `${field} is present`;
        break;
      }

      default:
        rulePassed = false;
        explanation = `Unknown operator '${operator}'`;
    }

    if (rulePassed) {
      rawEarned += weight;
    } else if (required) {
      requiredDisqualified = true;
    }

    reasons.push({
      field,
      passed: rulePassed,
      measured: true,
      reason: explanation,
      weight,
      required,
    });
  }

  // §1.6 Coverage calculation
  const coverage = totalWeight > 0 ? Number((measuredWeight / totalWeight).toFixed(3)) : 0;

  // Normalized score out of 100 based on MEASURED weight
  let score = null;
  if (measuredWeight > 0) {
    score = Number(((rawEarned / measuredWeight) * 100).toFixed(2));
  }

  const passed = !requiredDisqualified && score != null && score >= threshold;

  return {
    score,
    rawScore: rawEarned,
    measuredWeight,
    totalWeight,
    coverage,
    passed,
    disqualified: requiredDisqualified,
    reasons,
    unmeasuredFields,
  };
}
