// src/lib/discoverability/auditPdf.test.js — the discoverability report PDF
// now carries the shared DatIQ header (was header-less before) and the
// shared footer (was a bare "DatIQ discoverability - {url}" text line), and
// can render bytes server-side for a report email attachment.

import { describe, expect, it } from "vitest";
import { renderAuditPdf, auditPdfBuffer, auditPdfFilename } from "./auditPdf.js";

const AUDIT = {
  target: { url: "https://lumio.io", audit_profile: "balanced", device_profile: "mobile" },
  created_at: "2026-08-28T10:00:00.000Z",
  finalScore: 78.4,
  seoScore: 80,
  aeoScore: 75,
  geoScore: 76,
  coverage: 92,
  pillars: {},
  issues: [],
  recommendations: [],
};

describe("auditPdf — branded header/footer", () => {
  it("renders without throwing and produces at least one page", () => {
    const pdf = renderAuditPdf(AUDIT, { generatedAt: "2026-08-28T14:32:00.000Z" });
    expect(pdf.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("auditPdfBuffer returns real, non-empty PDF bytes (the server/email path)", () => {
    const buf = auditPdfBuffer(AUDIT, { generatedAt: "2026-08-28T14:32:00.000Z" });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(500);
    const head = new Uint8Array(buf.slice(0, 4));
    expect(String.fromCharCode(...head)).toBe("%PDF");
  });

  it("a Brand Kit renders without throwing", () => {
    const pdf = renderAuditPdf(AUDIT, {
      generatedAt: "2026-08-28T14:32:00.000Z",
      brandKit: { companyName: "Acme Research Co." },
    });
    expect(pdf.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("filename convention is unchanged", () => {
    expect(auditPdfFilename(AUDIT)).toBe("discoverability-lumio-io.pdf");
  });
});
