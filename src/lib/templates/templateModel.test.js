import { describe, it, expect } from "vitest";
import {
  validateTemplate, resolveTemplateVersion, validateInput, estimateCredits,
  countUnits, normalizeDomain, parseDomainList, capabilityFor, isTerminalStatus,
  INPUT_KINDS, OUTPUT_BLOCKS, FIELD_GROUPS, RUN_STATUS, TEMPLATE_STATUS,
} from "./templateModel.js";

const tpl = (over = {}) => ({
  template_key: "account_brief",
  title: "Account Brief",
  input_schema: { fields: [{ name: "domain", kind: "domain", required: true, label: "Company domain" }] },
  output_schema: { blocks: ["summary", "fields", "sources"] },
  credit_cost: { base: 1, per_page: 1, per_ai_call: 2, pages_per_unit: 3, ai_calls_per_unit: 1 },
  ...over,
});

describe("validateTemplate", () => {
  it("accepts a well-formed template", () => {
    expect(validateTemplate(tpl())).toEqual({ ok: true, errors: [] });
  });

  it("rejects a non-object outright rather than throwing", () => {
    expect(validateTemplate(null).ok).toBe(false);
    expect(validateTemplate("nope").ok).toBe(false);
  });

  it("requires a lower_snake_case key", () => {
    expect(validateTemplate(tpl({ template_key: "Account-Brief" })).ok).toBe(false);
    expect(validateTemplate(tpl({ template_key: "ab" })).ok).toBe(false);
    expect(validateTemplate(tpl({ template_key: "a_valid_key9" })).ok).toBe(true);
  });

  it("requires a title", () => {
    const r = validateTemplate(tpl({ title: "   " }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/title is required/);
  });

  it("rejects an unknown input kind", () => {
    const r = validateTemplate(tpl({ input_schema: { fields: [{ name: "x", kind: "telepathy" }] } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/telepathy/);
  });

  it("rejects duplicate input field names — they would silently overwrite", () => {
    const r = validateTemplate(tpl({ input_schema: { fields: [
      { name: "domain", kind: "domain" }, { name: "domain", kind: "text" },
    ] } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/duplicate input field/);
  });

  it("requires options[] on a choice field", () => {
    const r = validateTemplate(tpl({ input_schema: { fields: [{ name: "depth", kind: "choice" }] } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/no options/);
  });

  it("rejects an unknown output block", () => {
    expect(validateTemplate(tpl({ output_schema: { blocks: ["hologram"] } })).ok).toBe(false);
  });

  it("rejects an extraction field group that is not one of PRD 3's categories", () => {
    const r = validateTemplate(tpl({ extraction_schema: { fields: [{ name: "x", group: "vibes" }] } }));
    expect(r.ok).toBe(false);
    expect(validateTemplate(tpl({ extraction_schema: { fields: [{ name: "x", group: "firmographics" }] } })).ok).toBe(true);
  });

  it("rejects a negative or non-numeric credit cost", () => {
    expect(validateTemplate(tpl({ credit_cost: { base: -1 } })).ok).toBe(false);
    expect(validateTemplate(tpl({ credit_cost: { base: "free" } })).ok).toBe(false);
  });

  it("exposes the enums the schema CHECK constraints mirror", () => {
    expect(INPUT_KINDS).toContain("domain_list");
    expect(OUTPUT_BLOCKS).toContain("sources");
    expect(FIELD_GROUPS).toContain("qualification");
    expect(RUN_STATUS.NEEDS_REVIEW).toBe("needs_review");
  });
});

describe("resolveTemplateVersion", () => {
  const rows = [
    { template_key: "a", version: 1, status: TEMPLATE_STATUS.SUPERSEDED },
    { template_key: "a", version: 2, status: TEMPLATE_STATUS.PUBLISHED },
    { template_key: "a", version: 3, status: TEMPLATE_STATUS.DRAFT },
    { template_key: "b", version: 1, status: TEMPLATE_STATUS.PUBLISHED },
  ];

  it("returns the PUBLISHED version, not merely the highest", () => {
    // A draft v3 must never become what everyone runs just by existing.
    expect(resolveTemplateVersion(rows, "a").version).toBe(2);
  });

  it("returns an explicitly requested version even when superseded — old runs stay reproducible", () => {
    expect(resolveTemplateVersion(rows, "a", 1).version).toBe(1);
  });

  it("returns null for an unknown key or version", () => {
    expect(resolveTemplateVersion(rows, "zz")).toBeNull();
    expect(resolveTemplateVersion(rows, "a", 99)).toBeNull();
    expect(resolveTemplateVersion(null, "a")).toBeNull();
  });

  it("returns null when a key exists but has no published version", () => {
    expect(resolveTemplateVersion([{ template_key: "c", version: 1, status: "draft" }], "c")).toBeNull();
  });
});

describe("normalizeDomain / parseDomainList", () => {
  it("strips scheme, www and path so one company is one entity_key", () => {
    for (const raw of ["https://www.Stripe.com/pricing", "stripe.com", "HTTP://stripe.com", "www.stripe.com"]) {
      expect(normalizeDomain(raw)).toBe("stripe.com");
    }
  });

  it("keeps subdomains distinct — they are genuinely different sites", () => {
    expect(normalizeDomain("docs.stripe.com")).toBe("docs.stripe.com");
  });

  it("rejects things that are not domains", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain(42)).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });

  it("dedupes across spelling variants, because dedup is part of the contract", () => {
    const r = parseDomainList("stripe.com, https://www.stripe.com\nSTRIPE.COM");
    expect(r.domains).toEqual(["stripe.com"]);
    expect(r.duplicates).toBe(2);
  });

  it("separates rejected tokens instead of silently dropping them", () => {
    const r = parseDomainList("stripe.com, garbage, acme.io");
    expect(r.domains).toEqual(["stripe.com", "acme.io"]);
    expect(r.rejected).toEqual(["garbage"]);
  });

  it("handles commas, semicolons, newlines and stray whitespace", () => {
    expect(parseDomainList("a.com;b.com,  c.com\n\nd.com").domains).toEqual(
      ["a.com", "b.com", "c.com", "d.com"]);
  });

  it("returns empty structures for empty input rather than throwing", () => {
    expect(parseDomainList("").domains).toEqual([]);
    expect(parseDomainList(null).domains).toEqual([]);
  });
});

describe("validateInput", () => {
  it("passes a valid domain through normalised", () => {
    const r = validateInput(tpl(), { domain: "https://WWW.Acme.com/about" });
    expect(r.ok).toBe(true);
    expect(r.value.domain).toBe("acme.com");
  });

  it("reports a missing required field by its human label", () => {
    const r = validateInput(tpl(), {});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Company domain is required/);
  });

  it("applies a default for an omitted optional field", () => {
    const t = tpl({ input_schema: { fields: [{ name: "depth", kind: "number", default: 3 }] } });
    expect(validateInput(t, {}).value.depth).toBe(3);
  });

  it("enforces number bounds", () => {
    const t = tpl({ input_schema: { fields: [{ name: "n", kind: "number", min: 1, max: 5 }] } });
    expect(validateInput(t, { n: 9 }).ok).toBe(false);
    expect(validateInput(t, { n: 0 }).ok).toBe(false);
    expect(validateInput(t, { n: 3 }).value.n).toBe(3);
  });

  it("enforces choice options", () => {
    const t = tpl({ input_schema: { fields: [{ name: "mode", kind: "choice", options: ["fast", "deep"] }] } });
    expect(validateInput(t, { mode: "sideways" }).ok).toBe(false);
    expect(validateInput(t, { mode: "deep" }).value.mode).toBe("deep");
  });

  it("caps a domain_list at the template's max and says by how much", () => {
    const t = tpl({ input_schema: { fields: [{ name: "domains", kind: "domain_list", max: 2, label: "Accounts" }] } });
    const r = validateInput(t, { domains: "a.com b.com c.com" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/3 domains; the maximum is 2/);
  });

  it("surfaces rejected list entries so the user can fix them", () => {
    const t = tpl({ input_schema: { fields: [{ name: "domains", kind: "domain_list" }] } });
    const r = validateInput(t, { domains: "a.com, ???, b.com" });
    expect(r.value.domains).toEqual(["a.com", "b.com"]);
    expect(r.value.domains__rejected).toEqual(["???"]);
  });

  it("rejects a list with no valid domains at all", () => {
    const t = tpl({ input_schema: { fields: [{ name: "domains", kind: "domain_list" }] } });
    expect(validateInput(t, { domains: "nonsense" }).ok).toBe(false);
  });

  it("treats a template with no input schema as always valid", () => {
    expect(validateInput({ title: "x" }, {}).ok).toBe(true);
  });

  it("coerces booleans from checkbox strings", () => {
    const t = tpl({ input_schema: { fields: [{ name: "deep", kind: "boolean" }] } });
    expect(validateInput(t, { deep: "true" }).value.deep).toBe(true);
    expect(validateInput(t, { deep: false }).value.deep).toBe(false);
  });

  describe("the shared Customize panel inputs (regression: they used to be dropped)", () => {
    it("keeps custom_fields as a cleaned array", () => {
      const r = validateInput(tpl(), { domain: "x.com", custom_fields: "Products, Services,  pricing , credentials" });
      expect(r.value.custom_fields).toEqual(["Products", "Services", "pricing", "credentials"]);
    });

    it("keeps custom_prompt trimmed and capped", () => {
      const r = validateInput(tpl(), { domain: "x.com", custom_prompt: "  Focus on enterprise compliance.  " });
      expect(r.value.custom_prompt).toBe("Focus on enterprise compliance.");
    });

    it("keeps a valid ai_depth and rejects unknown ones", () => {
      expect(validateInput(tpl(), { domain: "x.com", ai_depth: "deep" }).value.ai_depth).toBe("deep");
      expect(validateInput(tpl(), { domain: "x.com", ai_depth: "quick" }).value.ai_depth).toBe("quick");
      expect(validateInput(tpl(), { domain: "x.com", ai_depth: "sideways" }).value.ai_depth).toBeUndefined();
    });

    it("keeps extra_subpages capped at 4", () => {
      expect(validateInput(tpl(), { domain: "x.com", extra_subpages: 2 }).value.extra_subpages).toBe(2);
      expect(validateInput(tpl(), { domain: "x.com", extra_subpages: 9 }).value.extra_subpages).toBe(4);
    });

    it("drops blank customization values", () => {
      const r = validateInput(tpl(), { domain: "x.com", custom_fields: " , ", custom_prompt: "  " });
      expect(r.value.custom_fields).toBeUndefined();
      expect(r.value.custom_prompt).toBeUndefined();
    });
  });
});

describe("countUnits / estimateCredits", () => {
  it("a single-domain run is one unit", () => {
    expect(countUnits(tpl(), { domain: "acme.com" })).toBe(1);
  });

  it("a list run scales with the number of domains", () => {
    const t = tpl({ input_schema: { fields: [{ name: "domains", kind: "domain_list" }] } });
    expect(countUnits(t, { domains: ["a.com", "b.com", "c.com"] })).toBe(3);
    expect(countUnits(t, { domains: "a.com b.com" })).toBe(2);
  });

  it("itemises the estimate in the same units the ledger charges in", () => {
    const e = estimateCredits(tpl(), { domain: "acme.com" });
    // base 1 + (1 unit x 3 pages x 1) + (1 unit x 1 ai x 2) = 6
    expect(e.credits).toBe(6);
    expect(e.units).toBe(1);
    expect(e.breakdown.map((b) => b.unit)).toEqual(["run", "page", "ai_call"]);
    expect(e.breakdown.find((b) => b.unit === "page")).toMatchObject({ quantity: 3, credits: 3 });
  });

  it("scales linearly with units, so a 10-domain list costs what a user can predict", () => {
    const t = tpl({ input_schema: { fields: [{ name: "domains", kind: "domain_list" }] } });
    const one = estimateCredits(t, { domains: ["a.com"] });
    const ten = estimateCredits(t, { domains: Array.from({ length: 10 }, (_, i) => `d${i}.com`) });
    expect(ten.credits).toBe(one.credits + 9 * (3 * 1 + 1 * 2));
  });

  it("falls back to defaults when a template declares no cost", () => {
    const e = estimateCredits({ title: "x" }, {});
    expect(e.credits).toBeGreaterThan(0);
  });

  it("omits zero-cost lines rather than showing '0 x AI analysis'", () => {
    const e = estimateCredits(tpl({ credit_cost: { base: 0, per_page: 1, per_ai_call: 0, pages_per_unit: 2 } }), {});
    expect(e.breakdown.map((b) => b.unit)).toEqual(["page"]);
  });
});

describe("capabilityFor / isTerminalStatus", () => {
  it("defaults to template.run when a template names no capability", () => {
    expect(capabilityFor({})).toBe("template.run");
    expect(capabilityFor({ plan_entitlement: "extract.batch" })).toBe("extract.batch");
  });

  it("knows which statuses are terminal", () => {
    expect(isTerminalStatus("complete")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    // needs_review is NOT terminal: a human is expected to act on it.
    expect(isTerminalStatus("needs_review")).toBe(false);
  });
});
