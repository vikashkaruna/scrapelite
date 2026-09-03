import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicProvenance, operatorProvenance } from "../functions/lib/aiFailure.js";

// Vendor identity, model ids, and the env vars that hold their keys. The
// failure path already sweeps for these (ai.test.js, extract.test.js); this is
// the SUCCESS path, which shipped `openai · gpt-4o-mini` on the customer's own
// report while the failure path was busy hiding exactly that.
const FORBIDDEN = [
  /openai/i, /anthropic/i, /gemini/i, /claude/i, /perplexity/i,
  /gpt-[0-9]/i, /sonar/i, /firecrawl/i, /spider/i, /jina/i,
  /API_KEY/i, /credit balance/i,
];

const INTERNAL_META = {
  ok: true,
  capability: "pricing",
  label: "Pricing & plans",
  groups: [{ key: "tiers", label: "Tiers" }],
  facts: 8,
  pagesRead: ["https://example.com", "https://example.com/pricing"],
  // The three that must never reach a customer:
  provider: "openai",
  model: "gpt-4o-mini",
  structured: true,
};

describe("publicProvenance — the success-path boundary", () => {
  it("keeps everything that describes the CUSTOMER'S page", () => {
    const pub = publicProvenance(INTERNAL_META);
    expect(pub).toMatchObject({
      ok: true, capability: "pricing", label: "Pricing & plans", facts: 8,
      pagesRead: ["https://example.com", "https://example.com/pricing"],
    });
  });

  it("drops everything that describes OUR STACK", () => {
    const pub = publicProvenance(INTERNAL_META);
    expect(pub).not.toHaveProperty("provider");
    expect(pub).not.toHaveProperty("model");
    expect(pub).not.toHaveProperty("structured");
  });

  it("leaks no vendor identity under any pattern in the sweep", () => {
    const body = JSON.stringify(publicProvenance(INTERNAL_META));
    for (const re of FORBIDDEN) expect(body, `matched ${re}`).not.toMatch(re);
  });

  // An allowlist, not a denylist. A denylist ships every field someone adds
  // later — which is exactly how provider/model survived the first redaction.
  it("is an ALLOWLIST — an unknown field added upstream does not ship", () => {
    const pub = publicProvenance({ ...INTERNAL_META, newInternalField: "vendor-secret", costUsd: 0.0012 });
    expect(pub).not.toHaveProperty("newInternalField");
    expect(pub).not.toHaveProperty("costUsd");
    expect(JSON.stringify(pub)).not.toMatch(/vendor-secret/);
  });

  it("passes through a failure reason, which is a finding about their page", () => {
    expect(publicProvenance({ ok: false, reason: "no_match", provider: "openai" }))
      .toEqual({ ok: false, reason: "no_match" });
  });

  it("handles null and junk without throwing", () => {
    expect(publicProvenance(null)).toBeNull();
    expect(publicProvenance(undefined)).toBeNull();
    expect(publicProvenance("nope")).toBeNull();
    expect(publicProvenance({})).toEqual({});
  });

  it("operatorProvenance still carries the full diagnosis for admin surfaces", () => {
    expect(operatorProvenance(INTERNAL_META).provider).toBe("openai");
    expect(operatorProvenance(INTERNAL_META).model).toBe("gpt-4o-mini");
  });
});

// The durable guard. Comments and intentions rot; a grep over the shipped
// source does not. This is what stops someone helpfully adding the chip back.
describe("customer-facing components render no vendor identity", () => {
  const read = (rel) => readFileSync(resolve(process.cwd(), rel), "utf8");

  it("StructuredFacts does not render meta.provider or meta.model", () => {
    const src = read("src/components/StructuredFacts.jsx");
    // Strip comments first — this file DOCUMENTS the removal, and the
    // documentation must not trip its own guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/meta\.provider/);
    expect(code).not.toMatch(/meta\.model/);
    expect(code).not.toMatch(/meta\.structured/);
    expect(code).not.toMatch(/Schema-validated/i);
  });

  it("the template runner does not render the scrape vendor on a source", () => {
    const src = read("src/pages/Templates.jsx");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/via \$\{?s\.provider/);
    expect(code).not.toMatch(/s\.provider \?/);
  });

  it("extract.js redacts provenance at the source, not only in the UI", () => {
    const src = read("netlify/functions/extract.js");
    // The response must be built through the redactor. Shipping the raw
    // enrichmentMeta is the bug this whole file exists to prevent.
    expect(src).toMatch(/_enrichment: publicProvenance\(enrichmentMeta\)/);
    expect(src).not.toMatch(/_enrichment: enrichmentMeta\b/);
  });
});
