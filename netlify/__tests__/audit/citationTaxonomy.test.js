import { describe, it, expect, vi } from "vitest";
import { sampleCitations } from "../../functions/lib/audit/citationSampling.js";

// W6.2 — the taxonomy has to reach the stored runs, not merely exist.
// A generator nothing calls is the defect this module keeps finding in itself:
// `raw_value` declared in 0030 and never written, `audit_recommendations.issue_id`
// likewise. So these drive the real sampler and read what comes back.

const env = { PERPLEXITY_API_KEY: "test-key" };
const answer = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], citations: [] }),
});

describe("generated prompts carry their kind into the run record", () => {
  it("asks the undeclared-dimension kinds from a subject and brand alone", async () => {
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "web extraction", env, fetchImpl, maxPrompts: 10,
    });
    const kinds = new Set(r.runs.map((x) => x.kind));
    expect(kinds).toContain("category");
    expect(kinds).toContain("buyer_problem");
    expect(kinds.has("local")).toBe(false);      // no place was declared
    expect(kinds.has("industry")).toBe(false);   // no sector was declared
  });

  it("marks commercial prompts, which is what RecommendationRate is measured over", async () => {
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "web extraction", env, fetchImpl, maxPrompts: 10,
    });
    expect(r.runs.some((x) => x.commercial === true)).toBe(true);
    expect(r.runs.some((x) => x.commercial === false)).toBe(true);
  });

  it("🔴 asks a local prompt ONLY once a city is declared", async () => {
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const without = await sampleCitations({
      brand: "Acme", host: "acme.com", topic: "plumbing", env, fetchImpl, maxPrompts: 20,
    });
    expect(without.runs.some((x) => x.kind === "local")).toBe(false);

    const with_ = await sampleCitations({
      brand: "Acme", host: "acme.com", topic: "plumbing",
      geography: { city: "Pune" }, env, fetchImpl, maxPrompts: 20,
    });
    const local = with_.runs.filter((x) => x.kind === "local");
    expect(local.length).toBeGreaterThan(0);
    expect(local[0].prompt).toContain("Pune");
  });

  it("names a declared competitor head to head", async () => {
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "enrichment",
      competitors: ["https://clay.com"], env, fetchImpl, maxPrompts: 20,
    });
    expect(r.runs.some((x) => x.kind === "comparison" && /clay/i.test(x.prompt))).toBe(true);
  });

  it("⚠️ marks a user-written prompt's kind as GUESSED, not declared", async () => {
    // A caller-supplied list is text somebody wrote; its intent has to be
    // inferred, and a metric computed over inferred intent deserves to be read
    // more cautiously than one computed over declared intent.
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "x",
      prompts: ["best scraping tools", "What is DatIQ?"], env, fetchImpl,
    });
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].kind).toBe("category");
    expect(r.runs[0].kindConfidence).toBeLessThan(100);
    expect(r.runs[1].kindConfidence).toBeLessThan(100);
  });

  it("trusts a caller that supplies kinds itself", async () => {
    const fetchImpl = vi.fn(async () => answer("Nothing relevant."));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "x",
      prompts: [{ prompt: "best tools for x", kind: "category", commercial: true }],
      env, fetchImpl,
    });
    expect(r.runs[0].kind).toBe("category");
    expect(r.runs[0].commercial).toBe(true);
    expect(r.runs[0].kindConfidence).toBe(100);
  });

  it("keeps the kind on a prompt that failed, so a gap is explicable", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    const r = await sampleCitations({
      brand: "DatIQ", host: "datiq.app", topic: "x", env, fetchImpl, maxPrompts: 3,
    });
    expect(r.runs.every((x) => x.kind)).toBe(true);
    expect(r.runs.every((x) => x.error)).toBe(true);
  });
});
