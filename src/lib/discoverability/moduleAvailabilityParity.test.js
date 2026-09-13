import { describe, expect, it } from "vitest";
import { ISSUES, ISSUE_CODES } from "./issueCatalog.js";
import { MODULES } from "./gapTaxonomy.js";
import {
  MODULE_STATUS,
  PLATFORM_MODULES,
  hasModuleCta,
} from "../platformModules.js";

// Workstreams W1-W10 and W12-W13 are implemented. The three subject-score
// destinations stay out until CP-1.1 makes entity subjects reachable, and
// service_radius stays out until its own implementation lands.
const SHIPPED_RECOMMENDATION_MODULES = Object.freeze([
  "technical_remediation",
  "recommendation_studio",
  "schema_intelligence",
  "ai_visibility",
  "validation_lab",
  "business_truth_record",
  "entity_graph",
  "local_directory",
  "trust_and_proof",
]);

describe("implemented-module availability parity", () => {
  it("never routes a real issue to a module advertised as coming", () => {
    for (const code of ISSUE_CODES) {
      const moduleId = ISSUES[code].module;
      expect(MODULES[moduleId].available, `${code} → ${moduleId}`).toBe(true);
    }
  });

  it("keeps every completed P1/P2 recommendation destination available", () => {
    for (const moduleId of SHIPPED_RECOMMENDATION_MODULES) {
      expect(MODULES[moduleId].available, moduleId).toBe(true);
    }
  });

  it("keeps the public Discover pillar actionable while its shipped engine is available", () => {
    const discover = PLATFORM_MODULES.find((module) => module.key === "discover");
    const shippedEngineIsAvailable = SHIPPED_RECOMMENDATION_MODULES
      .some((moduleId) => MODULES[moduleId].available);

    expect(shippedEngineIsAvailable).toBe(true);
    expect(discover?.status).not.toBe(MODULE_STATUS.UPCOMING);
    expect(discover?.to).toBe("/discoverability");
    expect(hasModuleCta(discover)).toBe(true);
  });
});
