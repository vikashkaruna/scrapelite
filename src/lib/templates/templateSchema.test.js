// src/lib/templates/templateSchema.test.js — the contract that every seed
// template's PROMISED fields actually reach the extraction. Before
// buildTemplateSchema, a template's extraction_schema.fields were declared
// on the gallery card and then ignored by the runner: customer_proof_extractor
// fell back to the loose custom shape (insufficient outcomes) and
// recruiter_talent_sourcing borrowed the leadership schema (its own fields
// came back empty → "run is incomplete").
import { describe, it, expect } from "vitest";
import { SEED_TEMPLATES } from "./seedTemplates.js";
import { buildTemplateSchema, templateSchemaProblems, humanKey } from "./templateSchema.js";

describe("buildTemplateSchema", () => {
  it("maps every declared extraction field into the schema", () => {
    for (const t of SEED_TEMPLATES) {
      if (t.status !== "PUBLISHED" || !t.extraction_schema?.fields?.length) continue;
      const { schema } = buildTemplateSchema(t, []);
      for (const f of t.extraction_schema.fields) {
        expect(schema.properties[f.name], `${t.template_key}.${f.name}`).toBeTruthy();
      }
    }
  });

  it("makes table/list `from` fields arrays of records with the table's columns", () => {
    const t = SEED_TEMPLATES.find((x) => x.template_key === "customer_proof_extractor");
    const { schema } = buildTemplateSchema(t, []);
    expect(schema.properties.case_studies.type).toBe("array");
    const cols = Object.keys(schema.properties.case_studies.items.properties);
    // The table declares columns customer/industry/outcome/source + name.
    expect(cols).toEqual(expect.arrayContaining(["customer", "industry", "outcome", "source", "name"]));
  });

  it("puts operator-added custom fields under a custom group", () => {
    const t = SEED_TEMPLATES.find((x) => x.template_key === "customer_proof_extractor");
    const { schema, groups } = buildTemplateSchema(t, ["security_certifications", "funding_stage"]);
    expect(schema.properties.custom.properties.security_certifications).toBeTruthy();
    expect(schema.properties.custom.properties.funding_stage).toBeTruthy();
    expect(groups.map((g) => g.key)).toContain("custom");
  });

  it("always includes not_found + evidence contracts", () => {
    const { schema } = buildTemplateSchema(SEED_TEMPLATES[0], []);
    expect(schema.properties.not_found.type).toBe("array");
    expect(schema.properties.evidence.type).toBe("array");
  });

  it("every seed template passes the contract (blocks reference real fields)", () => {
    const failures = [];
    for (const t of SEED_TEMPLATES) {
      if (t.status !== "PUBLISHED") continue;
      const problems = templateSchemaProblems(t, []);
      if (problems.length) failures.push(`${t.template_key}: ${problems.join("; ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("humanKey turns snake_case into a label", () => {
    expect(humanKey("named_customers")).toBe("Named Customers");
    expect(humanKey("tech_stack")).toBe("Tech Stack");
  });
});
