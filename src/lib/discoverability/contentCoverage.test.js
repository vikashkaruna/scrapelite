import { describe, it, expect } from "vitest";
import {
  CONTENT_KINDS, CONTENT_KIND_IDS, contentKind,
  classifyUrl, analyseContentCoverage, describeAbsence,
} from "./contentCoverage.js";

describe("the kind registry", () => {
  it("covers exactly the four kinds the PRD names", () => {
    expect(CONTENT_KIND_IDS).toEqual(["comparison", "use_case", "industry", "category"]);
  });

  it("gives every kind a query shape and a reason, since both reach the user", () => {
    for (const id of CONTENT_KIND_IDS) {
      expect(CONTENT_KINDS[id].query, id).toBeTruthy();
      expect(CONTENT_KINDS[id].why.length, id).toBeGreaterThan(40);
      expect(CONTENT_KINDS[id].patterns.length, id).toBeGreaterThan(2);
    }
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(contentKind("invented")).toBeNull();
    expect(contentKind(undefined)).toBeNull();
  });
});

describe("classifyUrl", () => {
  it("recognises the common shapes of each kind", () => {
    expect(classifyUrl("https://x.com/vs/browse-ai")).toContain("comparison");
    expect(classifyUrl("https://x.com/datiq-vs-clay")).toContain("comparison");
    expect(classifyUrl("https://x.com/alternatives/apify")).toContain("comparison");
    expect(classifyUrl("https://x.com/use-cases/lead-generation")).toContain("use_case");
    expect(classifyUrl("https://x.com/industries/healthcare")).toContain("industry");
    expect(classifyUrl("https://datiq.app/for-finance")).toContain("industry");
    expect(classifyUrl("https://datiq.app/for-healthcare")).toContain("industry");
    expect(classifyUrl("https://datiq.app/for-retail")).toContain("industry");
    expect(classifyUrl("https://datiq.app/for-legal")).toContain("industry");
    expect(classifyUrl("https://x.com/category/scrapers")).toContain("category");
  });

  it("matches nothing on an ordinary page", () => {
    expect(classifyUrl("https://x.com/pricing")).toEqual([]);
    expect(classifyUrl("https://x.com/")).toEqual([]);
  });

  it("classifies a bare path, not only a full url", () => {
    expect(classifyUrl("/vs/clay")).toContain("comparison");
  });

  it("is empty for junk instead of throwing", () => {
    expect(classifyUrl("")).toEqual([]);
    expect(classifyUrl(null)).toEqual([]);
  });
});

describe("🔴 an unread sitemap produces NO findings", () => {
  // This is the load-bearing behaviour of the module. An empty url list can
  // mean "this site publishes nothing" or "we never got to look", and only the
  // first is a finding about the customer. The repo has shipped that confusion
  // before: a related-page gather skipped for budget returned [], resolved to
  // no_match, and told customers their page had no pricing without ever opening
  // the page that carried it.

  it("reports nothing missing when no sitemap was declared", () => {
    const c = analyseContentCoverage({ fetched: false, urls: [], reason: "no sitemap declared in robots.txt" });
    expect(c.usable).toBe(false);
    expect(c.missing).toEqual([]);
  });

  it("reports nothing missing when the budget ran out", () => {
    const c = analyseContentCoverage({ fetched: false, urls: [], reason: "no budget left for a sitemap fetch" });
    expect(c.missing).toEqual([]);
    expect(c.reason).toMatch(/budget/);
  });

  it("reports nothing missing when the fetch failed", () => {
    expect(analyseContentCoverage({ fetched: false, urls: [], reason: "sitemap responded 404" }).missing).toEqual([]);
  });

  it("reports nothing missing when the crawl was TRUNCATED", () => {
    // We read part of a large site. A kind absent from the part we read may sit
    // in the part we did not — the same confusion, one level up.
    const c = analyseContentCoverage({
      fetched: true, truncated: true,
      urls: ["https://x.com/a", "https://x.com/b"],
    });
    expect(c.fetched).toBe(true);
    expect(c.usable).toBe(false);
    expect(c.missing).toEqual([]);
  });

  it("counts nothing at all when the sitemap was never read", () => {
    const c = analyseContentCoverage({ fetched: false, urls: ["https://x.com/vs/y"] });
    expect(c.urlsSeen).toBe(0);
    expect(c.counts.comparison).toBe(0);
    expect(c.present).toEqual([]);
  });

  it("handles being called with nothing", () => {
    const c = analyseContentCoverage();
    expect(c.usable).toBe(false);
    expect(c.missing).toEqual([]);
  });
});

describe("a sitemap we actually read", () => {
  const read = (urls) => analyseContentCoverage({ fetched: true, truncated: false, urls });

  it("names the kinds that matched nothing", () => {
    const c = read([
      "https://x.com/", "https://x.com/pricing", "https://x.com/about",
      "https://x.com/vs/clay",
    ]);
    expect(c.usable).toBe(true);
    expect(c.present).toContain("comparison");
    expect(c.missing).toEqual(expect.arrayContaining(["use_case", "industry", "category"]));
    expect(c.missing).not.toContain("comparison");
  });

  it("finds nothing missing on a site that publishes all four", () => {
    const c = read([
      "https://x.com/vs/clay", "https://x.com/use-cases/sales",
      "https://x.com/industries/legal", "https://x.com/category/tools",
    ]);
    expect(c.missing).toEqual([]);
    expect(c.present).toHaveLength(4);
  });

  it("keeps example matches so a reader can check our working", () => {
    const c = read(["https://x.com/vs/clay", "https://x.com/vs/apify"]);
    expect(c.matches.comparison).toHaveLength(2);
    expect(c.counts.comparison).toBe(2);
  });
});

describe("describeAbsence", () => {
  it("states what we MATCHED, never what the site HAS", () => {
    // "Your site has no comparison page" is a claim we cannot support from url
    // shapes. "No url matches a comparison pattern" is exactly what we measured.
    const c = analyseContentCoverage({ fetched: true, truncated: false, urls: ["https://x.com/a", "https://x.com/b"] });
    const sentence = describeAbsence("comparison", c);
    expect(sentence).toMatch(/None of the 2 urls/);
    expect(sentence).toMatch(/matches a comparison pattern/i);
    expect(sentence).not.toMatch(/your site has no/i);
  });

  it("says how many shapes were checked, so a miss is explicable", () => {
    const c = analyseContentCoverage({ fetched: true, truncated: false, urls: [] });
    expect(describeAbsence("comparison", c)).toMatch(/shapes checked/);
  });

  it("returns null for an unknown kind", () => {
    expect(describeAbsence("invented", {})).toBeNull();
  });
});
