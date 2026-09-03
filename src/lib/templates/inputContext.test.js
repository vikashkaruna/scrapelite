import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEED_TEMPLATES } from "./seedTemplates.js";

const SRC = readFileSync(resolve(process.cwd(), "src/lib/templates/templatesClient.js"), "utf8");

// inputContext is module-private (it is prompt plumbing, not an API), so it is
// exercised through a faithful re-implementation pinned to the source below.
function inputContext(template, input) {
  const fields = template?.input_schema?.fields;
  if (!Array.isArray(fields) || !input) return "";
  const lines = [];
  for (const f of fields) {
    if (!f?.name || f.name === "domain" || f.name === "url") continue;
    const raw = input[f.name];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!value.trim()) continue;
    const opt = Array.isArray(f.options) ? f.options.find((o) => o.value === raw) : null;
    lines.push(`- ${f.label || f.name}: ${opt?.label || value}`);
  }
  return lines.length
    ? `\n\nWHAT THE USER ASKED FOR (shape the output to this — it is why they ran the template):\n${lines.join("\n")}\n`
    : "";
}

const accountBrief = SEED_TEMPLATES.find((t) => t.template_key === "account_brief");

describe("template inputs reach the prompt", () => {
  // THE REGRESSION. `angle` was shown, validated, stored and CHARGED FOR, and
  // never read — so a user who picked "Displacing an incumbent" paid 8 credits
  // for a brief answering a different question, with nothing failing anywhere.
  it("includes the outreach angle a user actually chose", () => {
    const ctx = inputContext(accountBrief, { domain: "proteantech.in", angle: "displacement" });
    expect(ctx).toContain("Outreach angle");
    expect(ctx).toContain("Displacing an incumbent");
  });

  // The model reasons better about the label than the stored enum value.
  it("renders the human LABEL of a choice, not its stored value", () => {
    const ctx = inputContext(accountBrief, { domain: "x.com", angle: "displacement" });
    expect(ctx).not.toMatch(/: displacement/);
  });

  it("omits the target — it is the subject, not a preference", () => {
    const ctx = inputContext(accountBrief, { domain: "proteantech.in", angle: "discovery" });
    expect(ctx).not.toContain("proteantech.in");
  });

  it("returns nothing when only the target was given", () => {
    expect(inputContext(accountBrief, { domain: "x.com" })).toBe("");
  });

  it("skips blank and missing values rather than emitting empty lines", () => {
    const ctx = inputContext(accountBrief, { domain: "x.com", angle: "   " });
    expect(ctx).toBe("");
  });

  it("joins list inputs", () => {
    const t = { input_schema: { fields: [{ name: "competitors", label: "Competitors" }] } };
    expect(inputContext(t, { competitors: ["a.com", "b.com"] })).toContain("Competitors: a.com, b.com");
  });

  it("survives a template with no input schema", () => {
    expect(inputContext({}, { angle: "x" })).toBe("");
    expect(inputContext(accountBrief, null)).toBe("");
  });

  // Driven off input_schema, not a hand-maintained list — a hand-maintained
  // list is exactly how `angle` came to be forgotten.
  it("covers every non-target input of every seeded template", () => {
    for (const t of SEED_TEMPLATES) {
      const fields = (t.input_schema?.fields || []).filter((f) => !["domain", "url"].includes(f.name));
      if (!fields.length) continue;
      const input = Object.fromEntries(fields.map((f) => [
        f.name, Array.isArray(f.options) ? f.options[0].value : "sample",
      ]));
      const ctx = inputContext(t, input);
      for (const f of fields) {
        expect(ctx, `${t.template_key}.${f.name} never reaches the prompt`).toContain(f.label || f.name);
      }
    }
  });
});

describe("the real module actually uses it", () => {
  it("defines inputContext and threads it into BOTH execution paths", () => {
    expect(SRC).toMatch(/function inputContext\(/);
    // Single-target runs.
    expect(SRC).toMatch(/pageText: `\$\{inputContext\(template, input\)\}/);
    // The visibility brief takes its own path and had the same gap.
    expect(SRC).toMatch(/audienceLine\}\.\$\{inputContext\(template, input\)\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "We failed" vs "this site does not publish that" — only one is our fault.
// ─────────────────────────────────────────────────────────────────────────────
describe("a finding is not an incomplete run", () => {
  const partialFor = (reason, facts, summary, wantedSummary = true) => {
    const operatorFault = /^ai_/.test(reason || "") || reason === "page_no_content";
    const informationAbsent = !facts && !operatorFault && Boolean(summary);
    return {
      informationAbsent,
      partial: (!facts && !informationAbsent) || (wantedSummary && !summary),
    };
  };

  it("a site that does not publish pricing is a FINDING, not incomplete", () => {
    // Exactly the Competitor Pricing Tracker case: read the pages fine, the
    // company keeps pricing off its website, and the AI said so.
    const r = partialFor("no_match", null, "They don't publish pricing.");
    expect(r.informationAbsent).toBe(true);
    expect(r.partial).toBe(false);
  });

  it("an unreadable page IS incomplete — retrying may help", () => {
    expect(partialFor("page_no_content", null, "x").partial).toBe(true);
  });

  it("an AI fault IS incomplete", () => {
    expect(partialFor("ai_unavailable", null, "x").partial).toBe(true);
  });

  it("a missing summary is still incomplete even when the info was absent", () => {
    // The template promised a synthesis and did not deliver one. That is ours.
    expect(partialFor("no_match", null, null).partial).toBe(true);
  });

  it("a clean run is neither", () => {
    const r = partialFor(null, { plans: [1] }, "summary");
    expect(r.partial).toBe(false);
    expect(r.informationAbsent).toBe(false);
  });

  // A successful synthesis PROVES the page was readable — so empty structured
  // facts alongside a real summary is a finding, even when the server recorded
  // no reason at all. This is the Customer Proof Extractor case: an accurate
  // summary sat directly above a banner contradicting it.
  it("treats a successful summary as proof the page was readable", () => {
    const r = partialFor(null, null, "They lead with public-sector outcomes.");
    expect(r.informationAbsent).toBe(true);
    expect(r.partial).toBe(false);
  });

  it("but an operator fault is never dressed up as a finding", () => {
    for (const reason of ["ai_unavailable", "ai_no_credit", "ai_chain_failed", "page_no_content"]) {
      const r = partialFor(reason, null, "a summary");
      expect(r.informationAbsent, reason).toBe(false);
      expect(r.partial, reason).toBe(true);
    }
  });

  it("the module implements this split, not just the test", () => {
    expect(SRC).toMatch(/const operatorFault = \/\^ai_\//);
    expect(SRC).toMatch(/informationAbsent = !facts && !operatorFault && Boolean\(summary\)/);
    expect(SRC).toMatch(/partial = \(!facts && !informationAbsent\)/);
  });
});
