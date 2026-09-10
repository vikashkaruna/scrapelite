// netlify/__tests__/audit/evidenceCollector.test.js
//
// The collector is the thing that makes "every signal retains evidence" a
// property of the code rather than a rule everyone has to remember. These pin
// the two behaviours that make it safe to call from inside an analyser: it
// never throws, and an absent collector is a real object rather than an
// optional chain at four hundred call sites.

import { describe, it, expect } from "vitest";
import {
  createEvidenceCollector, nullEvidenceCollector, mergeEvidenceMaps,
} from "../../functions/lib/audit/evidenceCollector.js";

const URL = "https://example.com/pricing";
const AT = Date.parse("2026-09-10T09:00:00.000Z");

const collector = () => createEvidenceCollector({ url: URL, collectedAt: AT });

describe("createEvidenceCollector", () => {
  it("defaults the source and timestamp so an analyser need not repeat them", () => {
    const E = collector();
    E.signal("single_h1", { method: "raw_html", selector: "h1" });
    const [rec] = E.evidenceFor("single_h1");
    expect(rec.source_url).toBe(URL);
    expect(rec.collected_at).toBe("2026-09-10T09:00:00.000Z");
  });

  it("lets a call site override the source for evidence read elsewhere", () => {
    // robots.txt and answer-engine samples are not read from the audited page.
    const E = collector();
    E.signal("crawl_index_eligibility", {
      method: "robots_txt", sourceUrl: "https://example.com/robots.txt",
    });
    expect(E.evidenceFor("crawl_index_eligibility")[0].source_url)
      .toBe("https://example.com/robots.txt");
  });

  it("keeps records in the order they were made", () => {
    // First-recorded is the primary reading — attachEvidenceToPillars takes
    // rawValue from it — so order is load-bearing, not incidental.
    const E = collector();
    E.signal("passage_independence", { method: "derived", observedValue: 61 });
    E.signal("passage_independence", { method: "model_inference", observedValue: 88 });
    expect(E.evidenceFor("passage_independence").map((r) => r.method))
      .toEqual(["derived", "model_inference"]);
  });

  it("drops a record it cannot vouch for instead of throwing mid-audit", () => {
    // An analyser must never be able to fail an audit the customer was already
    // charged for because a `section` string came out undefined.
    const E = collector();
    expect(() => E.signal("single_h1", { method: "telepathy" })).not.toThrow();
    expect(() => E.signal("single_h1", {})).not.toThrow();
    expect(E.evidenceFor("single_h1")).toEqual([]);
  });

  it("ignores a record with no signal code rather than filing it under undefined", () => {
    const E = collector();
    expect(E.signal(undefined, { method: "raw_html" })).toBeNull();
    expect(E.signalMap()).toEqual({});
  });

  it("returns a copy, so a consumer cannot mutate the collector's own list", () => {
    const E = collector();
    E.signal("single_h1", { method: "raw_html" });
    E.evidenceFor("single_h1").push("junk");
    expect(E.evidenceFor("single_h1")).toHaveLength(1);
  });

  it("gives an unknown signal an empty list, never undefined", () => {
    expect(collector().evidenceFor("nothing_here")).toEqual([]);
  });
});

describe("issue evidence", () => {
  it("inherits the signal's observations", () => {
    // "the heading tree scored 40" and "this page skips heading levels" are two
    // readings of one observation; making the issue re-record it would be a
    // second chance to record it differently.
    const E = collector();
    E.signal("heading_tree_integrity", { method: "raw_html", observedValue: { skipped: 3 } });
    const forIssue = E.evidenceForIssue("SH-04", "heading_tree_integrity");
    expect(forIssue).toHaveLength(1);
    expect(forIssue[0].observed_value).toEqual({ skipped: 3 });
  });

  it("puts the signal's broader reading before the issue's own narrower note", () => {
    // A reader follows the narrowing, not the widening.
    const E = collector();
    E.signal("schema_identity_completeness", { method: "json_ld", section: "Identity markup" });
    E.note("EA-02", { method: "json_ld", section: "Organization node", excerpt: "wrong name" });
    expect(E.evidenceForIssue("EA-02", "schema_identity_completeness").map((r) => r.section))
      .toEqual(["Identity markup", "Organization node"]);
  });

  it("gives an issue with no signal only its own notes", () => {
    const E = collector();
    E.note("TA-16", { method: "robots_txt", sourceUrl: "https://example.com/robots.txt" });
    expect(E.evidenceForIssue("TA-16", null)).toHaveLength(1);
    expect(E.evidenceForIssue("TA-16", undefined)).toHaveLength(1);
  });

  it("gives an issue with neither an empty list rather than undefined", () => {
    expect(collector().evidenceForIssue("AC-01", "direct_answer_block")).toEqual([]);
  });
});

describe("nullEvidenceCollector", () => {
  it("satisfies the whole interface, so analyser code stays unconditional", () => {
    // Every analyser has tests that call it with a bare `{}`. Guarding each of
    // ~25 call sites with `ctx.evidence?.signal?.(…)` is 25 chances to write the
    // optional chain wrongly and silently stop recording.
    const E = nullEvidenceCollector();
    expect(() => E.signal("x", { method: "raw_html" })).not.toThrow();
    expect(() => E.note("Y-01", { method: "raw_html" })).not.toThrow();
    expect(E.evidenceFor("x")).toEqual([]);
    expect(E.evidenceForIssue("Y-01", "x")).toEqual([]);
    expect(E.signalMap()).toEqual({});
    expect(E.issueMap()).toEqual({});
  });

  it("matches the real collector's method surface exactly", () => {
    // A method added to one and not the other would work in production and
    // throw in every analyser unit test, or vice versa.
    expect(Object.keys(nullEvidenceCollector()).sort())
      .toEqual(Object.keys(collector()).sort());
  });
});

describe("mergeEvidenceMaps", () => {
  it("concatenates per-signal lists across analysers", () => {
    const merged = mergeEvidenceMaps([
      { a: [1], b: [2] },
      { a: [3], c: [4] },
    ]);
    expect(merged).toEqual({ a: [1, 3], b: [2], c: [4] });
  });

  it("tolerates gaps in the input", () => {
    expect(mergeEvidenceMaps([null, undefined, { a: [1] }])).toEqual({ a: [1] });
    expect(mergeEvidenceMaps()).toEqual({});
  });
});
