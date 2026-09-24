import { describe, it, expect } from "vitest";
import { describeRule, describeSources, scopableSourceType } from "./ruleSentence.js";

describe("ruleSentence", () => {
  it("only watchlist and list rules can be limited to chosen sources", () => {
    expect(scopableSourceType("watchlist")).toBe("watchlist");
    expect(scopableSourceType("bulk_enrichment")).toBe("list");
    expect(scopableSourceType("workflow_run")).toBeNull();
  });

  it("says 'any' for a rule that listens to all", () => {
    expect(describeSources("watchlist", "all", [])).toBe("any watchlist");
    expect(describeSources("bulk_enrichment", "all", [{ name: "ignored" }])).toBe("any account list");
  });

  it("names the chosen sources", () => {
    expect(describeSources("watchlist", "selected", [{ name: "Rivals" }])).toBe("the watchlist Rivals");
    expect(describeSources("watchlist", "selected", [{ name: "A" }, { name: "B" }, { name: "C" }]))
      .toBe("the watchlists A, B or C");
  });

  // A scoped rule with nothing chosen matches NOTHING (0085 never widens), so
  // its sentence must not read like "any".
  it("a scoped rule with no sources says so, never 'any'", () => {
    const s = describeSources("watchlist", "selected", []);
    expect(s).toBe("no watchlist yet");
    expect(s).not.toMatch(/any/);
  });

  it("reads a whole rule as one sentence", () => {
    expect(describeRule({
      triggerSource: "watchlist",
      scope: "selected",
      sources: [{ name: "Rivals" }],
      condition: { field: "materiality", operator: "equals", value: "critical" },
      actionType: "slack",
      actionDest: "#alerts",
    })).toBe("When something changes on the watchlist Rivals and materiality is critical, post to Slack #alerts.");
  });

  it("covers not_empty and email", () => {
    expect(describeRule({
      triggerSource: "bulk_enrichment",
      condition: { field: "icp_score", operator: "not_empty" },
      actionType: "email",
      actionDest: "a@b.co",
    })).toBe("When an account is scored in any account list and icp_score is set, email a@b.co.");
  });
});
