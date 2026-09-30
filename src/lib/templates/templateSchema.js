// src/lib/templates/templateSchema.js — build the server-side JSON schema for
// a template run from the template's OWN extraction_schema (plus any custom
// fields the operator typed in), instead of falling back to the loose
// CUSTOM_SCHEMA prose-shape.
//
// Why this file exists: a template declares its promised fields in
// extraction_schema.fields — and until now NOTHING read them. The server's
// resolveExtractionPlan only knew the five capability schemas, so
// customer_proof_extractor (related_key "proof" — not a capability) ran with
// structured:false and a free-text result record, and recruiter_talent_sourcing
// borrowed the leadership schema and came back with leadership-shaped data
// while its own fields (hiring_roles, tech_stack, culture_values) stayed empty.
// The schema below is what makes the model return the fields the template
// PROMISES, in a shape the run renderer can display, with per-field
// "not_found" reporting instead of one blanket "incomplete".

const LIST_BLOCK_KINDS = new Set(["list", "table"]);

/** Humanize a snake_case key for labels/headers. */
export function humanKey(k) {
  return String(k || "")
    .replace(/_+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Build { schema, groups, instruction } for a template run.
 *
 * @param {object} template  seed-template shape (extraction_schema.fields,
 *                           output_schema.blocks, prompt_bundle.extract).
 * @param {string[]} [customFields]  extra field names typed by the operator
 *                                   (comma-split custom_fields input).
 */
export function buildTemplateSchema(template, customFields = []) {
  const fields = Array.isArray(template?.extraction_schema?.fields)
    ? template.extraction_schema.fields
    : [];
  const blocks = Array.isArray(template?.output_schema?.blocks)
    ? template.output_schema.blocks
    : [];

  // Fields a table/list block renders directly must come back as ARRAYS of
  // records; single-value fields come back as strings. This is read from the
  // template's own output blocks, so a template that promises a "customer
  // proof" table gets an array of customer records, not one long string.
  const arrayFields = new Set();
  const tableColumns = new Map();
  for (const b of blocks) {
    if (!LIST_BLOCK_KINDS.has(b.kind) || !b.from) continue;
    arrayFields.add(b.from);
    if (b.kind === "table" && Array.isArray(b.columns)) tableColumns.set(b.from, b.columns);
  }

  const properties = {};
  const groups = [];
  const seenGroups = new Set();
  for (const f of fields) {
    const name = String(f.name || "").replace(/[^a-z0-9_]/gi, "_");
    if (!name) continue;
    const cols = tableColumns.get(f.name) || tableColumns.get(name);
    if (arrayFields.has(f.name) || cols) {
      const itemProps = {};
      // Table columns name the record's keys; a list without columns gets a
      // self-describing record. Every record also carries its display name.
      if (cols && cols.length) {
        for (const c of cols) {
          itemProps[String(c).replace(/[^a-z0-9_]/gi, "_")] = { type: ["string", "null"] };
        }
      }
      itemProps.name = { type: "string", description: "The short display name of this entry." };
      properties[name] = {
        type: "array",
        description: `Every ${humanKey(f.name)} the page states. Empty array when the page has none.`,
        items: { type: "object", properties: itemProps },
      };
    } else {
      properties[name] = { type: ["string", "null"] };
    }
    if (f.group && !seenGroups.has(f.group)) {
      seenGroups.add(f.group);
      groups.push({ key: f.group, label: humanKey(f.group) });
    }
  }

  // Operator-added fields live under a "custom" group so the UI can render
  // them without the server knowing the template's vocabulary in advance.
  // Accepts an array (validateInput's output) or a comma string (raw input).
  const rawCustom = typeof customFields === "string"
    ? customFields.split(",")
    : (Array.isArray(customFields) ? customFields : []);
  const cleanCustom = rawCustom
    .map((c) => String(c).trim().replace(/[^a-z0-9_]/gi, "_"))
    .filter(Boolean);
  if (cleanCustom.length) {
    const customProps = {};
    for (const name of cleanCustom) {
      customProps[name] = { type: ["string", "null"] };
    }
    properties.custom = { type: "object", properties: customProps };
    groups.push({ key: "custom", label: "Custom fields" });
  }

  properties.not_found = {
    type: "array",
    description:
      "Names of the requested fields the page genuinely does not state. The renderer lists " +
      "these per field instead of claiming the whole run failed. Omit fields that were found.",
    items: { type: "string" },
  };
  properties.evidence = {
    type: "array",
    description:
      "Verbatim supporting quotes from the page. One entry per non-null fact returned. Never paraphrase.",
    items: {
      type: "object",
      properties: {
        field: { type: "string" },
        quote: { type: "string" },
        source_url: { type: "string" },
      },
      required: ["field", "quote"],
    },
  };

  const instruction = [
    template?.prompt_bundle?.extract || "Extract the requested information from the page content.",
    "Return JSON matching the provided schema. Return null (or an empty array) for anything the page",
    "does not state — never infer, never guess. List EVERY field you could not verify in not_found.",
    "Include an evidence quote for every non-null fact.",
  ].join("\n");

  return {
    schema: { type: "object", properties, required: [] },
    groups: groups.length ? groups : null,
    instruction,
  };
}

/**
 * Assert the template contract at seed time (used by the test + server):
 * every output block's `from` references a real extraction_schema field, and
 * every extraction field lands in the generated schema. Returns [] when sound.
 */
export function templateSchemaProblems(template, customFields = []) {
  const problems = [];
  const fields = new Set(
    (template?.extraction_schema?.fields || []).map((f) => f.name),
  );
  for (const b of template?.output_schema?.blocks || []) {
    if (LIST_BLOCK_KINDS.has(b.kind) && b.from && !fields.has(b.from)) {
      problems.push(`block "${b.kind}" references missing field "${b.from}"`);
    }
  }
  const { schema } = buildTemplateSchema(template, customFields);
  for (const f of fields) {
    if (!schema.properties[f]) problems.push(`field "${f}" missing from generated schema`);
  }
  for (const c of customFields) {
    if (!schema.properties.custom?.properties?.[c]) {
      problems.push(`custom field "${c}" missing from generated schema`);
    }
  }
  return problems;
}
