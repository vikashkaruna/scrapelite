import { describe, expect, it } from "vitest";
import { MODULE_STATUS, PLATFORM_MODULES, hasModuleCta, moduleStatusLabel } from "./platformModules.js";

describe("platformModules", () => {
  it("publishes the six DatIQ pillars exactly once", () => {
    expect(PLATFORM_MODULES.map((module) => module.key)).toEqual([
      "extract", "enrich", "compete", "connect", "engage", "discover",
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

  it("keeps Discover as Beta until the parallel release integrates", () => {
    const discover = PLATFORM_MODULES.find((module) => module.key === "discover");
    expect(discover).toMatchObject({
      name: "DatIQ Discover",
      status: MODULE_STATUS.BETA,
      cta: "Run a visibility audit",
    });
    expect(moduleStatusLabel(discover.status)).toBe("Beta");
  });
});
