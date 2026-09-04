// src/lib/bulk/icpFieldParity.test.js
//
// Asserts the ICP criteria seeded in 0041 only name fields the enricher can
// actually produce.
//
// This is the same shape of guard as cron-registry-parity.test.js: two halves
// that must agree, with nothing previously checking that they did. When
// bulkEnrich.js was rewritten to stop fabricating firmographics, its field
// vocabulary changed (`employee_count` -> inferred `employee_band`) and the
// seeded rules kept the old names. Nothing failed, because §1.6 redistributes
// an unmeasured weight — so every seeded persona silently scored on a fraction
// of its own criteria, and the only visible symptom was the Rule Simulator
// reporting "Field 'has_contact' was not found in extracted data".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENRICHABLE_FIELD_NAMES, deadCriteria } from "./icpModel.js";

const SQL = join(process.cwd(), "supabase/migrations/0041_bulk_enrichment.sql");
const ENRICHER = join(process.cwd(), "netlify/functions/lib/bulkEnrich.js");

/** Every "field": "x" named by a seeded criterion. */
function seededFields() {
  const sql = readFileSync(SQL, "utf8");
  return [...sql.matchAll(/"field"\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("ICP criteria / enricher field parity", () => {
  it("the vocabulary matches what bulkEnrich actually assigns", () => {
    const src = readFileSync(ENRICHER, "utf8");
    // Two ways the enricher sets a field: `fields.x =` directly, and the
    // `observe("x", …)` helper. Reading only the first is how company_name,
    // domain and description went missing from the vocabulary.
    const assigned = [
      ...[...src.matchAll(/fields\.([a-z_]+)\s*=/g)].map((m) => m[1]),
      ...[...src.matchAll(/observe\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]),
    ];
    // Every declared field must really be produced, or the simulator would
    // promise a signal that never arrives.
    for (const f of ENRICHABLE_FIELD_NAMES) expect(assigned).toContain(f);
  });

  it("no seeded criterion names a field the enricher cannot produce", () => {
    const unknown = [...new Set(seededFields())].filter(
      (f) => !ENRICHABLE_FIELD_NAMES.includes(f)
    );
    expect(
      unknown,
      `Seeded ICP criteria reference field(s) the enricher never produces: ` +
      `${unknown.join(", ")}. These are permanently unmeasured — their weight ` +
      `is redistributed on every account, so the rule scores on less than it ` +
      `claims. Either teach bulkEnrich.js to observe them or re-point the ` +
      `criteria at: ${ENRICHABLE_FIELD_NAMES.join(", ")}.`
    ).toEqual([]);
  });

  it("deadCriteria() flags an unproducible field and keeps its weight", () => {
    expect(deadCriteria([{ field: "annual_revenue", weight: 20 }]))
      .toEqual([{ field: "annual_revenue", weight: 20 }]);
    expect(deadCriteria([{ field: "industry", weight: 35 }])).toEqual([]);
  });
});
