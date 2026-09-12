// Release 0 — stable extraction export envelope.
//
// Dashboard, Preview and Batch delegate their CSV/Markdown/JSON exports to
// these shared builders. Keep one representative extraction here so a change
// cannot make one machine-readable format silently lose data the others keep.

import { describe, expect, it } from "vitest";
import { extractionsToCsv, extractionsToJson, extractionsToMarkdown } from "./utils.js";

const GENERATED_AT = "2026-09-12T00:00:00.000Z";
const extraction = {
  id: "ex_contract",
  url: "https://example.test/pricing",
  page_title: "Example pricing",
  ai_summary: "A concise summary.",
  created_at: GENERATED_AT,
  headings: [{ tag: "h1", text: "Plans" }],
  links: [{ text: "Contact", href: "https://example.test/contact", category: "internal" }],
  domain_map: ["https://example.test/pricing", "https://example.test/contact"],
  enrichments: {
    pricing: { key: "pricing", label: "Pricing & plans", data: { starter: "$0" } },
  },
};

describe("Release 0 export contract", () => {
  it("keeps the shared source, page count and meaningful result data in CSV, Markdown and JSON", () => {
    const csv = extractionsToCsv(extraction, { generatedAt: GENERATED_AT });
    const markdown = extractionsToMarkdown(extraction, { generatedAt: GENERATED_AT });
    const json = JSON.parse(extractionsToJson(extraction, { generatedAt: GENERATED_AT }));

    expect(csv).toContain("# DatIQ Export — Extraction Report");
    expect(csv).toContain('"page","type","name","text","value"');
    expect(csv).toContain("example.test/pricing");
    expect(csv).toContain("Pricing & plans");

    expect(markdown).toContain("# DatIQ Extraction Report");
    expect(markdown).toContain("https://example.test/pricing");
    expect(markdown).toContain("### Headings (1)");
    expect(markdown).toContain("### Pricing & plans");

    expect(json.export).toMatchObject({
      tool: "DatIQ",
      version: "2.0",
      date: GENERATED_AT,
      count: 1,
      source: ["https://example.test/pricing"],
    });
    expect(json.pages[0]).toMatchObject({
      url: "https://example.test/pricing",
      page_title: "Example pricing",
      ai_summary: "A concise summary.",
      domain_map: extraction.domain_map,
      enrichments: { pricing: { starter: "$0" } },
    });
  });

  it("uses the batch envelope consistently for multiple selected pages", () => {
    const second = { ...extraction, id: "ex_contract_2", url: "https://second.test/" };
    const json = JSON.parse(extractionsToJson([extraction, second], { generatedAt: GENERATED_AT }));
    const markdown = extractionsToMarkdown([extraction, second], { generatedAt: GENERATED_AT });

    expect(json.export).toMatchObject({ kind: "batch", count: 2 });
    expect(json.pages).toHaveLength(2);
    expect(markdown).toContain("# DatIQ Batch Extraction Report");
    expect(markdown).toContain("## 2. Example pricing");
    expect(markdown).toContain("**URL:** <https://second.test/>");
  });
});
