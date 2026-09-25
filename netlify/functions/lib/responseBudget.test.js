import { describe, it, expect } from "vitest";
import { fitResponseBudget, MAX_RESPONSE_BYTES } from "./responseBudget.js";

const size = (b) => Buffer.byteLength(JSON.stringify(b), "utf8");

describe("fitResponseBudget", () => {
  it("returns a small body untouched", () => {
    const body = { data: { html: "<p>hi</p>", text: "hi" }, source: "x" };
    expect(fitResponseBudget(body)).toBe(body);
  });

  it("trims html under the Lambda cap (html.spec.whatwg.org is ~12 MB)", () => {
    const body = { data: { html: "<p>" + "a".repeat(12_000_000), text: "t" }, source: "firecrawl" };
    const out = fitResponseBudget(body);
    expect(size(out)).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(out.data.htmlTruncated).toBe(true);
    expect(out.data.htmlOriginalChars).toBe(body.data.html.length);
    expect(out.data.text).toBe("t");
    expect(body.data.htmlTruncated).toBeUndefined(); // input not mutated
  });

  it("fits multi-byte and escape-heavy html", () => {
    const body = { data: { html: '€"\\'.repeat(3_000_000) } };
    expect(size(fitResponseBudget(body))).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });
});
