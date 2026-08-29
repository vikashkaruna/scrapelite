// src/lib/discoverability/auditReport.branding.test.js — the discoverability
// report's markdown/CSV/JSON now carry the shared DatIQ header/footer (see
// exportBranding.js), same as extraction exports.

import { describe, expect, it } from "vitest";
import { buildMarkdownReport, brandCsv, toJsonPayload, scoresToCsv, signalsToCsv } from "./auditReport.js";

const AUDIT = {
  target: { url: "https://lumio.io", audit_profile: "balanced", device_profile: "mobile" },
  meta: { startedAt: "2026-08-28T10:00:00.000Z" },
  finalScore: 78, seoScore: 80, aeoScore: 75, geoScore: 76, coverage: 92,
  pillars: {}, issues: [], recommendations: [],
};

describe("auditReport — Markdown branding", () => {
  it("titles the report with the brand and includes a 'Prepared by' row", () => {
    const md = buildMarkdownReport(AUDIT);
    expect(md).toMatch(/^# DatIQ Discoverability Audit/);
    expect(md).toContain("| Prepared by | DatIQ (https://datiq.app) |");
  });

  it("footer carries the shared attribution AND the discoverability-specific disclaimer", () => {
    const md = buildMarkdownReport(AUDIT);
    expect(md).toContain("Exported via DatIQ — https://datiq.app");
    expect(md).toContain("not a prediction of rankings, citations or traffic");
  });

  it("a Brand Kit changes the title and the 'Prepared by' row", () => {
    const md = buildMarkdownReport(AUDIT, { brandKit: { companyName: "Acme Research Co." } });
    expect(md).toMatch(/^# Acme Research Co\. Discoverability Audit/);
    expect(md).toContain("Powered by DatIQ — https://datiq.app"); // standardization rule
  });
});

describe("auditReport — brandCsv", () => {
  it("wraps a CSV section with leading/trailing '#' rows, without touching the real header row", () => {
    const csv = brandCsv(scoresToCsv(AUDIT), AUDIT);
    const lines = csv.split("\n");
    expect(lines[0].startsWith("#")).toBe(true);
    expect(csv).toContain("view,kind,score,coverage_pct,weight_pct");
    expect(lines[lines.length - 1].startsWith("#")).toBe(true);
  });

  it("does not disturb the underlying data rows of a section builder used standalone", () => {
    // signalsToCsv itself must stay unbranded — this is what the composable,
    // pure-builder contract (and existing signalsToCsv tests) depend on.
    const raw = signalsToCsv(AUDIT);
    expect(raw.split("\n")[0]).toContain("signal_code");
    expect(raw.startsWith("#")).toBe(false);
  });
});

describe("auditReport — JSON branding", () => {
  it("adds an additive 'export' metadata block without touching existing public keys", () => {
    const payload = toJsonPayload(AUDIT);
    expect(payload.export).toEqual({
      tool: "DatIQ",
      kind: "discoverability",
      generatedAt: "2026-08-28T10:00:00.000Z",
      source: ["https://lumio.io"],
      preparedBy: "DatIQ",
      poweredBy: "https://datiq.app",
    });
    expect(payload.framework_scores.overall).toBe(78);
  });
});
