import { describe, it, expect } from "vitest";
import {
  EVIDENCE_METHODS, EVIDENCE_METHOD_IDS,
  EVIDENCE_EXCERPT_MAX, EVIDENCE_STRUCTURED_MAX,
  makeEvidence, isEvidence, isObserved, evidenceList,
  evidenceConfidence, partitionEvidence, describeEvidence,
} from "./evidenceModel.js";

const AT = "2026-09-10T09:00:00.000Z";
const URL = "https://example.com/pricing";

/** The smallest thing that is still evidence. */
function ev(over = {}) {
  return makeEvidence({ method: "raw_html", sourceUrl: URL, collectedAt: AT, ...over });
}

describe("EVIDENCE_METHODS", () => {
  it("declares confidence and observed-ness for every method", () => {
    for (const id of EVIDENCE_METHOD_IDS) {
      const m = EVIDENCE_METHODS[id];
      expect(typeof m.confidence, id).toBe("number");
      expect(m.confidence, id).toBeGreaterThan(0);
      expect(m.confidence, id).toBeLessThanOrEqual(1);
      expect(typeof m.observed, id).toBe("boolean");
      expect(m.label, id).toBeTruthy();
      expect(m.describes, id).toBeTruthy();
    }
  });

  it("marks exactly the two non-reading methods as inference", () => {
    // This is the BRD's "separate observed facts from model inference" rule
    // expressed as data. If a new method is added, this test forces a decision
    // about which side of that line it falls on rather than letting it default.
    const inferred = EVIDENCE_METHOD_IDS.filter((id) => !EVIDENCE_METHODS[id].observed);
    expect(inferred.sort()).toEqual(["derived", "model_inference"]);
  });

  it("never rates an inference above a direct reading", () => {
    const readings = EVIDENCE_METHOD_IDS
      .filter((id) => EVIDENCE_METHODS[id].observed && EVIDENCE_METHODS[id].confidence >= 0.95)
      .map((id) => EVIDENCE_METHODS[id].confidence);
    expect(EVIDENCE_METHODS.model_inference.confidence).toBeLessThan(Math.min(...readings));
  });
});

describe("makeEvidence — what it refuses to build", () => {
  it("returns null for an unknown method rather than inventing one", () => {
    expect(makeEvidence({ method: "vibes", sourceUrl: URL, collectedAt: AT })).toBeNull();
    expect(makeEvidence({ sourceUrl: URL, collectedAt: AT })).toBeNull();
  });

  it("returns null with no source URL — no source, no evidence", () => {
    expect(makeEvidence({ method: "raw_html", collectedAt: AT })).toBeNull();
    expect(makeEvidence({ method: "raw_html", sourceUrl: "   ", collectedAt: AT })).toBeNull();
  });

  it("returns null with no usable timestamp, so nothing undated is stored", () => {
    expect(makeEvidence({ method: "raw_html", sourceUrl: URL })).toBeNull();
    expect(makeEvidence({ method: "raw_html", sourceUrl: URL, collectedAt: "not a date" })).toBeNull();
  });

  it("accepts a Date, an epoch and an ISO string identically", () => {
    const ms = Date.parse(AT);
    expect(ev({ collectedAt: new Date(ms) }).collected_at).toBe(AT);
    expect(ev({ collectedAt: ms }).collected_at).toBe(AT);
    expect(ev({ collectedAt: AT }).collected_at).toBe(AT);
  });
});

describe("makeEvidence — the record it builds", () => {
  it("carries every field the BRD names", () => {
    const e = makeEvidence({
      method: "json_ld",
      sourceUrl: URL,
      selector: "script[type='application/ld+json']:nth-of-type(1)",
      section: "Organization node",
      observedValue: "ExampleTech",
      excerpt: "{\"@type\":\"Organization\",\"name\":\"ExampleTech\"}",
      structured: { type: "Organization", missing: ["logo"] },
      collectedAt: AT,
    });
    expect(e.source_url).toBe(URL);
    expect(e.selector).toContain("ld+json");
    expect(e.section).toBe("Organization node");
    expect(e.observed_value).toBe("ExampleTech");
    expect(e.excerpt).toContain("ExampleTech");
    expect(e.structured).toEqual({ type: "Organization", missing: ["logo"] });
    expect(e.collected_at).toBe(AT);
    expect(e.confidence).toBe(EVIDENCE_METHODS.json_ld.confidence);
    expect(e.observed).toBe(true);
  });

  it("is frozen, so a downstream consumer cannot rewrite a stored observation", () => {
    const e = ev();
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("defaults confidence from the method and honours a lower override", () => {
    expect(ev().confidence).toBe(EVIDENCE_METHODS.raw_html.confidence);
    expect(ev({ confidence: 0.4 }).confidence).toBe(0.4);
  });

  it("clamps a nonsense confidence instead of storing it", () => {
    expect(ev({ confidence: 7 }).confidence).toBe(1);
    expect(ev({ confidence: -3 }).confidence).toBe(0);
    expect(ev({ confidence: "high" }).confidence).toBe(EVIDENCE_METHODS.raw_html.confidence);
  });

  it("keeps a false or zero observed value rather than treating it as absent", () => {
    // `observed_value: 0` is a real measurement — a page with zero H1s. Only
    // `undefined` means "nothing was measured here".
    expect(ev({ observedValue: 0 }).observed_value).toBe(0);
    expect(ev({ observedValue: false }).observed_value).toBe(false);
    expect(ev().observed_value).toBeNull();
  });
});

describe("makeEvidence — excerpts", () => {
  it("collapses whitespace so a quote reads as one line", () => {
    expect(ev({ excerpt: "  a\n\n  b\tc  " }).excerpt).toBe("a b c");
  });

  it("caps a long excerpt and marks the truncation", () => {
    const e = ev({ excerpt: "x".repeat(EVIDENCE_EXCERPT_MAX * 3) });
    expect(e.excerpt.length).toBe(EVIDENCE_EXCERPT_MAX);
    expect(e.excerpt.endsWith("…")).toBe(true);
  });

  it("treats a whitespace-only excerpt as no excerpt", () => {
    expect(ev({ excerpt: "   \n " }).excerpt).toBeNull();
  });
});

describe("makeEvidence — structured payloads", () => {
  it("drops an oversized payload whole rather than truncating it", () => {
    // Half a JSON object is not a smaller fact, it is a different one.
    const big = { blob: "y".repeat(EVIDENCE_STRUCTURED_MAX + 100) };
    expect(ev({ structured: big }).structured).toBeNull();
  });

  it("drops anything that is not a plain object", () => {
    expect(ev({ structured: [1, 2, 3] }).structured).toBeNull();
    expect(ev({ structured: "text" }).structured).toBeNull();
    expect(ev({ structured: {} }).structured).toBeNull();
  });

  it("drops a cyclic payload instead of throwing mid-audit", () => {
    const cyclic = { name: "a" };
    cyclic.self = cyclic;
    expect(() => ev({ structured: cyclic })).not.toThrow();
    expect(ev({ structured: cyclic }).structured).toBeNull();
  });

  it("detaches the payload so a later mutation cannot rewrite stored evidence", () => {
    const src = { missing: ["logo"] };
    const e = ev({ structured: src });
    src.missing.push("sameAs");
    expect(e.structured.missing).toEqual(["logo"]);
  });
});

describe("isEvidence / isObserved", () => {
  it("recognises its own output and rejects look-alikes", () => {
    expect(isEvidence(ev())).toBe(true);
    expect(isEvidence(null)).toBe(false);
    expect(isEvidence("evidence")).toBe(false);
    expect(isEvidence([ev()])).toBe(false);
    expect(isEvidence({ source_url: URL, collected_at: AT })).toBe(false);      // no method
    expect(isEvidence({ method: "raw_html", collected_at: AT })).toBe(false);   // no source
  });

  it("reports observation as a property of the method, not a caller flag", () => {
    expect(isObserved(ev({ method: "http_response" }))).toBe(true);
    expect(isObserved(ev({ method: "model_inference" }))).toBe(false);
    expect(isObserved(ev({ method: "derived" }))).toBe(false);
  });
});

describe("evidenceList", () => {
  it("normalises one record, an array, or nothing", () => {
    expect(evidenceList(ev())).toHaveLength(1);
    expect(evidenceList([ev(), ev()])).toHaveLength(2);
    expect(evidenceList(null)).toEqual([]);
    expect(evidenceList(undefined)).toEqual([]);
  });

  it("discards malformed entries instead of failing the audit around them", () => {
    // A finding still stands when its supporting record is broken; it is simply
    // less well supported. Throwing here would turn a cosmetic defect into a
    // failed audit the customer was already charged for.
    expect(evidenceList([ev(), null, "nope", { method: "raw_html" }])).toHaveLength(1);
  });
});

describe("evidenceConfidence", () => {
  it("returns null with no evidence, never 0", () => {
    // Same discipline as the scorer: unsupported and zero-confidence are
    // different sentences and the UI must be able to tell them apart.
    expect(evidenceConfidence([])).toBeNull();
    expect(evidenceConfidence(null)).toBeNull();
  });

  it("takes the strongest record, not the mean", () => {
    const direct = ev({ method: "http_response" });
    const guess = ev({ method: "model_inference" });
    expect(evidenceConfidence([direct, guess])).toBe(direct.confidence);
    expect(evidenceConfidence([guess, direct])).toBe(direct.confidence);
  });
});

describe("partitionEvidence", () => {
  it("keeps what was seen apart from what was concluded", () => {
    const seen = ev({ method: "raw_html" });
    const thought = ev({ method: "model_inference" });
    const { observed, inferred } = partitionEvidence([seen, thought]);
    expect(observed).toEqual([seen]);
    expect(inferred).toEqual([thought]);
  });
});

describe("describeEvidence", () => {
  it("names the method, so a reader knows whether they are reading a reading", () => {
    expect(describeEvidence(ev({ method: "model_inference", section: "first passage" })))
      .toBe("Model inference · first passage");
    expect(describeEvidence(ev({ method: "raw_html", section: "first passage" })))
      .toBe("Raw HTML · first passage");
  });

  it("prefers the human section over the selector, and quotes the excerpt", () => {
    expect(describeEvidence(ev({ section: "H2 #3", selector: "main > h2:nth-of-type(3)" })))
      .toBe("Raw HTML · H2 #3");
    expect(describeEvidence(ev({ selector: "main h1", excerpt: "Pricing" })))
      .toBe("Raw HTML · main h1 — “Pricing”");
  });

  it("returns an empty string for a non-record rather than throwing in a report", () => {
    expect(describeEvidence(null)).toBe("");
    expect(describeEvidence({})).toBe("");
  });
});
