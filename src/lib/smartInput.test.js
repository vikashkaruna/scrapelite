// src/lib/smartInput.test.js — Q1 (smart multi-input Home) classifier tests.

import { describe, expect, it } from "vitest";
import { classifyInput, looksLikeCsv } from "./utils.js";

describe("Q1 — classifyInput: smart auto-detect", () => {
  it("classifies empty input as 'empty'", () => {
    expect(classifyInput("")).toMatchObject({ kind: "empty", urls: [] });
    expect(classifyInput("   \n  ")).toMatchObject({ kind: "empty", urls: [] });
  });

  it("classifies a single URL as 'single'", () => {
    const r = classifyInput("https://stripe.com/pricing");
    expect(r.kind).toBe("single");
    expect(r.urls).toEqual(["https://stripe.com/pricing"]);
  });

  it("classifies a bare domain as a single URL", () => {
    const r = classifyInput("stripe.com");
    expect(r.kind).toBe("single");
    expect(r.urls[0]).toMatch(/^https:\/\/stripe\.com/);
  });

  it("classifies multiple URLs (newline-separated) as 'multi'", () => {
    const r = classifyInput(
      "https://stripe.com/pricing\nhttps://linear.app/pricing\nhttps://notion.so/pricing",
    );
    expect(r.kind).toBe("multi");
    expect(r.urls).toHaveLength(3);
  });

  it("classifies multiple URLs (comma-separated) as 'multi'", () => {
    const r = classifyInput(
      "https://a.com, https://b.com, https://c.com",
    );
    expect(r.kind).toBe("multi");
    expect(r.urls).toHaveLength(3);
  });

  it("classifies a CSV header + data rows as 'csv'", () => {
    const csv = "name,url,description\nFoo,https://foo.com,Hello\nBar,https://bar.com,World";
    const r = classifyInput(csv);
    expect(r.kind).toBe("csv");
    expect(r.urls).toEqual(["https://foo.com", "https://bar.com"]);
  });

  it("treats raw text / HTML as 'text'", () => {
    const r = classifyInput("This is a paragraph of plain text with no URLs.");
    expect(r.kind).toBe("text");
  });

  it("treats HTML fragments as 'text'", () => {
    const r = classifyInput(
      "<div><h1>Title</h1><p>Some <em>rich</em> content here</p></div>",
    );
    expect(r.kind).toBe("text");
  });

  it("preserves the full URL list in every kind that surfaces URLs", () => {
    const r1 = classifyInput("https://a.com\nhttps://b.com");
    expect(r1.urls.length).toBe(2);
    const r2 = classifyInput("name,url\nFoo,https://a.com\nBar,https://b.com");
    expect(r2.urls.length).toBe(2);
  });
});

describe("Q1 — looksLikeCsv: pure CSV detection", () => {
  it("returns true for a multi-line header + record input", () => {
    expect(looksLikeCsv("name,url,description\nFoo,https://foo.com,Hi")).toBe(true);
  });

  it("returns false for single-line input (no newline)", () => {
    expect(looksLikeCsv("name,url,description")).toBe(false);
  });

  it("returns false when header has only one column", () => {
    expect(looksLikeCsv("name\nFoo")).toBe(false);
  });

  it("returns false when the first line is itself a URL", () => {
    // looksLikeUrl matches a single token. A line with multiple comma-separated
    // values is treated as CSV-shaped (could be a misformatted URL list), so
    // we only short-circuit when the first line is a single URL token.
    expect(looksLikeCsv("https://foo.com\nhttps://bar.com")).toBe(false);
  });

  it("returns false when the second line is itself a single URL", () => {
    expect(looksLikeCsv("name,url\nhttps://foo.com")).toBe(false);
  });

  it("returns true even when no 'url' column header is present", () => {
    expect(looksLikeCsv("name,website,description\nFoo,foo.com,Hi")).toBe(true);
  });
});

// ── "embedded": prose that CONTAINS links ───────────────────────────────────
//
// classifyInput's "multi" branch requires valid.length >= tokenCount - 1, i.e.
// nearly every whitespace token must itself be a URL. So an email, a Slack
// thread or a markdown list carrying eight links failed that test, fell through
// to "text", and the whole blob was extracted as ONE pasted document — while
// `urls` already held the eight links nothing on the text path ever read.
//
// "embedded" names that case. It is deliberately NOT auto-routed to batch: a
// newsletter with ten links is genuinely ambiguous (extract the ten pages, or
// summarise the newsletter?), so the composer asks.

describe("classifyInput — embedded links in prose", () => {
  const prose = "Hi team, take a look at https://stripe.com/pricing and also " +
                "https://linear.app/pricing before Friday. Thanks!";

  it("classifies prose carrying 2+ links as 'embedded', not 'text'", () => {
    const c = classifyInput(prose);
    expect(c.kind).toBe("embedded");
    expect(c.urls).toEqual(["https://stripe.com/pricing", "https://linear.app/pricing"]);
  });

  it("still classifies a clean list of the same URLs as 'multi'", () => {
    const c = classifyInput("https://stripe.com/pricing\nhttps://linear.app/pricing");
    expect(c.kind).toBe("multi");
  });

  it("leaves prose with a single link as plain text — one link is a citation", () => {
    expect(classifyInput("As discussed, see https://stripe.com/pricing for the tiers we compared.").kind).toBe("text");
  });

  it("leaves link-free prose as text", () => {
    expect(classifyInput("hello world, this is just a sentence with no links at all").kind).toBe("text");
  });

  it("reports density so callers can tell a link list from prose", () => {
    expect(classifyInput(prose).density).toBeLessThan(0.5);
    expect(classifyInput("https://a.com\nhttps://b.com").density).toBe(1);
  });

  it("leaves HTML on the text path, where its links are parsed properly", () => {
    // Deliberate. Whitespace tokenising can't see a URL wrapped in markup
    // (`<a href="x">https://a.com/one</a>` is one unparseable token), but the
    // text path already handles HTML far better: buildStructureFromText runs it
    // through parseHtml, producing real headings and real links. Routing HTML
    // to "embedded" would trade a good parser for a worse one.
    const html = '<p>See <a href="x">https://a.com/one</a> and https://b.com/two here.</p>';
    expect(classifyInput(html).kind).toBe("text");
  });

  it("treats bare URLs in a markdown-ish list as embedded", () => {
    const md = "Competitors to check:\n- https://a.com/pricing\n- https://b.com/pricing\n- https://c.com/pricing";
    const c = classifyInput(md);
    expect(c.kind).toBe("embedded");
    expect(c.urls).toHaveLength(3);
  });

  it("strips sentence punctuation off a URL lifted from prose", () => {
    // "…and Figma at https://figma.com/pricing." must not extract a URL with a
    // trailing full stop — that scrapes the wrong address.
    const c = classifyInput("Notion at https://notion.so/pricing, and Figma at https://figma.com/pricing.");
    expect(c.urls).toEqual(["https://notion.so/pricing", "https://figma.com/pricing"]);
  });

  it("keeps a legitimate trailing slash", () => {
    const c = classifyInput("Try https://a.com/docs/ and https://b.com/api/ today.");
    expect(c.urls).toEqual(["https://a.com/docs/", "https://b.com/api/"]);
  });

  it("keeps a balanced closing paren but drops an unbalanced one", () => {
    const c = classifyInput("See https://en.wikipedia.org/wiki/Foo_(bar) and (https://b.com) too.");
    expect(c.urls).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)", "https://b.com"]);
  });
});
