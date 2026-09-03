import { describe, it, expect } from "vitest";
import { checkAllowance } from "../../src/lib/credits/creditModel.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLANS } from "../../src/lib/pricingConfig.js";

const SRC = readFileSync(resolve(process.cwd(), "netlify/functions/templates.js"), "utf8");
const UI = readFileSync(resolve(process.cwd(), "src/pages/Templates.jsx"), "utf8");

describe("credits are verified BEFORE any work happens", () => {
  // 🔴 checkAllowance shipped with the ledger and had ZERO callers: credits
  // were recorded but never enforced. This asserts it is actually wired.
  it("templates.js calls checkAllowance", () => {
    expect(SRC).toMatch(/checkAllowance\(/);
  });

  it("refuses BEFORE the run row is created — nothing charged, no partial report", () => {
    const refuseAt = SRC.indexOf("insufficient_credits");
    const runRowAt = SRC.indexOf("const runId = genRunId()");
    expect(refuseAt).toBeGreaterThan(-1);
    expect(runRowAt).toBeGreaterThan(-1);
    expect(refuseAt, "the refusal must come before the run row").toBeLessThan(runRowAt);
  });

  it("returns 402 with the numbers, not a bare 'insufficient credits'", () => {
    // A user who cannot tell whether to wait or to upgrade cannot act.
    for (const field of ["needed", "remaining", "shortBy", "allowance", "upgradeUrl"]) {
      expect(SRC, `402 body should carry ${field}`).toMatch(new RegExp(`${field}[,:]`));
    }
  });

  it("resolves the allowance through the effective plan, not the static table", () => {
    // So an admin price override moves the budget too.
    expect(SRC).toMatch(/getEffectivePlanById/);
  });

  // Not a guess: developer's `extractions: 10000` is the same number its
  // pricing page calls "10,000 row credits / month".
  it("every plan has a usable extractions allowance", () => {
    for (const p of PLANS) {
      const n = p.limits?.extractions;
      expect(n === undefined || Number.isFinite(n) || n === Infinity,
        `${p.id} has no usable extractions allowance`).toBe(true);
    }
  });

  it("the client mirrors the server with the SAME pure function", () => {
    expect(UI).toMatch(/checkAllowance\(/);
    // and it must not invent its own arithmetic
    expect(UI).not.toMatch(/allowance\s*-\s*spent/);
  });
});

describe("checkAllowance itself", () => {
  it("permits a run that exactly exhausts the budget", () => {
    expect(checkAllowance({ spent: 2, allowance: 10, estimated: 8 }).ok).toBe(true);
  });
  it("refuses one credit over, and says by how much", () => {
    const r = checkAllowance({ spent: 3, allowance: 10, estimated: 8 });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(7);
    expect(r.wouldExceedBy).toBe(1);
  });
  // Agency is Infinity — an unlimited plan must never be refused.
  it("never refuses an unlimited plan", () => {
    expect(checkAllowance({ spent: 999999, allowance: Infinity, estimated: 500 }).ok).toBe(true);
  });
  it("treats an exhausted budget as zero remaining, not negative", () => {
    expect(checkAllowance({ spent: 50, allowance: 10, estimated: 1 }).remaining).toBe(0);
  });
});
