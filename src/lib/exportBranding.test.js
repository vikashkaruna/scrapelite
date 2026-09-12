// src/lib/exportBranding.test.js — the shared header/footer model used by
// every export format (PDF/Markdown/CSV/JSON) and report emails.

import { describe, expect, it } from "vitest";
import {
  buildBrandingContext,
  brandingMarkdownHeader,
  brandingMarkdownFooter,
  brandingCsvHeaderRows,
  brandingCsvFooterRows,
  brandingJsonMeta,
  brandingEmailHtml,
  brandingEmailText,
  BRAND,
  SITE_URL,
} from "./exportBranding.js";

const GENERATED_AT = "2026-08-28T14:32:00.000Z";

describe("exportBranding — buildBrandingContext (default, no Brand Kit)", () => {
  it("defaults to the DatIQ brand and the kind's title", () => {
    const ctx = buildBrandingContext({ kind: "extraction", sourceUrls: "https://lumio.io", generatedAt: GENERATED_AT });
    expect(ctx.brand).toBe(BRAND);
    expect(ctx.title).toBe("Extraction Report");
    expect(ctx.source).toEqual(["https://lumio.io"]);
    expect(ctx.generatedAtISO).toBe(GENERATED_AT);
    expect(ctx.generatedLabel).toBe("28 Aug 2026, 14:32 UTC");
  });

  it("normalizes a single source string and an array identically", () => {
    const a = buildBrandingContext({ sourceUrls: "https://x.com", generatedAt: GENERATED_AT });
    const b = buildBrandingContext({ sourceUrls: ["https://x.com"], generatedAt: GENERATED_AT });
    expect(a.source).toEqual(b.source);
  });

  it("poweredByLine is ALWAYS present, even with no Brand Kit", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT });
    expect(ctx.poweredByLine).toBe(`Powered by ${BRAND} — ${SITE_URL}`);
  });

  it("titles the discoverability kind correctly", () => {
    const ctx = buildBrandingContext({ kind: "discoverability", generatedAt: GENERATED_AT });
    expect(ctx.title).toBe("Discoverability Audit");
  });

  it("an explicit title overrides the kind default", () => {
    const ctx = buildBrandingContext({ kind: "batch", title: "Custom Title", generatedAt: GENERATED_AT });
    expect(ctx.title).toBe("Custom Title");
  });
});

describe("exportBranding — buildBrandingContext (with a Brand Kit)", () => {
  const brandKit = {
    companyName: "Acme Research Co.",
    tagline: "Market Intelligence, Delivered.",
    accentColor: "#0f766e",
    footerText: "Confidential — prepared exclusively for Acme Research clients.",
    website: "https://acmeresearch.example.com",
    logo: { dataUrl: "data:image/png;base64,AAAA", width: 120, height: 40 },
  };

  it("uses the Brand Kit's company name, tagline, accent color, and footer text", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT, brandKit });
    expect(ctx.brand).toBe("Acme Research Co.");
    expect(ctx.tagline).toBe("Market Intelligence, Delivered.");
    expect(ctx.accentColor).toBe("#0f766e");
    expect(ctx.footerText).toBe(brandKit.footerText);
    expect(ctx.logoUrl).toBe(brandKit.logo.dataUrl);
    expect(ctx.logoIsCustom).toBe(true);
  });

  it("STILL sets poweredByLine to plain DatIQ — no Brand Kit field can suppress it", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT, brandKit });
    expect(ctx.poweredByLine).toBe(`Powered by ${BRAND} — ${SITE_URL}`);
    // Confirm there's genuinely no escape hatch in the schema.
    expect(buildBrandingContext({ generatedAt: GENERATED_AT, brandKit: { ...brandKit, poweredByLine: null } }).poweredByLine)
      .toBe(`Powered by ${BRAND} — ${SITE_URL}`);
  });

  it("falls back to the DatIQ tagline when a Brand Kit sets a company name but no tagline", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT, brandKit: { companyName: "Acme" } });
    // A blank tagline field under a custom brand should stay blank, not
    // silently inherit DatIQ's own tagline as if it were Acme's.
    expect(ctx.tagline).toBe("");
  });

  it("blank Brand Kit fields fall back to the DatIQ defaults", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT, brandKit: {} });
    expect(ctx.brand).toBe(BRAND);
    expect(ctx.tagline).toBe("Intelligence, Connected.");
    expect(ctx.accentColor).toBe("#4f46e5");
  });
});

describe("exportBranding — Markdown", () => {
  it("renders the header with brand, title, source, and generated line", () => {
    const ctx = buildBrandingContext({ sourceUrls: "https://lumio.io", generatedAt: GENERATED_AT });
    const header = brandingMarkdownHeader(ctx);
    expect(header).toContain("# DatIQ Extraction Report");
    expect(header).toContain("**Source:** https://lumio.io");
    expect(header).toContain("**Generated:** 28 Aug 2026, 14:32 UTC — by DatIQ (https://datiq.app)");
  });

  it("pluralizes 'Sources' for more than one URL", () => {
    const ctx = buildBrandingContext({ sourceUrls: ["https://a.com", "https://b.com"], generatedAt: GENERATED_AT });
    expect(brandingMarkdownHeader(ctx)).toContain("**Sources:** https://a.com, https://b.com");
  });

  it("footer always includes the DatIQ attribution line", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT });
    const footer = brandingMarkdownFooter(ctx);
    expect(footer).toContain("*Exported via DatIQ — https://datiq.app · Intelligence, Connected.*");
  });

  it("appends extra (format-specific) disclaimers after the shared attribution", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT });
    const footer = brandingMarkdownFooter(ctx, ["Scores are not a prediction of rankings or traffic."]);
    expect(footer).toContain("*Scores are not a prediction of rankings or traffic.*");
    expect(footer.indexOf("Exported via DatIQ")).toBeLessThan(footer.indexOf("Scores are not a prediction"));
  });

  it("a Brand Kit's footerText and the poweredByLine both appear", () => {
    const ctx = buildBrandingContext({
      generatedAt: GENERATED_AT,
      brandKit: { companyName: "Acme", footerText: "Confidential." },
    });
    const footer = brandingMarkdownFooter(ctx);
    expect(footer).toContain("*Confidential.*");
    expect(footer).toContain("*Powered by DatIQ — https://datiq.app*");
  });
});

describe("exportBranding — CSV", () => {
  it("header rows are all '#'-prefixed", () => {
    const ctx = buildBrandingContext({ sourceUrls: "https://lumio.io", generatedAt: GENERATED_AT });
    const rows = brandingCsvHeaderRows(ctx);
    expect(rows.every((r) => r.startsWith("#"))).toBe(true);
    expect(rows[0]).toBe("# DatIQ Export — Extraction Report");
    expect(rows).toContain("# Source: https://lumio.io");
    expect(rows).toContain(`# Generated: ${GENERATED_AT}`);
  });

  it("footer rows are all '#'-prefixed and carry the attribution", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT });
    const rows = brandingCsvFooterRows(ctx);
    expect(rows.every((r) => r.startsWith("#"))).toBe(true);
    expect(rows.some((r) => r.includes("Exported via DatIQ — https://datiq.app"))).toBe(true);
  });

  it("a Brand Kit's footerText replaces the generic attribution line but keeps poweredByLine", () => {
    const ctx = buildBrandingContext({ generatedAt: GENERATED_AT, brandKit: { companyName: "Acme", footerText: "Confidential." } });
    const rows = brandingCsvFooterRows(ctx);
    expect(rows.some((r) => r.includes("Confidential.") && r.includes("Powered by DatIQ"))).toBe(true);
  });
});

describe("exportBranding — JSON", () => {
  it("produces a metadata object with tool/kind/source/preparedBy/poweredBy", () => {
    const ctx = buildBrandingContext({ kind: "batch", sourceUrls: ["https://a.com"], generatedAt: GENERATED_AT });
    const meta = brandingJsonMeta(ctx);
    expect(meta).toEqual({
      tool: "DatIQ",
      kind: "batch",
      generatedAt: GENERATED_AT,
      source: ["https://a.com"],
      preparedBy: "DatIQ",
      poweredBy: "https://datiq.app",
    });
  });

  it("includes preparedFor only when accountLabel is set", () => {
    const withLabel = buildBrandingContext({ generatedAt: GENERATED_AT, accountLabel: "alice@example.com · Pro plan" });
    expect(brandingJsonMeta(withLabel).preparedFor).toBe("alice@example.com · Pro plan");
    const withoutLabel = buildBrandingContext({ generatedAt: GENERATED_AT });
    expect(brandingJsonMeta(withoutLabel).preparedFor).toBeUndefined();
  });
});

describe("exportBranding — Email", () => {
  it("HTML includes the brand, heading, source, and a working attachment/CTA slot", () => {
    const ctx = buildBrandingContext({ sourceUrls: "https://lumio.io", generatedAt: GENERATED_AT });
    const html = brandingEmailHtml(ctx, {
      heading: "Your extraction report is ready",
      attachmentLabel: "lumio-io-extraction.pdf",
      ctaUrl: "https://datiq.app/dashboard",
    });
    expect(html).toContain("Your extraction report is ready");
    expect(html).toContain("https://lumio.io");
    expect(html).toContain("lumio-io-extraction.pdf");
    expect(html).toContain("View in DatIQ");
    expect(html).toContain("https://datiq.app/dashboard");
    expect(html).toContain(ctx.logoUrl);
  });

  it("HTML escapes untrusted-looking source/heading text", () => {
    const ctx = buildBrandingContext({ sourceUrls: '<img src=x onerror=alert(1)>', generatedAt: GENERATED_AT });
    const html = brandingEmailHtml(ctx, { heading: "<script>bad</script>" });
    expect(html).not.toContain("<script>bad</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("text version carries the same facts without HTML", () => {
    const ctx = buildBrandingContext({ sourceUrls: "https://lumio.io", generatedAt: GENERATED_AT });
    const text = brandingEmailText(ctx, { heading: "Your extraction report is ready", attachmentLabel: "x.pdf" });
    expect(text).toContain("Your extraction report is ready");
    expect(text).toContain("Source: https://lumio.io");
    expect(text).toContain("(attached: x.pdf)");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("a Brand Kit's accent color and custom logo flow into the HTML", () => {
    const ctx = buildBrandingContext({
      generatedAt: GENERATED_AT,
      brandKit: { companyName: "Acme", accentColor: "#0f766e", logo: { dataUrl: "data:image/png;base64,AAAA" } },
    });
    const html = brandingEmailHtml(ctx, { heading: "Ready" });
    expect(html).toContain("#0f766e");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("Powered by DatIQ"); // still present, per the standardization rule
  });
});
