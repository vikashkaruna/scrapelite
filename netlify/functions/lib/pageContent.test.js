// pageContent.test.js — the structure-preserving content extractor.
//
// The old implementation was `html.replace(/<[^>]+>/g," ")`. Fine for a word
// count, useless for extraction: a pricing table became "Pro $29 10 seats
// Business $79 50" with the row/column relationship — the part that says WHICH
// price belongs to WHICH plan — destroyed. These tests pin the structure that
// makes schema-guided extraction possible.
import { describe, it, expect } from "vitest";
import { extractPageContent, htmlToPlainText, decodeEntities } from "./pageContent.js";

const wrap = (body) => `<html><head><title>T</title></head><body>${body}</body></html>`;

describe("extractPageContent — structure survives", () => {
  it("keeps a table's rows and columns together", () => {
    const { text } = extractPageContent(wrap(`<main>
      <h2>Plans</h2>
      <table>
        <tr><th>Plan</th><th>Price</th><th>Seats</th></tr>
        <tr><td>Pro</td><td>$29</td><td>10</td></tr>
        <tr><td>Business</td><td>$79</td><td>50</td></tr>
      </table>
      <p>${"Padding so the main region clears the isolation floor. ".repeat(15)}</p>
    </main>`));
    expect(text).toContain("## Plans");
    expect(text).toContain("| Pro | $29 | 10 |");
    expect(text).toContain("| Business | $79 | 50 |");
    // The flattening that lost the relationship must NOT be what we produce.
    expect(text).not.toMatch(/Pro \$29 10 Business/);
  });

  it("keeps list items as list items", () => {
    const { text } = extractPageContent(wrap(`<div><ul><li>SSO</li><li>Audit log</li></ul></div>`));
    expect(text).toContain("- SSO");
    expect(text).toContain("- Audit log");
  });

  it("surfaces mailto and tel targets beside their label", () => {
    // The single highest-yield signal for the contacts capability, and
    // tag-stripping erased it entirely.
    const { text } = extractPageContent(wrap(
      `<p>Reach <a href="mailto:sales@acme.com?subject=hi">our sales team</a> or ` +
      `<a href="tel:+14155551234">call us</a>.</p>`));
    expect(text).toContain("sales@acme.com");
    expect(text).toContain("+14155551234");
    expect(text).toContain("our sales team");
  });

  it("keeps social profile URLs beside their anchor text", () => {
    const { text } = extractPageContent(wrap(
      `<p><a href="https://www.linkedin.com/company/acme">LinkedIn</a></p>`));
    expect(text).toContain("https://www.linkedin.com/company/acme");
  });

  it("preserves heading levels as markdown", () => {
    const { text } = extractPageContent(wrap(`<h1>A</h1><h3>B</h3>`));
    expect(text).toContain("# A");
    expect(text).toContain("### B");
  });
});

describe("extractPageContent — noise removal", () => {
  it("drops scripts, styles and comments", () => {
    const { text } = extractPageContent(wrap(
      `<script>var secret=1;</script><style>.x{color:red}</style><!-- hidden --><p>Real content here.</p>`));
    expect(text).toContain("Real content here.");
    expect(text).not.toMatch(/secret|color:red|hidden/);
  });

  it("prefers <main> when it carries real bulk", () => {
    const body = `<nav>Home About Pricing Contact</nav><main><p>${"Substantive body copy. ".repeat(40)}</p></main><footer>© Acme</footer>`;
    const r = extractPageContent(wrap(body));
    expect(r.isolated).toBe(true);
    expect(r.mode).toBe("main");
    expect(r.text).not.toContain("© Acme");
  });

  it("does NOT strip chrome when doing so would leave nothing", () => {
    // A thin SPA shell where the nav IS most of the text. Stripping it would
    // hand the model an empty page and produce a false "this page has nothing".
    const r = extractPageContent(wrap(`<nav>Products Pricing Docs Blog Careers Contact Login Signup</nav>`));
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text).toMatch(/Pricing/);
  });

  it("falls back to a flat read rather than returning almost nothing", () => {
    // Malformed markup that the structure-aware pass cannot make sense of.
    const r = extractPageContent(`<p>${"Unclosed content that still matters. ".repeat(20)}`);
    expect(r.text.length).toBeGreaterThan(200);
  });
});

describe("extractPageContent — budget + shape", () => {
  it("reports truncation honestly", () => {
    const r = extractPageContent(wrap(`<p>${"x ".repeat(5000)}</p>`), { maxChars: 500 });
    expect(r.text.length).toBe(500);
    expect(r.truncated).toBe(true);
    expect(r.chars).toBeGreaterThan(500);
  });

  it("never throws on junk input", () => {
    for (const v of [null, undefined, 42, "", "<<<>>>"]) {
      expect(() => extractPageContent(v)).not.toThrow();
    }
    expect(extractPageContent(null).mode).toBe("empty");
  });
});

describe("entities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("A&amp;B &#39;q&#39; &#x2014; &nbsp;end")).toBe("A&B 'q' —  end");
  });
  it("htmlToPlainText stays a flat word bag for callers that want one", () => {
    expect(htmlToPlainText("<h1>A</h1><p>B</p>")).toBe("A B");
  });
});
