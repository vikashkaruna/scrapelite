import { describe, it, expect } from "vitest";
import { runToItem, runsToItems } from "./runToItems.js";
import { extractionRows } from "../utils.js";

const run = {
  id: "trun_1",
  template_key: "account_brief",
  input: { domain: "proteantech.in" },
  output_summary: "A summary.",
  output: {
    fields: { industry: "Software", employees: 120 },
    talking_points: ["Point one", "Point two"],
    custom_block: { note: "kept" },
  },
  sources: [{ url: "https://proteantech.in/about", title: "About" }],
};

describe("runToItems", () => {
  it("maps a run into the shape the exporters already read", () => {
    const item = runToItem(run);
    expect(item.url).toBe("https://proteantech.in");
    expect(item.page_title).toBe("Account Brief");
    expect(item.ai_summary).toBe("A summary.");
    expect(item.links[0]).toMatchObject({ href: "https://proteantech.in/about" });
    expect(Object.keys(item.enrichments)).toContain("facts");
    expect(Object.keys(item.enrichments)).toContain("talking_points");
  });

  it("carries a block the adapter was never told about", () => {
    expect(Object.keys(runToItem(run).enrichments)).toContain("custom_block");
  });

  it("omits blocks the run does not carry — never emits them empty", () => {
    const item = runToItem({ ...run, output: { summary: "s" } });
    expect(item.enrichments).toEqual({});
  });

  it("produces rows the real exporter can render", () => {
    const rows = extractionRows(runToItem(run));
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toMatch(/industry/);
    expect(flat).toMatch(/Point one/);
    expect(flat).toMatch(/A summary\./);
  });

  it("returns [] for nothing, rather than an item full of blanks", () => {
    expect(runsToItems([null, undefined])).toEqual([]);
  });
});

describe("runToItems — the live Templates result shape", () => {
  it("reads summary and talking points from the top level too", () => {
    const item = runToItem({
      template_key: "due_diligence_brief",
      input: { domain: "datiq.app" },
      summary: "Top-level summary.",
      talking_points: ["A", "B"],
      output: { fields: { x: 1 } },
    });
    expect(item.ai_summary).toBe("Top-level summary.");
    expect(item.enrichments.talking_points.data).toEqual(["A", "B"]);
    expect(item.enrichments.facts.data).toEqual({ x: 1 });
  });
});
