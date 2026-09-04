// src/lib/watchlist/snapshotModel.test.js
//
// PRD 4's differentiator is "do not alert on every DOM change — alert only when
// a normalized business field changes." Everything below is a test of that
// sentence: the extractor must be reproducible, absence must not read as
// deletion, and noise must not read as news.

import { describe, expect, it } from "vitest";
import {
  extractSnapshot, snapshotHash, diffSnapshots, classifyUrl, normalise, SNAPSHOT_TYPES,
  discoverPages, MAX_DISCOVERED_PAGES,
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

// ── discoverPages — PRD 4's "domain mapping to recommend relevant pages" ────
// Without this a user adds a competitor and the crawler has nothing to crawl.
// The assertions that matter are the ones that stop it enrolling more than the
// user bargained for: every page here becomes a recurring, charged crawl.
describe("discoverPages", () => {
  const HTML = `
    <a href="/pricing">Pricing</a>
    <a href="/plans">Plans</a>
    <a href="/features">Features</a>
    <a href="/customers">Customers</a>
    <a href="/about">About</a>
    <a href="https://twitter.com/rival">Twitter</a>
    <a href="https://docs.rival.com/api">Docs</a>
    <a href="mailto:sales@rival.com">Email</a>
    <a href="/blog/some-post">Blog</a>`;

  it("always includes the homepage — the user named this domain explicitly", () => {
    const pages = discoverPages(HTML, "https://rival.com/");
    expect(pages[0]).toEqual({ url: "https://rival.com/", category: "positioning" });
  });

  it("finds the pricing and product pages", () => {
    const cats = discoverPages(HTML, "https://rival.com/").map((p) => p.category);
    expect(cats).toContain("pricing");
    expect(cats).toContain("product");
  });

  it("🔴 never exceeds the per-target cap", () => {
    // Every enrolled page is a recurring crawl charged to the customer. A
    // generous discovery quietly multiplies a watchlist's cost.
    expect(discoverPages(HTML, "https://rival.com/").length).toBeLessThanOrEqual(MAX_DISCOVERED_PAGES);
  });

  it("🔴 never leaves the origin", () => {
    // "Watch rival.com" must not become an open-ended crawler pointed at
    // Twitter, a docs subdomain, or any third party who never consented.
    for (const p of discoverPages(HTML, "https://rival.com/")) {
      expect(new URL(p.url).origin).toBe("https://rival.com");
    }
  });

  it("takes one page per category, spending the budget on breadth", () => {
    // /pricing and /plans are two views of the same fact; filling the budget
    // with both costs the product and customer-proof signals.
    const pages = discoverPages(HTML, "https://rival.com/");
    expect(pages.filter((p) => p.category === "pricing")).toHaveLength(1);
  });

  it("the homepage does not block the customer-proof page", () => {
    // Both are positioning-shaped, but /customers carries a signal the BRD
    // names in its own right. Letting the homepage consume the slot would drop
    // it from every watchlist by accident.
    const urls = discoverPages(HTML, "https://rival.com/").map((p) => p.url);
    expect(urls).toContain("https://rival.com/customers");
  });

  it("ignores links it cannot classify", () => {
    const urls = discoverPages(HTML, "https://rival.com/").map((p) => p.url);
    expect(urls.some((u) => u.includes("/blog/"))).toBe(false);
  });

  it("strips query strings and fragments", () => {
    // A session id in a query would make the URL unique on every crawl and
    // enrol the same page repeatedly.
    const pages = discoverPages('<a href="/pricing?ref=nav&sid=abc#top">P</a>', "https://rival.com/");
    expect(pages.map((p) => p.url)).toContain("https://rival.com/pricing");
  });

  it("does not throw on mailto:, javascript: or malformed hrefs", () => {
    expect(() => discoverPages('<a href="javascript:void(0)">x</a><a href="::::">y</a>', "https://rival.com/"))
      .not.toThrow();
  });

  it("returns nothing for a malformed base URL rather than throwing", () => {
    expect(discoverPages(HTML, "not a url")).toEqual([]);
  });

  it("returns just the homepage when a page links nowhere useful", () => {
    const pages = discoverPages("<p>no links here</p>", "https://rival.com/");
    expect(pages).toHaveLength(1);
    expect(pages[0].category).toBe("positioning");
  });

  it("only ever emits categories the schema accepts", () => {
    // monitored_pages.category has a CHECK: pricing|product|positioning|terms|other
    const allowed = new Set(["pricing", "product", "positioning", "terms", "other"]);
    for (const p of discoverPages(HTML, "https://rival.com/")) {
      expect(allowed.has(p.category), `${p.category} must satisfy the CHECK`).toBe(true);
    }
  });
});
