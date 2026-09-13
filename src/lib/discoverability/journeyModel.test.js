import { describe, it, expect } from "vitest";
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_KEYS,
  calculateJourneyFunnel,
} from "./journeyModel.js";

describe("journeyModel — 9 funnel stages and drop-off governance (Deliverable 3.4)", () => {
  it("defines exactly 9 frozen stages in sequential order (§5 / §11.9)", () => {
    expect(FUNNEL_STAGES.length).toBe(9);
    expect(FUNNEL_STAGE_KEYS).toEqual([
      "search_impression",
      "landing_session",
      "engaged_session",
      "key_content_seen",
      "primary_cta_view",
      "primary_cta_click",
      "action_start",
      "conversion_complete",
      "qualified_outcome",
    ]);
  });

  it("marks missing stages as unmeasured and names the reason", () => {
    // Only landing and conversion are measured
    const result = calculateJourneyFunnel({
      landing_session: 1000,
      conversion_complete: 50,
    });

    expect(result.measured_stages_count).toBe(2);
    expect(result.total_stages).toBe(9);
    expect(result.coverage_percent).toBe(Math.round((2 / 9) * 100));

    const landing = result.stages.find((s) => s.key === "landing_session");
    expect(landing.measured).toBe(true);
    expect(landing.count).toBe(1000);

    const ctaView = result.stages.find((s) => s.key === "primary_cta_view");
    expect(ctaView.measured).toBe(false);
    expect(ctaView.status).toBe("unmeasured");
    expect(ctaView.unmeasured_reason).toBe("No telemetry instrumented for this stage.");
    expect(ctaView.conversion_rate_from_previous_measured).toBeNull();
    expect(ctaView.drop_off_rate_from_previous_measured).toBeNull();

    expect(result.caveats.length).toBe(7);
  });

  it("NEVER treats missing instrumentation as a drop-off leak", () => {
    // If primary_cta_view is missing, conversion_complete compares directly
    // to landing_session without attributing a false drop-off to unmeasured intermediate steps
    const result = calculateJourneyFunnel({
      landing_session: 1000,
      conversion_complete: 100,
    });

    const conversion = result.stages.find((s) => s.key === "conversion_complete");
    expect(conversion.measured).toBe(true);
    expect(conversion.conversion_rate_from_previous_measured).toBe(10); // 100 / 1000
    expect(conversion.drop_off_rate_from_previous_measured).toBe(90);
  });

  it("computes overall conversion rate across measured boundaries", () => {
    const result = calculateJourneyFunnel({
      search_impression: 10000,
      landing_session: 1000,
      engaged_session: 600,
      key_content_seen: 400,
      primary_cta_view: 300,
      primary_cta_click: 150,
      action_start: 100,
      conversion_complete: 50,
      qualified_outcome: 20,
    });

    expect(result.measured_stages_count).toBe(9);
    expect(result.coverage_percent).toBe(100);
    // Overall: 20 / 10000 = 0.2%
    expect(result.overall_conversion_rate).toBe(0.2);
    expect(result.caveats.length).toBe(0);
  });
});
