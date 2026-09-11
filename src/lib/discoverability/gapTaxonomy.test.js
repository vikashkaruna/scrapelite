import { describe, it, expect } from "vitest";
import {
  ROOT_CAUSES, ROOT_CAUSE_IDS, MODULES, MODULE_IDS,
  rootCause, moduleFor, groupByRootCause, rootCausesInUse, primaryRootCause,
} from "./gapTaxonomy.js";
import { ISSUES, ISSUE_CODES, SEVERITIES, OWNERS } from "./issueCatalog.js";

describe("the taxonomy is closed and complete", () => {
  it("has exactly the eight causes the deck names", () => {
    expect(ROOT_CAUSE_IDS).toEqual([
      "technical_access", "weak_page_structure", "entity_ambiguity", "insufficient_proof",
      "missing_content_coverage", "location_radius_mismatch", "ux_friction", "conversion_friction",
    ]);
  });

  it("puts technical access first, because it is first in causality", () => {
    // A report that opens with heading advice on a page a crawler cannot fetch
    // has buried its own finding.
    expect(ROOT_CAUSE_IDS[0]).toBe("technical_access");
  });

  it("gives every cause a question a person can actually answer", () => {
    for (const id of ROOT_CAUSE_IDS) {
      expect(ROOT_CAUSES[id].question, id).toMatch(/\?$/);
      expect(ROOT_CAUSES[id].description, id).toBeTruthy();
    }
  });

  it("points every cause at modules that exist", () => {
    for (const id of ROOT_CAUSE_IDS) {
      expect(ROOT_CAUSES[id].modules.length, id).toBeGreaterThan(0);
      for (const m of ROOT_CAUSES[id].modules) expect(MODULE_IDS, `${id} → ${m}`).toContain(m);
    }
  });

  it("has thirteen modules, and stores none of them by M-number", () => {
    // The BRD names these M1-M13 and does not say which is which anywhere this
    // repo can see. The slug is the contract; mCode is a display alias waiting
    // for confirmation, and nothing may key off it.
    expect(MODULE_IDS).toHaveLength(13);
    for (const id of MODULE_IDS) expect(MODULES[id].mCode, id).toBeNull();
  });

  it("says which phase each module can actually accept a referral in", () => {
    for (const id of MODULE_IDS) {
      expect(["P1", "P2"], id).toContain(MODULES[id].phase);
      expect(typeof MODULES[id].available, id).toBe("boolean");
    }
  });

  it("returns null for an unknown id rather than a partial object", () => {
    expect(rootCause("vibes")).toBeNull();
    expect(moduleFor("M99")).toBeNull();
  });
});

describe("every issue code carries a diagnosis and a referral", () => {
  it("assigns a valid root cause to all 46 codes", () => {
    for (const code of ISSUE_CODES) {
      expect(ROOT_CAUSES[ISSUES[code].rootCause], `${code} → ${ISSUES[code].rootCause}`).toBeTruthy();
    }
  });

  it("assigns a valid module to all 46 codes", () => {
    for (const code of ISSUE_CODES) {
      expect(MODULES[ISSUES[code].module], `${code} → ${ISSUES[code].module}`).toBeTruthy();
    }
  });

  it("keeps `why` on every code — it is the inference half of the record", () => {
    // The observed/inference split has nowhere to get the inference from if a
    // code stops carrying one.
    for (const code of ISSUE_CODES) expect(ISSUES[code].why, code).toBeTruthy();
  });

  it("classifies every crawl-access failure as technical access", () => {
    for (const code of ["TA-01", "TA-02", "TA-03", "TA-04", "TA-05", "TA-07", "TA-08"]) {
      expect(ISSUES[code].rootCause, code).toBe("technical_access");
    }
  });

  it("classifies ordinary Core Web Vitals as UX friction, not access", () => {
    // The page IS reachable and IS indexable — it is just unpleasant. Filing it
    // under access would put "your page is slow" above "your page is blocked".
    for (const code of ["TA-09", "TA-10", "TA-11"]) {
      expect(ISSUES[code].rootCause, code).toBe("ux_friction");
    }
  });

  it("classifies SEVERE vitals back under access, which is the W3 blocker's basis", () => {
    // Past that point crawl budget contracts, so the page is genuinely harder
    // to reach rather than merely slow.
    expect(ISSUES["TA-17"].rootCause).toBe("technical_access");
  });

  it("separates who-you-are from why-trust-you inside entity authority", () => {
    for (const code of ["EA-01", "EA-02", "EA-03", "EA-10", "EA-11"]) {
      expect(ISSUES[code].rootCause, code).toBe("entity_ambiguity");
    }
    for (const code of ["EA-04", "EA-05", "EA-06", "EA-07"]) {
      expect(ISSUES[code].rootCause, code).toBe("insufficient_proof");
    }
  });

  it("uses no P2-only cause on any P1 code", () => {
    // Both are declared for the contract and must stay unreachable until the
    // modules behind them exist, or a customer is shown a referral to nothing.
    const p2Only = ["location_radius_mismatch", "conversion_friction"];
    const used = ISSUE_CODES.map((c) => ISSUES[c].rootCause);
    for (const cause of p2Only) expect(used, cause).not.toContain(cause);
  });

  it("keeps owner within the declared set, since it is now a stored column", () => {
    for (const code of ISSUE_CODES) expect(OWNERS, code).toContain(ISSUES[code].owner);
    for (const code of ISSUE_CODES) expect(SEVERITIES, code).toContain(ISSUES[code].severity);
  });
});

describe("grouping turns a list into a diagnosis", () => {
  const issues = [
    { code: "SH-01", rootCause: "weak_page_structure", severity: "critical" },
    { code: "SH-04", rootCause: "weak_page_structure", severity: "medium" },
    { code: "TA-01", rootCause: "technical_access", severity: "critical" },
    { code: "EA-04", rootCause: "insufficient_proof", severity: "high" },
    { code: "XX-99", rootCause: "not_a_cause", severity: "high" },
  ];
  const rank = (i) => SEVERITIES.indexOf(i.severity);

  it("returns causes in taxonomy order, not by count", () => {
    // The commonest cause on a broken page is usually weak_page_structure,
    // simply because there are more structural codes to trip. Leading with it
    // on an unreachable page tells the reader to restructure headings nobody
    // will ever see.
    const groups = groupByRootCause(issues, { severityRank: rank });
    expect(groups.map((g) => g.id)).toEqual([
      "technical_access", "weak_page_structure", "insufficient_proof",
    ]);
  });

  it("omits causes this audit did not produce", () => {
    // An empty bucket beside full ones reads as "we checked and found nothing",
    // which is a claim this function has no business making for a check that
    // may never have run.
    const groups = groupByRootCause(issues, { severityRank: rank });
    expect(groups.map((g) => g.id)).not.toContain("ux_friction");
  });

  it("drops a finding whose cause is not in the taxonomy rather than inventing a bucket", () => {
    const groups = groupByRootCause(issues, { severityRank: rank });
    const all = groups.flatMap((g) => g.issues.map((i) => i.code));
    expect(all).not.toContain("XX-99");
  });

  it("leads each group with its worst finding", () => {
    const structure = groupByRootCause(issues, { severityRank: rank })
      .find((g) => g.id === "weak_page_structure");
    expect(structure.issues[0].code).toBe("SH-01");
    expect(structure.count).toBe(2);
  });

  it("names the one cause to lead the report with", () => {
    expect(primaryRootCause(issues).id).toBe("technical_access");
    expect(primaryRootCause([])).toBeNull();
  });

  it("reports only the causes actually in use", () => {
    expect(rootCausesInUse(issues)).toEqual([
      "technical_access", "weak_page_structure", "insufficient_proof",
    ]);
    expect(rootCausesInUse([])).toEqual([]);
  });

  it("survives an empty or malformed issue list rather than throwing", () => {
    expect(groupByRootCause()).toEqual([]);
    expect(groupByRootCause([null, undefined, {}])).toEqual([]);
  });
});
