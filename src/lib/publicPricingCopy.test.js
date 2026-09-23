// src/lib/publicPricingCopy.test.js — the public pricing claims must match the
// plans the server actually enforces.
//
// 🔴 THIS GUARD EXISTS BECAUSE THE SAME DRIFT HAS HAPPENED TWICE, SILENTLY.
// `pageSeo.js`'s FAQ JSON-LD once advertised "Select ($19/mo) is 100, Pro
// ($29/mo) is 250, Business ($79/mo) is 1,000" — all eight figures wrong —
// while every gate in the repo stayed green, because a price inside an answer
// body is prose to a test runner. The credit switch would have done it a third
// time: three files quoted an extraction allowance that nothing enforces any
// more.
//
// ⚠️ IT CHECKS NUMBERS, NOT NAMES. The readiness audit's "pricing coherence"
// check compares plan NAMES and passed throughout both incidents, which is
// exactly why a name check is not a substitute for this one.
//
// ⚠️ IT IS DELIBERATELY NARROW. It does not try to parse prose. It asserts
// that (a) each plan's credit allowance appears in each surface, and (b) the
// retired extraction allowances do NOT — which is the failure that actually
// occurred, in both directions.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PLANS, CREDIT_PACKS } from "./pricingConfig.js";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

// ⚠️ `pricingConfig.js` IS IN HERE BECAUSE LEAVING IT OUT ALREADY COST US.
// The first version of this test scanned the three files below and passed,
// while the Free plan card rendered "25-extraction trial credit" live on the
// deploy preview — because that string lives in the plan's own `features`
// array, not in any of them. A guard that enumerates its surfaces has the same
// blind spot as the hand-written lists this repo has been bitten by twice; the
// config that FEEDS every surface belongs in the list before the surfaces do.
const SURFACES = {
  "src/lib/pricingConfig.js": read("src/lib/pricingConfig.js"),
  "src/pages/Pricing.jsx":    read("src/pages/Pricing.jsx"),
  "public/llms.txt":          read("public/llms.txt"),
  "public/llms-full.txt":     read("public/llms-full.txt"),
  "src/lib/pageSeo.js":       read("src/lib/pageSeo.js"),
};

/** "40000" is written "40,000" in prose, so both spellings count as a match. */
const spellings = (n) => [String(n), Number(n).toLocaleString("en-US")];

describe("public pricing copy — credit allowances", () => {
  // Free / Go / Select / Pro / Business are the tiers every surface quotes.
  // Agency and Developer are quoted unevenly (fair use, coming-soon), so they
  // are checked only where they appear rather than demanded everywhere.
  const QUOTED = ["free", "go", "select", "pro", "business"];

  // Skipped for the two source files: `pricingConfig.js` DEFINES the numbers
  // (checking it against itself proves nothing) and `Pricing.jsx` derives every
  // figure from it at render time rather than hard-coding any.
  const PROSE = ["public/llms.txt", "public/llms-full.txt", "src/lib/pageSeo.js"];
  for (const [file, text] of Object.entries(SURFACES)) {
    if (!PROSE.includes(file)) continue;
    for (const id of QUOTED) {
      const plan = PLANS.find((p) => p.id === id);
      it(`${file} quotes ${plan.name}'s real allowance (${plan.limits.credits} credits)`, () => {
        const hit = spellings(plan.limits.credits).some((s) => text.includes(s));
        expect(hit, `${file} does not mention ${plan.limits.credits} anywhere`).toBe(true);
      });
    }
  }
});

describe("public pricing copy — the retired extraction quota is gone", () => {
  // Every one of these was a live claim before the switch. They are quoted with
  // their unit attached so an incidental "500" elsewhere cannot false-positive.
  const RETIRED = [
    "10 extractions/month",
    "200 extractions/month",
    "500 extractions/month",
    "1000 extractions/month",
    "1,000 extractions/month",
    "10,000 extractions/month",
    "10 extractions per month",
    "25 trial credits",
    "25-extraction trial credit",
    "monthly extraction budget",
    "Unused extractions don't roll over",
  ];

  for (const [file, text] of Object.entries(SURFACES)) {
    it(`${file} makes no retired extraction-quota claim`, () => {
      const found = RETIRED.filter((c) => text.includes(c));
      expect(found, `${file} still claims: ${found.join(" · ")}`).toEqual([]);
    });
  }

  it("the Pricing page makes none either", () => {
    const text = read("src/pages/Pricing.jsx");
    const found = RETIRED.filter((c) => text.includes(c));
    expect(found, `Pricing.jsx still claims: ${found.join(" · ")}`).toEqual([]);
  });
});

describe("public pricing copy — credit packs", () => {
  it("no plan's feature list advertises the retired signup grant", () => {
    // The Free card carried "25-extraction trial credit" as a feature line for
    // the whole switch, and only a real browser caught it.
    for (const plan of PLANS) {
      for (const f of plan.features || []) {
        expect(f.label.toLowerCase(), `${plan.id} feature: "${f.label}"`)
          .not.toMatch(/trial credit|extraction[s]? \/ ?month|extractions per month/);
      }
    }
  });

  it("llms.txt quotes every pack's real size and price", () => {
    const text = SURFACES["public/llms.txt"];
    for (const pack of CREDIT_PACKS) {
      const size = spellings(pack.credits).some((s) => text.includes(s));
      expect(size, `llms.txt omits the ${pack.credits}-credit pack`).toBe(true);
      expect(text, `llms.txt omits $${pack.price_usd}`).toContain(`$${pack.price_usd}`);
    }
  });

  it("a pack is described as never expiring, because that is what the ledger does", () => {
    // verify-payment grants a pack with NO expires_at. Copy that implied an
    // expiry would understate what was bought; copy that omitted it would leave
    // the difference from a monthly allowance unexplained.
    for (const [file, text] of Object.entries(SURFACES)) {
      if (!text.includes("pack")) continue;
      expect(text.toLowerCase(), `${file} sells packs without saying they persist`)
        .toMatch(/never expire|do not expire|don't expire/);
    }
  });
});
