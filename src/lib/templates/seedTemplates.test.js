import { describe, it, expect } from "vitest";
import { SEED_TEMPLATES, PUBLISHED_SEEDS, seedByKey } from "./seedTemplates.js";
import { validateTemplate, estimateCredits, validateInput, capabilityFor } from "./templateModel.js";
import { PERSONAS } from "../personaConfig.js";

describe("seed templates", () => {
  it("ships seven — six launch templates plus the positioning brief", () => {
    expect(SEED_TEMPLATES).toHaveLength(7);
  });

  it("every seed is a valid template definition", () => {
    for (const t of SEED_TEMPLATES) {
      const r = validateTemplate(t);
      expect(r.errors, `${t.template_key}: ${r.errors.join("; ")}`).toEqual([]);
    }
  });

  it("template keys are unique", () => {
    const keys = SEED_TEMPLATES.map((t) => t.template_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every persona referenced is a real persona", () => {
    const ids = new Set(PERSONAS.map((p) => p.id));
    for (const t of SEED_TEMPLATES) {
      expect(ids.has(t.persona), `${t.template_key} -> ${t.persona}`).toBe(true);
    }
  });

  it("only bulk_icp_enrichment waits for Phase 4's durable runner", () => {
    expect(PUBLISHED_SEEDS).toHaveLength(6);
    expect(seedByKey("bulk_icp_enrichment").status).toBe("draft");
  });

  it("every published seed produces a non-zero, itemised estimate — except the audit", () => {
    for (const t of PUBLISHED_SEEDS) {
      const e = estimateCredits(t, {});
      if (t.template_key === "discoverability_audit") {
        // Audits debit their own monthly budget; charging credits too would
        // bill the same work twice.
        expect(e.credits).toBe(0);
        expect(capabilityFor(t)).toBe("audit");
      } else {
        expect(e.credits, t.template_key).toBeGreaterThan(0);
        expect(e.breakdown.length, t.template_key).toBeGreaterThan(0);
      }
    }
  });

  it("every published seed has at least one required input, so the form cannot be submitted empty", () => {
    for (const t of PUBLISHED_SEEDS) {
      const required = t.input_schema.fields.filter((f) => f.required);
      expect(required.length, t.template_key).toBeGreaterThan(0);
      expect(validateInput(t, {}).ok, t.template_key).toBe(false);
    }
  });

  it("every published seed accepts a realistic input", () => {
    const sample = { domain: "stripe.com", url: "https://stripe.com/pricing" };
    for (const t of PUBLISHED_SEEDS) {
      const r = validateInput(t, sample);
      expect(r.ok, `${t.template_key}: ${r.errors.join("; ")}`).toBe(true);
    }
  });

  it("every output block names a title, so no report renders an unlabelled slab", () => {
    for (const t of SEED_TEMPLATES) {
      for (const b of t.output_schema.blocks) {
        expect(b.title, `${t.template_key}/${b.kind}`).toBeTruthy();
      }
    }
  });

  it("every extraction prompt forbids invention", () => {
    // The BRD is emphatic: a generated block with a hallucinated fact is worse
    // than no block, because it gets published without being read.
    for (const t of PUBLISHED_SEEDS) {
      const extract = t.prompt_bundle.extract;
      if (!extract) continue; // the audit delegates instead of prompting
      expect(extract.toLowerCase(), t.template_key).toMatch(/null|never (guess|invent)|do not (infer|invent)/);
    }
  });

  it("every published seed carries an entitlement capability", () => {
    for (const t of PUBLISHED_SEEDS) {
      expect(["template.run", "audit", "extract.batch"]).toContain(capabilityFor(t));
    }
  });
});
