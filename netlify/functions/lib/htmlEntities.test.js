// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./htmlEntities.js";
import { decodeEntities as auditDecode } from "./audit/htmlParse.js";
import { decodeEntities as pageDecode } from "./pageContent.js";

describe("decodeHtmlEntities — one pass, never twice (CodeQL js/double-escaping)", () => {
  it("decodes the common named and numeric entities", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &nbsp;f")).toBe(`a & b <c> "d" 'e'  f`.replace(" ", " "));
  });

  it("never decodes the result of a decode", () => {
    expect(decodeHtmlEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    expect(decodeHtmlEntities("&#38;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&#x26;amp;")).toBe("&amp;");
  });

  it("keeps an unknown entity by default and drops an invalid code point", () => {
    expect(decodeHtmlEntities("&zzz; &#0; &#x110000;")).toBe("&zzz;  ");
  });

  it("the audit and page-content decoders use it", () => {
    expect(auditDecode("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(pageDecode("&#38;lt;b&#38;gt;")).toBe("&lt;b&gt;");
  });
});
