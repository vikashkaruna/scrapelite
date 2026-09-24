import { describe, expect, it } from "vitest";
import { MODULE_STATUS, PLATFORM_MODULES, hasModuleCta, moduleStatusLabel } from "./platformModules.js";

describe("platformModules", () => {
  it("publishes the six DatIQ pillars exactly once", () => {
    expect(PLATFORM_MODULES.map((module) => module.key)).toEqual([
      "extract", "enrich", "discover", "compete", "connect", "engage",
    ]);
  });

  it("makes status a truthful interaction boundary", () => {
    for (const module of PLATFORM_MODULES) {
      expect(Object.values(MODULE_STATUS)).toContain(module.status);
      if (module.status === MODULE_STATUS.UPCOMING) {
        expect(hasModuleCta(module)).toBe(false);
        expect(module.cta).toBeUndefined();
      } else {
        expect(hasModuleCta(module)).toBe(true);
        expect(module.cta).toBeTruthy();
        expect(module.to || module.action).toBeTruthy();
      }
    }
  });

  it("shows Discover as Available (owner, 2026-09-24)", () => {
    const discover = PLATFORM_MODULES.find((module) => module.key === "discover");
    expect(discover).toMatchObject({
      name: "DatIQ Discover",
      status: MODULE_STATUS.AVAILABLE,
      cta: "Run a visibility audit",
    });
    expect(moduleStatusLabel(discover.status)).toBe("Available");
  });

  it("links Engage (beta) to Engagement and Compete to the Workflow hub", () => {
    const byKey = Object.fromEntries(PLATFORM_MODULES.map((m) => [m.key, m]));
    expect(byKey.engage).toMatchObject({ status: MODULE_STATUS.BETA, cta: "Open Engagement", to: "/engagement" });
    expect(byKey.compete).toMatchObject({ status: MODULE_STATUS.BETA, cta: "Open Workflow hub", to: "/workflows" });
    expect(moduleStatusLabel(byKey.engage.status)).toBe("Beta");
  });
});
