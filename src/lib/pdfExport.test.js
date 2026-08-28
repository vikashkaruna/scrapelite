// src/lib/pdfExport.test.js — extraction PDF export now carries the shared
// DatIQ header/footer branding (see exportBranding.js) and can render bytes
// server-side (extractionsPdfBuffer) for an email attachment, not just a
// browser download.

import { describe, expect, it } from "vitest";
import { buildExtractionsPdf, extractionsPdfBuffer, extractionsPdfFilename } from "./pdfExport.js";

const EXTRACTION = {
  id: "ext_1",
  url: "https://lumio.io",
  page_title: "Lumio — Product analytics",
  ai_summary: "Lumio is a product analytics platform.",
  created_at: "2026-08-28T10:00:00.000Z",
  headings: [{ tag: "H1", text: "Product analytics that make sense" }],
  links: [{ text: "Pricing", href: "https://lumio.io/pricing" }],
};

describe("pdfExport — branded header/footer", () => {
  it("builds a jsPDF document without throwing, for a single extraction", () => {
    const doc = buildExtractionsPdf(EXTRACTION, { generatedAt: "2026-08-28T14:32:00.000Z" });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("builds a jsPDF document for a multi-extraction (batch) export", () => {
    const doc = buildExtractionsPdf([EXTRACTION, { ...EXTRACTION, id: "ext_2", url: "https://stripe.com" }], {
      generatedAt: "2026-08-28T14:32:00.000Z",
    });
    // Each item after the first starts its own page.
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("extractionsPdfBuffer returns real, non-empty bytes (the server/email path)", () => {
    const buf = extractionsPdfBuffer(EXTRACTION, { generatedAt: "2026-08-28T14:32:00.000Z" });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(500);
    // A real PDF starts with the %PDF signature.
    const head = new Uint8Array(buf.slice(0, 4));
    expect(String.fromCharCode(...head)).toBe("%PDF");
  });

  it("a Brand Kit changes the rendered brand without throwing", () => {
    const doc = buildExtractionsPdf(EXTRACTION, {
      generatedAt: "2026-08-28T14:32:00.000Z",
      brandKit: { companyName: "Acme Research Co.", accentColor: "#0f766e" },
    });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("filename convention is unchanged for single vs multi-item exports", () => {
    expect(extractionsPdfFilename(EXTRACTION)).toBe("datiq-lumio.io-ext_1.pdf");
    expect(extractionsPdfFilename([EXTRACTION, EXTRACTION])).toBe("datiq-export-2-pages.pdf");
  });
});
