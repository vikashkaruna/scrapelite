// src/lib/templates/mockGuard.test.js — a template run must never bill or
// persist demo data. When the browser-side mock scraper answers (extraction
// not configured on this deployment — VITE_ENABLE_EXTRACT unset), executeRun
// aborts with an actionable error BEFORE any credits or AI calls, instead of
// returning the "Structured data … would appear here" placeholder as facts.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const extractStructureMock = vi.hoisted(() => vi.fn());

vi.mock("../firecrawlService.js", () => ({
  extractStructure: extractStructureMock,
}));

import { executeRun } from "./templatesClient.js";
import { SEED_TEMPLATES } from "./seedTemplates.js";

// The template this bug shipped on — customer_proof_extractor.
const TEMPLATE = SEED_TEMPLATES.find((t) => t.template_key === "customer_proof_extractor");

describe("executeRun — mock scrape guard", () => {
  beforeEach(() => {
    extractStructureMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts with an actionable error when the scraper returns mock data", async () => {
    extractStructureMock.mockResolvedValue({
      mock: true,
      page_title: "Mock",
      custom_extraction: { query: "x", result: "Structured data matching your request would appear here for Datiq.", source: "https://datiq.app" },
    });
    await expect(
      executeRun({ template: TEMPLATE, input: { url: "https://datiq.app" }, onProgress: () => {} }),
    ).rejects.toThrow(/not configured/i);
    // The error must say what to do, not just that it failed.
    await expect(
      executeRun({ template: TEMPLATE, input: { url: "https://datiq.app" }, onProgress: () => {} }),
    ).rejects.toThrow(/VITE_ENABLE_EXTRACT/);
  });

  it("runs normally when the scrape is real (no mock marker)", async () => {
    extractStructureMock.mockResolvedValue({
      page_title: "Real",
      custom_extraction: { named_customers: ["Acme"] },
    });
    // No real AI synthesis is reachable here, so the run completes with a
    // partial verdict — the guard's absence is what this asserts.
    const result = await executeRun({ template: TEMPLATE, input: { url: "https://acme.com" }, onProgress: () => {} });
    expect(result).toBeTruthy();
    expect(result.output.fields.named_customers).toEqual(["Acme"]);
  });
});
