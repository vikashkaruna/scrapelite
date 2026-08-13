// aiService.test.js — QW#6 unit tests for the new content formats (Compare, Explain).
// Mocks callAI to return null (forces the mockContent fallback path), so we can
// verify the fallback content for each new format renders sensible markdown.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the mockContent path by making hasAI false (no API key).
vi.mock("./config.js", () => ({
  hasAI: false,
  VITE_AI_MODEL: "test",
  VITE_AI_API_KEY: "",
}));

import { generateContent, CONTENT_FORMATS, _buildSummaryPrompt } from "./aiService.js";

const SAMPLE = {
  url: "https://example.com/pricing",
  page_title: "Example Pricing",
  ai_summary: "Example offers three pricing tiers for small and large teams.",
  headings: [
    { tag: "H1", text: "Pricing" },
    { tag: "H2", text: "Starter" },
    { tag: "H2", text: "Team" },
    { tag: "H2", text: "Enterprise" },
  ],
  links: [
    { text: "Buy",    href: "https://example.com/buy" },
    { text: "Sign up", href: "https://example.com/signup" },
  ],
};

describe("QW#6 — CONTENT_FORMATS", () => {
  it("exposes 5 formats (3 original + Compare + Explain)", () => {
    const keys = CONTENT_FORMATS.map((f) => f.key);
    expect(keys).toContain("seo-outline");
    expect(keys).toContain("competitor-summary");
    expect(keys).toContain("social-posts");
    expect(keys).toContain("compare");
    expect(keys).toContain("explain");
    expect(CONTENT_FORMATS).toHaveLength(5);
  });

  it("every format has a label, icon, and instruction", () => {
    for (const f of CONTENT_FORMATS) {
      expect(f.key).toBeTypeOf("string");
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.icon).toBeTypeOf("string");
      expect(f.instruction.length).toBeGreaterThan(20);
    }
  });
});

describe("QW#6 — generateContent mock fallbacks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Compare mock returns a markdown table referencing the page", async () => {
    const fmt = CONTENT_FORMATS.find((f) => f.key === "compare");
    const md = await generateContent(SAMPLE, fmt);
    expect(md).toMatch(/^## Competitive comparison: Example Pricing/m);
    expect(md).toContain("| Axis | Position from this page |");
    expect(md).toContain("| --- | --- |");
    // 5 axes total
    expect((md.match(/^\| \*\*[^*]+\*\*/gm) || []).length).toBe(5);
  });

  it("Explain mock returns a plain-language breakdown with the title", async () => {
    const fmt = CONTENT_FORMATS.find((f) => f.key === "explain");
    const md = await generateContent(SAMPLE, fmt);
    expect(md).toMatch(/^# Example Pricing — explained/m);
    expect(md).toContain("## What it is");
    expect(md).toContain("## Who it is for");
    expect(md).toContain("## Why someone would choose it");
  });

  it("Compare and Explain still work on a sparse extraction", async () => {
    const sparse = { url: "https://x.com", page_title: "X" };
    const compare = await generateContent(sparse, CONTENT_FORMATS.find((f) => f.key === "compare"));
    const explain = await generateContent(sparse, CONTENT_FORMATS.find((f) => f.key === "explain"));
    expect(compare).toMatch(/^## Competitive comparison: X/m);
    expect(explain).toMatch(/^# X — explained/m);
  });
});

// Persona/intent-aware summarization prompt. Every persona and intent was
// previously getting the exact same "non-technical researcher" wording —
// this locks in that the audience framing now varies by persona while the
// no-context path stays byte-identical to the original generic prompt.
describe("buildSummaryPrompt — persona/intent framing", () => {
  const PAGE = {
    url: "https://example.com",
    page_title: "Example Co",
    headings: [{ tag: "H1", text: "Welcome" }],
    links: [{ text: "Pricing", href: "https://example.com/pricing" }],
  };

  it("with no context, matches the original generic wording exactly (regression guard)", () => {
    const prompt = _buildSummaryPrompt(PAGE);
    expect(prompt).toContain("You are summarizing a web page for a non-technical researcher.");
    expect(prompt).not.toMatch(/Prioritize/);
  });

  it("frames the audience by persona label when personaId is given", () => {
    const salesPrompt = _buildSummaryPrompt(PAGE, { personaId: "sales" });
    expect(salesPrompt).toContain("You are summarizing a web page for a Sales / SDR / BDR professional");
    expect(salesPrompt).not.toContain("non-technical researcher");

    const seoPrompt = _buildSummaryPrompt(PAGE, { personaId: "seo" });
    expect(seoPrompt).toContain("You are summarizing a web page for a SEO / Content Marketer professional");
  });

  it("falls back to the generic audience for an unknown personaId", () => {
    const prompt = _buildSummaryPrompt(PAGE, { personaId: "not-a-real-persona" });
    expect(prompt).toContain("for a non-technical researcher");
  });

  it("adds a focus clause for the contacts and pricing intents", () => {
    const contacts = _buildSummaryPrompt(PAGE, { intent: "contacts" });
    expect(contacts).toMatch(/Prioritize anything relevant to leadership, founders, or how to contact the company\./);

    const pricing = _buildSummaryPrompt(PAGE, { intent: "pricing" });
    expect(pricing).toMatch(/Prioritize anything relevant to pricing, plans, or cost\./);
  });

  it("adds no focus clause for summary/custom/map intents", () => {
    for (const intent of ["summary", "custom", "map", undefined]) {
      expect(_buildSummaryPrompt(PAGE, { intent })).not.toMatch(/Prioritize/);
    }
  });

  it("applies the same persona/intent framing to the pasted-content prompt", () => {
    const pasted = { raw_text: "Some pasted content about a product." };
    const prompt = _buildSummaryPrompt(pasted, { personaId: "recruiter", intent: "contacts" });
    expect(prompt).toContain("You are summarizing pasted content for a Recruiter professional");
    expect(prompt).toMatch(/Prioritize anything relevant to leadership, founders, or how to contact the company\./);
  });
});
