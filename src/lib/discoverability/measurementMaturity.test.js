import { describe, it, expect } from "vitest";
import {
  MI_COMPONENT_WEIGHTS,
  evaluateMeasurementMaturity,
} from "./measurementMaturity.js";

describe("measurementMaturity — MI layer & funnel caveats (Deliverable 3.9)", () => {
  it("uses the exact MI component weights from SXO model", () => {
    expect(MI_COMPONENT_WEIGHTS).toEqual({
      event_instrumentation: 0.30,
      funnel_tracking: 0.30,
      form_analytics: 0.20,
      experiment_readiness: 0.20,
    });
  });

  it("returns unmeasured null score with explicit caveats when disconnected", () => {
    const result = evaluateMeasurementMaturity(null);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.maturity_level).toBe("unmeasured");
    expect(result.caveats.length).toBeGreaterThan(0);
    expect(result.caveats[0]).toContain("No analytics integration connected");
  });

  it("produces caveats when telemetry is incomplete", () => {
    const result = evaluateMeasurementMaturity({
      connected: true,
      trackedEventsCount: 4,
      measuredFunnelStagesCount: 3,
      formTrackingActive: false,
      experimentsConfigured: false,
    });

    expect(result.score).toBeDefined();
    expect(result.score).toBeGreaterThan(0);
    expect(result.maturity_level).toBe("basic");

    // Must caveat missing funnel stages, form tracking, and experiments
    expect(result.caveats.some((c) => c.includes("Only 3 of 9 journey stages"))).toBe(true);
    expect(result.caveats.some((c) => c.includes("Form field interaction telemetry is absent"))).toBe(true);
    expect(result.caveats.some((c) => c.includes("No experiment variants"))).toBe(true);
  });

  it("evaluates advanced maturity when fully instrumented", () => {
    const result = evaluateMeasurementMaturity({
      connected: true,
      trackedEventsCount: 15,
      measuredFunnelStagesCount: 9,
      formTrackingActive: true,
      experimentsConfigured: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.maturity_level).toBe("advanced");
    expect(result.coverage).toBe(100);
    expect(result.caveats.length).toBe(0);
  });
});
