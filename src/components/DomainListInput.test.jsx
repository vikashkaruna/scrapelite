// The multi-domain box accepts company NAMES, because a RevOps source list is
// almost always names out of a CRM export. The parsing is pure and pinned here;
// the resolution itself is suggested, never auto-applied.
import { describe, expect, it } from "vitest";
import { splitEntries, partitionEntries } from "./DomainListInput.jsx";

describe("splitEntries", () => {
  it("accepts newlines, commas and semicolons — people paste all three", () => {
    expect(splitEntries("a.com\nb.com, c.com; d.com")).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  it("drops blank lines and trims, rather than creating empty entries", () => {
    expect(splitEntries("  a.com  \n\n\n , ,  b.com ")).toEqual(["a.com", "b.com"]);
  });

  it("is empty for empty input, not [''], which would read as one bad entry", () => {
    expect(splitEntries("")).toEqual([]);
    expect(splitEntries(null)).toEqual([]);
  });
});

describe("partitionEntries", () => {
  it("separates domains from company names", () => {
    const r = partitionEntries("stripe.com\nLinear\ngithub.com\nAcme Corp");
    expect(r.domains).toEqual(["stripe.com", "github.com"]);
    expect(r.names).toEqual(["Linear", "Acme Corp"]);
  });

  it("treats a URL as a domain, not a name", () => {
    // People paste straight out of a browser bar.
    const r = partitionEntries("https://stripe.com/pricing");
    expect(r.domains).toEqual(["https://stripe.com/pricing"]);
    expect(r.names).toEqual([]);
  });

  it("treats a dotless token as a NAME, which is the reading that helps", () => {
    // "acme" could be a hostname, but resolving it as a company name produces a
    // suggestion; treating it as a domain produces a failed fetch.
    expect(partitionEntries("acme").names).toEqual(["acme"]);
  });

  it("handles multi-word names with punctuation", () => {
    const r = partitionEntries("Acme Corp\nO'Reilly Media");
    expect(r.names).toEqual(["Acme Corp", "O'Reilly Media"]);
  });

  it("counts every entry, so the UI can report what it is about to send", () => {
    const r = partitionEntries("a.com\nLinear\nb.com");
    expect(r.entries).toHaveLength(3);
    expect(r.domains.length + r.names.length).toBe(3);
  });
});
