// netlify/__tests__/audit/extraction-inventory.test.js
//
// The two collection requirements in BRD §7.2 the engine did not meet:
//
//   "Canonical URL, robots meta, robots.txt, SITEMAP INDICATOR."
//   "JSON-LD/MICRODATA schema inventory."
//
// Sitemap declarations were never read at all. Microdata TYPES were extracted
// (and merged into schemaTypes) but never inventoried, so "you have Product
// markup" could not be told apart from "you have forty Product blocks, none of
// which names a price" — and those call for opposite advice.

import { describe, it, expect } from "vitest";
import { extractSitemapDeclarations, MAX_SITEMAP_DECLARATIONS }
  from "../../functions/lib/audit/fetchLayer.js";
import { extractMicrodataInventory } from "../../functions/lib/audit/htmlParse.js";

describe("extractSitemapDeclarations", () => {
  it("reads a Sitemap directive out of robots.txt", () => {
    expect(extractSitemapDeclarations(
      "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n",
    )).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("reads it regardless of case and spacing", () => {
    // `Sitemap:` is a non-group directive and implementations vary wildly in
    // how they space and case it; being strict here would report a sitemap as
    // absent on sites that plainly declare one.
    expect(extractSitemapDeclarations("SITEMAP:https://e.com/a.xml")).toEqual(["https://e.com/a.xml"]);
    expect(extractSitemapDeclarations("  sitemap:  https://e.com/b.xml  ")).toEqual(["https://e.com/b.xml"]);
    // Deliberately lenient about a space before the colon. It is not what
    // RFC 9309 writes, and rejecting it would mean reporting "no sitemap
    // declared" for a host that plainly declares one — a false finding about
    // the customer's own file, which is the costlier error here.
    expect(extractSitemapDeclarations("  sitemap :  https://e.com/b.xml  "))
      .toEqual(["https://e.com/b.xml"]);
  });

  it("collects several, because an index plus per-section maps is normal", () => {
    expect(extractSitemapDeclarations([
      "Sitemap: https://e.com/sitemap-index.xml",
      "User-agent: Googlebot",
      "Sitemap: https://e.com/sitemap-products.xml",
    ].join("\n"))).toEqual([
      "https://e.com/sitemap-index.xml",
      "https://e.com/sitemap-products.xml",
    ]);
  });

  it("reads the directive globally, not per user-agent block", () => {
    // Sitemap belongs to the FILE, not to any group. Scoping it to the block it
    // happens to sit under would miss it on most real robots.txt files.
    const robots = "User-agent: Googlebot\nDisallow:\nSitemap: https://e.com/s.xml";
    expect(extractSitemapDeclarations(robots)).toEqual(["https://e.com/s.xml"]);
  });

  it("de-duplicates a repeated declaration", () => {
    expect(extractSitemapDeclarations("Sitemap: https://e.com/s.xml\nSitemap: https://e.com/s.xml"))
      .toEqual(["https://e.com/s.xml"]);
  });

  it("refuses anything that is not an absolute http(s) URL", () => {
    // robots.txt is attacker-controllable text. Recording a relative or
    // javascript: value as a sitemap would put a bad URL in front of a customer
    // as though we had verified it.
    expect(extractSitemapDeclarations("Sitemap: /sitemap.xml")).toEqual([]);
    expect(extractSitemapDeclarations("Sitemap: javascript:alert(1)")).toEqual([]);
    expect(extractSitemapDeclarations("Sitemap: ftp://e.com/s.xml")).toEqual([]);
  });

  it("caps the list, because it rides along on every audit for that host", () => {
    const many = Array.from({ length: MAX_SITEMAP_DECLARATIONS + 25 },
      (_, i) => `Sitemap: https://e.com/s${i}.xml`).join("\n");
    expect(extractSitemapDeclarations(many)).toHaveLength(MAX_SITEMAP_DECLARATIONS);
  });

  it("returns an empty list for a missing or empty robots.txt", () => {
    // A missing robots.txt is permissive and declares no sitemap. It must read
    // as "none declared", never as an error.
    expect(extractSitemapDeclarations(null)).toEqual([]);
    expect(extractSitemapDeclarations(undefined)).toEqual([]);
    expect(extractSitemapDeclarations("")).toEqual([]);
    expect(extractSitemapDeclarations("User-agent: *\nDisallow:")).toEqual([]);
  });
});

describe("extractMicrodataInventory", () => {
  it("counts items per type, not just which types exist", () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">A</span></div>
      <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">B</span></div>
      <div itemscope itemtype="https://schema.org/Organization"></div>`;
    const inv = extractMicrodataInventory(html);
    expect(inv.find((i) => i.type === "Product").count).toBe(2);
    expect(inv.find((i) => i.type === "Organization").count).toBe(1);
  });

  it("lists the properties present, which is what makes it an inventory", () => {
    const html = `<div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">A</span><span itemprop="price">9</span></div>`;
    const [product] = extractMicrodataInventory(html);
    expect(product.properties).toContain("name");
    expect(product.properties).toContain("price");
  });

  it("splits a multi-valued itemprop", () => {
    const html = `<div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name alternateName">A</span></div>`;
    const [product] = extractMicrodataInventory(html);
    expect(product.properties).toEqual(expect.arrayContaining(["name", "alternateName"]));
  });

  it("orders by count, so the dominant type reads first", () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Thing"></div>
      <div itemscope itemtype="https://schema.org/Product"></div>
      <div itemscope itemtype="https://schema.org/Product"></div>`;
    expect(extractMicrodataInventory(html)[0].type).toBe("Product");
  });

  it("returns an empty inventory for a page with no microdata", () => {
    expect(extractMicrodataInventory("<p>Nothing here</p>")).toEqual([]);
    expect(extractMicrodataInventory("")).toEqual([]);
    // JSON-LD is a different mechanism and must not leak into this inventory.
    expect(extractMicrodataInventory(
      `<script type="application/ld+json">{"@type":"Product"}</script>`,
    )).toEqual([]);
  });

  it("does not run away on a hostile document", () => {
    // Same guard the rest of htmlParse.js uses: a regex sweep over
    // attacker-supplied HTML inside an 8s audit budget needs a ceiling.
    const html = "<div itemscope itemtype='https://schema.org/Thing'></div>".repeat(5000);
    const inv = extractMicrodataInventory(html);
    expect(inv.length).toBeLessThanOrEqual(40);
    expect(inv[0].count).toBeLessThanOrEqual(500);
  });
});
