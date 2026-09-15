import { describe, it, expect } from "vitest";
import {
  NORMALIZED_EVENTS,
  NORMALIZED_EVENT_SET,
  EVENT_CATEGORIES,
  EVENT_TO_CATEGORY,
  SEGMENTATION_AXES,
  isValidNormalizedEvent,
  mapSourceEvent,
} from "./eventTaxonomy.js";

describe("eventTaxonomy — 24 normalized events and governance (Deliverable 3.1)", () => {
  it("contains exactly 24 frozen normalized events (§5 / §11.8)", () => {
    expect(NORMALIZED_EVENTS.length).toBe(24);
    expect(Object.isFrozen(NORMALIZED_EVENTS)).toBe(true);
    expect(NORMALIZED_EVENT_SET.size).toBe(24);

    // Assert key events explicitly
    expect(NORMALIZED_EVENT_SET.has("page_view")).toBe(true);
    expect(NORMALIZED_EVENT_SET.has("primary_cta_view")).toBe(true);
    expect(NORMALIZED_EVENT_SET.has("primary_cta_click")).toBe(true);
    expect(NORMALIZED_EVENT_SET.has("form_submit")).toBe(true);
    expect(NORMALIZED_EVENT_SET.has("qualified_conversion")).toBe(true);
  });

  it("classifies all 24 events into the four categories", () => {
    expect(Object.keys(EVENT_CATEGORIES)).toEqual(["discovery", "engagement", "friction", "conversion"]);
    const allCategorized = [
      ...EVENT_CATEGORIES.discovery,
      ...EVENT_CATEGORIES.engagement,
      ...EVENT_CATEGORIES.friction,
      ...EVENT_CATEGORIES.conversion,
    ];
    expect(allCategorized.length).toBe(24);
    for (const eventName of NORMALIZED_EVENTS) {
      expect(EVENT_TO_CATEGORY[eventName]).toBeDefined();
    }
  });

  it("contains exactly 7 segmentation axes (§5 / §11.8)", () => {
    expect(SEGMENTATION_AXES.length).toBe(7);
    expect(SEGMENTATION_AXES).toEqual([
      "landing_page",
      "source_channel",
      "device",
      "region",
      "time",
      "visitor_type",
      "conversion_goal",
    ]);
  });

  it("validates normalized events directly", () => {
    expect(isValidNormalizedEvent("page_view")).toBe(true);
    expect(isValidNormalizedEvent("pricing_view")).toBe(true);
    expect(isValidNormalizedEvent("unknown_action")).toBe(false);
  });

  it("maps GA4 events correctly", () => {
    const pageView = mapSourceEvent("ga4", "page_view");
    expect(pageView.valid).toBe(true);
    expect(pageView.normalized_event).toBe("page_view");

    const scroll75 = mapSourceEvent("ga4", "scroll", { percent_scrolled: 80 });
    expect(scroll75.valid).toBe(true);
    expect(scroll75.normalized_event).toBe("scroll_75");

    const primaryClick = mapSourceEvent("ga4", "click", { is_primary: true });
    expect(primaryClick.valid).toBe(true);
    expect(primaryClick.normalized_event).toBe("primary_cta_click");
  });

  it("maps PostHog and Plausible events correctly", () => {
    const posthogView = mapSourceEvent("posthog", "$pageview");
    expect(posthogView.valid).toBe(true);
    expect(posthogView.normalized_event).toBe("page_view");

    const plausibleSignup = mapSourceEvent("plausible", "Signup Form Submit");
    expect(plausibleSignup.valid).toBe(true);
    expect(plausibleSignup.normalized_event).toBe("form_submit");
  });

  it("unmapped events are NAMED and rejected with valid: false (never silently dropped)", () => {
    const unmapped = mapSourceEvent("custom", "random_weird_event_name_123");
    expect(unmapped.valid).toBe(false);
    expect(unmapped.normalized_event).toBeNull();
    expect(unmapped.unmapped_name).toBe("random_weird_event_name_123");
    expect(unmapped.reason).toContain("Unrecognized source event");
  });
});
