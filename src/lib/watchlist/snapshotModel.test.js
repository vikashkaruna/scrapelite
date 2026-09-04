// src/lib/watchlist/snapshotModel.test.js
//
// PRD 4's differentiator is "do not alert on every DOM change — alert only when
// a normalized business field changes." Everything below is a test of that
// sentence: the extractor must be reproducible, absence must not read as
// deletion, and noise must not read as news.

import { describe, expect, it } from "vitest";
import {
  extractSnapshot, snapshotHash, diffSnapshots, classifyUrl, normalise, SNAPSHOT_TYPES,
} from "./snapshotModel.js";

const pricingPage = {
  title: "Pricing | Acme",
  headings: ["Simple pricing", "Starter", "Pro", "Enterprise"],
  text: "Simple pricing\n$0 per month for Starter\n$49 per month\n$99 per month billed annually\n",
};

describe("classifyUrl", () => {
  it("recognises the pricing family", () => {
    for (const u of ["https://a.com/pricing", "https://a.com/plans", "https://a.com/price-list"]) {
      expect(classifyUrl(u)?.type).toBe("pricing");
    }
  });

  it("treats the homepage as positioning — it is where the hero line lives", () => {
    expect(classifyUrl("https://a.com/")?.type).toBe("positioning");
    expect(classifyUrl("https://a.com")?.type).toBe("positioning");
  });

  it("returns null for a page not worth monitoring, rather than guessing", () => {
    expect(classifyUrl("https://a.com/blog/2024/some-post")).toBeNull();
  });

  it("does not throw on a malformed URL", () => {
    expect(classifyUrl("not a url")).toBeNull();
  });

  it("only ever returns a known snapshot type", () => {
    for (const u of ["https://a.com/", "https://a.com/pricing", "https://a.com/features", "https://a.com/customers"]) {
      const c = classifyUrl(u);
      if (c) expect(SNAPSHOT_TYPES).toContain(c.type);
    }
  });
});

describe("extractSnapshot — observes, never invents", () => {
  it("reads price points off a pricing page", () => {
    const { fields } = extractSnapshot(pricingPage, "pricing");
    expect(fields["pricing.amounts"]).toContain("$49");
    expect(fields["pricing.amounts"]).toContain("$99");
  });

  it("takes plan names from headings only", () => {
    const { fields } = extractSnapshot(pricingPage, "pricing");
    expect(fields["pricing.tiers"]).toContain("Starter");
    expect(fields["pricing.tiers"]).toContain("Enterprise");
  });

  it("does NOT mine plan names out of body prose", () => {
    // "provide", "process" and "product" all contain plan-word substrings. A
    // naive scan reports a plan ladder that is not on the page.
    const { fields } = extractSnapshot(
      { title: "T", headings: ["Overview"], text: "We provide a process for product teams." },
      "pricing",
    );
    expect(fields["pricing.tiers"]).toBeUndefined();
  });

  it("does not read a bare year or a customer count as a price", () => {
    const { fields } = extractSnapshot(
      { title: "T", headings: [], text: "Founded in 2019. Trusted by 500 companies." },
      "pricing",
    );
    expect(fields["pricing.amounts"]).toBeUndefined();
  });

  it("omits a field it cannot observe rather than defaulting it", () => {
    const { fields, observed } = extractSnapshot({ title: "", headings: [], text: "" }, "pricing");
    expect(fields["pricing.amounts"]).toBeUndefined();
    expect(fields["pricing.tiers"]).toBeUndefined();
    expect(observed).toBe(0);
  });

  it("is deterministic — the same page twice yields the same fields", () => {
    const a = extractSnapshot(pricingPage, "pricing");
    const b = extractSnapshot(pricingPage, "pricing");
    expect(a.fields).toEqual(b.fields);
    expect(snapshotHash(a.fields)).toBe(snapshotHash(b.fields));
  });

  it("normalises whitespace, so a reflow is not a change", () => {
    const spaced = { ...pricingPage, headings: ["Simple   pricing", "Starter", "Pro", "Enterprise"] };
    expect(snapshotHash(extractSnapshot(spaced, "pricing").fields))
      .toBe(snapshotHash(extractSnapshot(pricingPage, "pricing").fields));
  });
});

describe("snapshotHash — hashes the FIELDS, not the markup", () => {
  it("is stable across key order", () => {
    expect(snapshotHash({ a: "1", b: "2" })).toBe(snapshotHash({ b: "2", a: "1" }));
  });

  it("moves when a monitored value moves", () => {
    expect(snapshotHash({ "pricing.amounts": "$49" }))
      .not.toBe(snapshotHash({ "pricing.amounts": "$59" }));
  });

  it("an empty snapshot has a stable hash rather than throwing", () => {
    expect(snapshotHash({})).toBe(snapshotHash({}));
  });
});

describe("diffSnapshots — the anti-noise contract", () => {
  it("reports a changed value with both sides", () => {
    const d = diffSnapshots({ "pricing.amounts": "$49" }, { "pricing.amounts": "$59" }, "pricing");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "pricing.amounts", oldValue: "$49", newValue: "$59", category: "pricing" });
  });

  it("reports a newly observed field as an addition", () => {
    const d = diffSnapshots({}, { "pricing.tiers": "Free | Pro" }, "pricing");
    expect(d).toHaveLength(1);
    expect(d[0].oldValue).toBe("");
  });

  it("🔴 does NOT report a field that merely stopped being observed", () => {
    // This is the assertion that keeps a failed render from being announced as
    // "they deleted all their pricing" — the single most damaging false
    // positive this feature could produce, because someone would act on it.
    const d = diffSnapshots({ "pricing.amounts": "$49" }, {}, "pricing");
    expect(d).toEqual([]);
  });

  it("reports nothing when nothing moved", () => {
    const same = { "pricing.amounts": "$49", "pricing.tiers": "Free | Pro" };
    expect(diffSnapshots(same, { ...same })).toEqual([]);
  });

  it("ignores a whitespace-only difference", () => {
    expect(diffSnapshots({ x: "Free | Pro" }, { x: "Free  |  Pro" })).toEqual([]);
  });

  it("survives null/undefined inputs without throwing", () => {
    expect(diffSnapshots(undefined, undefined)).toEqual([]);
    expect(diffSnapshots(null, { a: "1" })).toHaveLength(1);
  });
});

describe("normalise", () => {
  it("collapses whitespace and trims", () => {
    expect(normalise("  a   b \n c ")).toBe("a b c");
  });
  it("coerces nullish to an empty string rather than 'null'", () => {
    expect(normalise(null)).toBe("");
    expect(normalise(undefined)).toBe("");
  });
  it("caps runaway values so one bloated field cannot dominate a snapshot", () => {
    expect(normalise("x".repeat(5000)).length).toBeLessThanOrEqual(240);
  });
});
