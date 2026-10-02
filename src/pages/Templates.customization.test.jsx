import { describe, it, expect } from "vitest";
import { estimateCredits } from "../lib/templates/templateModel.js";
import { SEED_TEMPLATES } from "../lib/templates/seedTemplates.js";

describe("Templates Customization & Dynamic Credits", () => {
  const accountBrief = SEED_TEMPLATES.find((t) => t.template_key === "account_brief");

  it("calculates base credits accurately without customization", () => {
    const est = estimateCredits(accountBrief, { domain: "stripe.com" });
    // base: 1, 3 pages * 1 = 3, AI extraction 1 x 5 + synthesis 2 x 5 = 15 -> total: 19
    expect(est.credits).toBe(19);
  });

  it("dynamically increases credits when extra subpages are added", () => {
    const baseEst = estimateCredits(accountBrief, { domain: "stripe.com" });
    const customizedEst = estimateCredits(accountBrief, {
      domain: "stripe.com",
      extra_subpages: 2,
    });

    expect(customizedEst.credits).toBeGreaterThan(baseEst.credits);
    expect(customizedEst.credits).toBe(baseEst.credits + 2); // 2 pages * 1 credit/page
    expect(customizedEst.breakdown.some((b) => b.label.includes("custom"))).toBe(true);
  });

  it("custom fields ride inside the extraction call and add no charge", () => {
    const baseEst = estimateCredits(accountBrief, { domain: "stripe.com" });
    const customizedEst = estimateCredits(accountBrief, {
      domain: "stripe.com",
      custom_fields: "tech_stack, certifications, funding",
    });

    // The weights count provider CALLS, not tokens: the custom fields grow the
    // extraction schema, not the call count, so the quote is unchanged.
    expect(customizedEst.credits).toBe(baseEst.credits);
  });

  it("includes all required personas and workflows in seed templates", () => {
    const personas = new Set(SEED_TEMPLATES.map((t) => t.persona));
    expect(personas.has("recruiter")).toBe(true);
    expect(personas.has("market-research")).toBe(true);
    expect(personas.has("agency")).toBe(true);
    const hasWorkflows = SEED_TEMPLATES.some((t) => t.persona === "workflows" || t.tags?.includes("workflows") || t.template_key === "continuous_account_signal");
    expect(hasWorkflows).toBe(true);
  });
});
