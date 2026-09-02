// src/lib/templates/templateModel.js — the template engine's contract.
//
// PURE. Zero I/O: no fetch, no localStorage, no bare Date.now() (the clock is
// injected wherever it is needed). That is deliberate and it is the same rule
// entitlementModel.js and discoverability/scoringModel.js follow, for the same
// reason: this module is imported by BOTH the React app and the Netlify
// functions, so the browser and the server can never disagree about what a
// template asks for, what it costs, or whether an input is valid.
//
// ── THIS IS NOT extractionTemplates.js ──────────────────────────────────────
// src/lib/extractionTemplates.js holds 12 "recipes" — an example URL, an
// intent, and a prompt string. It answers "what should the composer type?".
// This module answers a different question: "what is this workflow, what does
// it need from the user, what will it cost, and what shape does it return?".
// Both survive. The recipes seed this engine; they are not replaced by it.
//
// ── WHY THE COST MODEL IS DETERMINISTIC AND ITEMISED ────────────────────────
// PRD 3 requires the expected credits BEFORE a run and the actual AFTER it,
// and the BRD warns against "a confusing model where every click costs
// credits". An estimate the user cannot decompose is one they cannot trust, so
// estimateCredits() returns a BREAKDOWN whose units line up 1:1 with
// credit_ledger.unit — the estimate and the charge are denominated in the same
// things, which is what makes drift between them meaningful rather than noise.

export const TEMPLATE_SCHEMA_VERSION = 1;

/** Input kinds a template may ask for. Drives the runner form. */
export const INPUT_KINDS = Object.freeze([
  "domain", "url", "domain_list", "text", "choice", "number", "boolean",
]);

/** Output blocks a template may emit. Drives the run view and the report. */
export const OUTPUT_BLOCKS = Object.freeze([
  "summary", "fields", "table", "list", "sources", "recommendations",
]);

/** Mirrors template_runs.status in 0036. Keep in sync with the CHECK. */
export const RUN_STATUS = Object.freeze({
  QUEUED: "queued", RUNNING: "running", COMPLETE: "complete",
  PARTIAL: "partial", FAILED: "failed", NEEDS_REVIEW: "needs_review",
  CANCELLED: "cancelled",
});

/** PRD 3's recommended first schema categories. Mirrors extracted_fields.field_group. */
export const FIELD_GROUPS = Object.freeze([
  "identity", "firmographics", "commercial", "gtm", "people",
  "technology", "signals", "qualification", "governance",
]);

export const TEMPLATE_STATUS = Object.freeze({
  DRAFT: "draft", PUBLISHED: "published",
  SUPERSEDED: "superseded", ARCHIVED: "archived",
});

/** Default cost weights, used when a template does not override them. */
export const DEFAULT_CREDIT_COST = Object.freeze({
  base: 1,
  per_page: 1,
  per_ai_call: 2,
  pages_per_unit: 1,
  ai_calls_per_unit: 1,
});

const MAX_LIST_UNITS = 500; // hard ceiling; per-plan caps are entitlements' job

// ── validation ──────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a template DEFINITION (the thing publish_template_version stores).
 * Returns { ok, errors } — never throws, so a bad seed row degrades to a
 * skipped template rather than a broken catalogue page.
 */
export function validateTemplate(def) {
  const errors = [];
  if (!isPlainObject(def)) return { ok: false, errors: ["template must be an object"] };

  if (!def.template_key || !/^[a-z][a-z0-9_]{2,48}$/.test(String(def.template_key))) {
    errors.push("template_key must be lower_snake_case, 3-49 chars");
  }
  if (!def.title || !String(def.title).trim()) errors.push("title is required");

  const inputs = def.input_schema?.fields;
  if (inputs !== undefined) {
    if (!Array.isArray(inputs)) {
      errors.push("input_schema.fields must be an array");
    } else {
      const seen = new Set();
      inputs.forEach((f, i) => {
        if (!isPlainObject(f)) { errors.push(`input_schema.fields[${i}] must be an object`); return; }
        if (!f.name) errors.push(`input_schema.fields[${i}].name is required`);
        else if (seen.has(f.name)) errors.push(`duplicate input field '${f.name}'`);
        else seen.add(f.name);
        if (!INPUT_KINDS.includes(f.kind)) {
          errors.push(`input_schema.fields[${i}].kind '${f.kind}' is not one of ${INPUT_KINDS.join("|")}`);
        }
        if (f.kind === "choice" && !Array.isArray(f.options)) {
          errors.push(`input field '${f.name}' is a choice but has no options[]`);
        }
      });
    }
  }

  const blocks = def.output_schema?.blocks;
  if (blocks !== undefined) {
    if (!Array.isArray(blocks)) errors.push("output_schema.blocks must be an array");
    else blocks.forEach((b, i) => {
      const kind = isPlainObject(b) ? b.kind : b;
      if (!OUTPUT_BLOCKS.includes(kind)) {
        errors.push(`output_schema.blocks[${i}] '${kind}' is not one of ${OUTPUT_BLOCKS.join("|")}`);
      }
    });
  }

  const groups = def.extraction_schema?.fields;
  if (Array.isArray(groups)) {
    groups.forEach((f, i) => {
      if (f?.group && !FIELD_GROUPS.includes(f.group)) {
        errors.push(`extraction_schema.fields[${i}].group '${f.group}' is not a known field group`);
      }
    });
  }

  const cost = def.credit_cost;
  if (cost !== undefined) {
    if (!isPlainObject(cost)) errors.push("credit_cost must be an object");
    else for (const [k, v] of Object.entries(cost)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        errors.push(`credit_cost.${k} must be a non-negative number`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Pick the right row out of a list of versions.
 * With no explicit version: the PUBLISHED one — never merely the highest, so a
 * draft v3 can exist without silently becoming what everyone runs.
 */
export function resolveTemplateVersion(rows, key, version = null) {
  if (!Array.isArray(rows)) return null;
  const forKey = rows.filter((r) => r?.template_key === key);
  if (forKey.length === 0) return null;
  if (version != null) {
    return forKey.find((r) => Number(r.version) === Number(version)) || null;
  }
  return forKey.find((r) => r.status === TEMPLATE_STATUS.PUBLISHED) || null;
}

// ── input handling ──────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#].*)?$/i;

/**
 * Normalise a domain the way the whole product must agree on: lowercase, no
 * scheme, no `www.`, no path. This is the `entity_key` in extracted_fields and
 * therefore the join key PRD 3 dedupes on and PRD 4 diffs across.
 */
export function normalizeDomain(raw) {
  if (typeof raw !== "string") return null;
  const m = String(raw).trim().match(DOMAIN_RE);
  if (!m) return null;
  return m[1].toLowerCase();
}

/** Split a pasted/uploaded list into unique, normalised domains. */
export function parseDomainList(raw) {
  const tokens = String(raw ?? "").split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set();
  const domains = [];
  const rejected = [];
  for (const t of tokens) {
    const d = normalizeDomain(t);
    if (!d) { rejected.push(t); continue; }
    if (seen.has(d)) continue;      // dedup is part of the contract, not a UI nicety
    seen.add(d);
    domains.push(d);
  }
  return { domains, rejected, duplicates: tokens.length - domains.length - rejected.length };
}

/**
 * Validate + coerce a run's input against the template's input_schema.
 * Returns { ok, errors, value } with `value` normalised for the runner.
 */
export function validateInput(template, input) {
  const fields = template?.input_schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return { ok: true, errors: [], value: {} };

  const errors = [];
  const value = {};
  const src = isPlainObject(input) ? input : {};

  for (const f of fields) {
    const raw = src[f.name];
    const missing = raw === undefined || raw === null || raw === "";

    if (missing) {
      if (f.required) errors.push(`${f.label || f.name} is required`);
      else if (f.default !== undefined) value[f.name] = f.default;
      continue;
    }

    switch (f.kind) {
      case "domain": {
        const d = normalizeDomain(raw);
        if (!d) errors.push(`${f.label || f.name} must be a valid domain`);
        else value[f.name] = d;
        break;
      }
      case "url": {
        const str = String(raw).trim();
        // Deliberately permissive on scheme, strict on shape. The SSRF guard
        // in extract.js is the real gate — duplicating it here would create
        // two policies that can drift.
        if (!/^https?:\/\/\S+\.\S+/i.test(str)) errors.push(`${f.label || f.name} must be an http(s) URL`);
        else value[f.name] = str;
        break;
      }
      case "domain_list": {
        const { domains, rejected } = parseDomainList(raw);
        if (domains.length === 0) errors.push(`${f.label || f.name} contains no valid domains`);
        else if (domains.length > (f.max ?? MAX_LIST_UNITS)) {
          errors.push(`${f.label || f.name} has ${domains.length} domains; the maximum is ${f.max ?? MAX_LIST_UNITS}`);
        } else {
          value[f.name] = domains;
          if (rejected.length) value[`${f.name}__rejected`] = rejected;
        }
        break;
      }
      case "choice": {
        const opts = (f.options || []).map((o) => (isPlainObject(o) ? o.value : o));
        if (!opts.includes(raw)) errors.push(`${f.label || f.name} must be one of ${opts.join(", ")}`);
        else value[f.name] = raw;
        break;
      }
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors.push(`${f.label || f.name} must be a number`);
        else if (f.min != null && n < f.min) errors.push(`${f.label || f.name} must be at least ${f.min}`);
        else if (f.max != null && n > f.max) errors.push(`${f.label || f.name} must be at most ${f.max}`);
        else value[f.name] = n;
        break;
      }
      case "boolean":
        value[f.name] = raw === true || raw === "true";
        break;
      default:
        value[f.name] = String(raw).trim();
    }
  }

  return { ok: errors.length === 0, errors, value };
}

// ── cost ────────────────────────────────────────────────────────────────────

/**
 * How many entities this run covers. A domain_list run over 40 domains is 40
 * units; a single-domain run is 1. Units are what every per-unit cost scales by.
 */
export function countUnits(template, input) {
  const fields = template?.input_schema?.fields;
  if (!Array.isArray(fields)) return 1;
  const listField = fields.find((f) => f.kind === "domain_list");
  if (!listField) return 1;
  const v = input?.[listField.name];
  if (Array.isArray(v)) return Math.max(1, v.length);
  const { domains } = parseDomainList(v ?? "");
  return Math.max(1, domains.length);
}

/**
 * Deterministic, itemised credit estimate.
 * Units line up with credit_ledger.unit so estimate and actual are comparable.
 */
export function estimateCredits(template, input = {}) {
  const cost = { ...DEFAULT_CREDIT_COST, ...(template?.credit_cost || {}) };
  const units = countUnits(template, input);
  const pages = Math.round(units * (cost.pages_per_unit ?? 1));
  const aiCalls = Math.round(units * (cost.ai_calls_per_unit ?? 1));

  const breakdown = [];
  if (cost.base > 0) breakdown.push({ unit: "run", quantity: 1, credits: cost.base, label: "Workflow setup" });
  if (pages > 0 && cost.per_page > 0) {
    breakdown.push({ unit: "page", quantity: pages, credits: pages * cost.per_page, label: "Pages fetched" });
  }
  if (aiCalls > 0 && cost.per_ai_call > 0) {
    breakdown.push({ unit: "ai_call", quantity: aiCalls, credits: aiCalls * cost.per_ai_call, label: "AI analysis" });
  }

  return {
    units,
    credits: breakdown.reduce((sum, b) => sum + b.credits, 0),
    breakdown,
  };
}

/** The entitlement capability a template runs under. */
export function capabilityFor(template) {
  return template?.plan_entitlement || "template.run";
}

/** Is this run status terminal? Used by the runner and the progress dock. */
export function isTerminalStatus(status) {
  return [RUN_STATUS.COMPLETE, RUN_STATUS.FAILED,
          RUN_STATUS.CANCELLED, RUN_STATUS.PARTIAL].includes(status);
}
