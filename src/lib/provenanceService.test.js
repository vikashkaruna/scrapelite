// src/lib/provenanceService.test.js — Q9 (per-field provenance) unit tests.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  attachProvenance,
  refreshProvenance,
  getProvenanceForField,
  summariseProvenance,
  pickConfidence,
  _resetProvenanceForTests,
} from "./provenanceService.js";

const FIXED_NOW = "2026-07-17T00:00:00.000Z";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const sample = () => ({
  id: "ext_1",
  url: "https://stripe.com/pricing",
  title: "Stripe — Pricing",
  page_title: "Stripe — Pricing",
  ai_summary: "Stripe has 4 pricing tiers.",
  headings: [
    { level: 1, text: "Pricing" },
    { level: 2, text: "Starter" },
  ],
  links: [
    { text: "Sign up", href: "https://stripe.com/signup" },
    { text: "Contact", href: "https://stripe.com/contact" },
  ],
  custom_extraction: {
    plans: [
      { name: "Starter", price: "$0" },
      { name: "Scale",   price: "$custom" },
    ],
  },
  enrichments: {
    leadership: { key: "leadership", label: "Leadership", data: [] },
  },
});

describe("Q9 — attachProvenance: per-field metadata", () => {
  it("attaches _provenance with a field_count and avg_confidence", () => {
    const out = attachProvenance(sample());
    expect(out._provenance).toBeTruthy();
    expect(out._provenance.field_count).toBeGreaterThan(0);
    expect(out._provenance.avg_confidence).toBeGreaterThan(0);
    expect(out._provenance.avg_confidence).toBeLessThanOrEqual(1);
  });

  it("preserves the source URL on every field", () => {
    const out = attachProvenance(sample());
    for (const provs of Object.values(out._provenance.fields)) {
      for (const p of provs) {
        expect(p.source_url).toBe("https://stripe.com/pricing");
      }
    }
  });

  it("uses the FIXED timestamp on every field", () => {
    const out = attachProvenance(sample(), { now: FIXED_NOW });
    for (const provs of Object.values(out._provenance.fields)) {
      for (const p of provs) {
        expect(p.last_checked_at).toBe(FIXED_NOW);
      }
    }
    expect(out._provenance.last_checked_at).toBe(FIXED_NOW);
  });

  it("emits one provenance record per heading", () => {
    const out = attachProvenance(sample());
    expect(out._provenance.fields["Pricing"]).toBeTruthy();
    expect(out._provenance.fields["Pricing"][0].field).toBe("heading");
    expect(out._provenance.fields["Pricing"][0].level).toBe(1);
  });

  it("emits one provenance record per link, including the href", () => {
    const out = attachProvenance(sample());
    const linkProv = out._provenance.fields["Sign up"];
    expect(linkProv).toBeTruthy();
    expect(linkProv[0].field).toBe("link");
    expect(linkProv[0].href).toBe("https://stripe.com/signup");
  });

  it("marks AI-generated fields with retrieval='ai_inferred'", () => {
    const out = attachProvenance(sample());
    const summary = out._provenance.fields["ai_summary"];
    expect(summary[0].retrieval).toBe("ai_inferred");
    expect(summary[0].confidence).toBeLessThan(0.9);
  });

  it("marks scraped fields with retrieval='scraped'", () => {
    const out = attachProvenance(sample());
    const heading = out._provenance.fields["Pricing"];
    expect(heading[0].retrieval).toBe("scraped");
    expect(heading[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("emits one provenance record per top-level custom_extraction key", () => {
    const out = attachProvenance(sample());
    expect(out._provenance.fields["plans"]).toBeTruthy();
    expect(out._provenance.fields["plans"][0].retrieval).toBe("ai_inferred");
  });

  it("does not mutate the input extraction", () => {
    const s = sample();
    const before = JSON.stringify(s);
    attachProvenance(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("returns the input unchanged when it is null/undefined", () => {
    expect(attachProvenance(null)).toBeNull();
    expect(attachProvenance(undefined)).toBeUndefined();
  });
});

describe("Q9 — refreshProvenance: re-check timestamp", () => {
  it("updates last_checked_at on every field without changing source_url", () => {
    const out = attachProvenance(sample(), { now: FIXED_NOW });
    vi.setSystemTime(new Date("2026-07-17T01:00:00.000Z"));
    const refreshed = refreshProvenance(out);
    for (const provs of Object.values(refreshed._provenance.fields)) {
      for (const p of provs) {
        expect(p.last_checked_at).toBe("2026-07-17T01:00:00.000Z");
        expect(p.source_url).toBe("https://stripe.com/pricing");
      }
    }
  });

  it("auto-attaches provenance when called on an extraction without one", () => {
    const s = sample();
    delete s._provenance;
    const out = refreshProvenance(s);
    expect(out._provenance).toBeTruthy();
  });
});

describe("Q9 — getProvenanceForField + summarise", () => {
  it("getProvenanceForField returns the array for a known field", () => {
    const out = attachProvenance(sample());
    const p = getProvenanceForField(out, "Pricing");
    expect(p).toHaveLength(1);
    expect(p[0].field).toBe("heading");
  });

  it("getProvenanceForField returns [] for an unknown field", () => {
    const out = attachProvenance(sample());
    expect(getProvenanceForField(out, "NotARealField")).toEqual([]);
  });

  it("summariseProvenance returns a single-line description with the host + stats", () => {
    const out = attachProvenance(sample(), { now: FIXED_NOW });
    const s = summariseProvenance(out);
    expect(s).toMatch(/Sourced from stripe\.com/);
    expect(s).toMatch(/fields/);
    expect(s).toMatch(/confidence/);
    expect(s).toMatch(/checked/);
  });

  it("summariseProvenance returns a fallback string when no provenance is present", () => {
    expect(summariseProvenance({})).toMatch(/No provenance/i);
    expect(summariseProvenance(null)).toMatch(/No provenance/i);
  });
});

describe("Q9 — pickConfidence: heuristic", () => {
  it("returns scraped-tier confidence for heading/link/title", () => {
    expect(pickConfidence("heading")).toBeGreaterThanOrEqual(0.9);
    expect(pickConfidence("link")).toBeGreaterThanOrEqual(0.9);
    expect(pickConfidence("title")).toBeGreaterThanOrEqual(0.9);
  });

  it("returns ai-tier confidence for ai_summary / custom / enrichment", () => {
    expect(pickConfidence("ai_summary")).toBeLessThan(0.9);
    expect(pickConfidence("custom")).toBeLessThan(0.9);
    expect(pickConfidence("enrichment")).toBeLessThan(0.9);
  });

  it("returns a default confidence for unknown fields", () => {
    expect(pickConfidence("weird_unknown_field")).toBeGreaterThan(0);
    expect(pickConfidence("weird_unknown_field")).toBeLessThanOrEqual(1);
  });
});
