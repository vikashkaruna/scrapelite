import { describe, it, expect } from "vitest";
import {
  evaluateSignalRule,
  formatActionPayload,
  TRIGGER_SOURCES,
  ACTION_TYPES,
} from "./ruleModel.js";

describe("ruleModel", () => {
  const SAMPLE_RULE = {
    id: "rule_123",
    name: "Critical Pricing Alert to Slack",
    trigger_source: TRIGGER_SOURCES.WATCHLIST,
    action_type: ACTION_TYPES.SLACK,
    action_config: { channel: "#competitor-watch" },
    conditions: [
      { field: "category", operator: "equals", value: "pricing" },
      { field: "materiality", operator: "in", value: ["critical", "high"] },
    ],
  };

  it("evaluates true when all conditions match", () => {
    const payload = {
      source: TRIGGER_SOURCES.WATCHLIST,
      domain: "stripe.com",
      category: "pricing",
      materiality: "critical",
      fact_summary: "Pricing increased by 50%",
    };

    const res = evaluateSignalRule(SAMPLE_RULE, payload);
    expect(res.matches).toBe(true);
  });

  it("evaluates false when any condition fails", () => {
    const payload = {
      source: TRIGGER_SOURCES.WATCHLIST,
      domain: "stripe.com",
      category: "pricing",
      materiality: "low",
    };

    const res = evaluateSignalRule(SAMPLE_RULE, payload);
    expect(res.matches).toBe(false);
  });

  it("checks numeric operators like gte for ICP scores", () => {
    const icpRule = {
      trigger_source: TRIGGER_SOURCES.BULK_ENRICHMENT,
      conditions: [{ field: "icp_score", operator: "gte", value: 75 }],
    };

    expect(evaluateSignalRule(icpRule, { source: TRIGGER_SOURCES.BULK_ENRICHMENT, icp_score: 85 }).matches).toBe(true);
    expect(evaluateSignalRule(icpRule, { source: TRIGGER_SOURCES.BULK_ENRICHMENT, icp_score: 70 }).matches).toBe(false);
  });

  it("formats action payloads correctly for Slack and Webhook", () => {
    const event = {
      domain: "stripe.com",
      field: "starter_price",
      materiality: "critical",
      fact_summary: "Starter price increased from $49 to $79",
      ai_interpretation: "Mid-market price expansion",
    };

    const slackPayload = formatActionPayload(SAMPLE_RULE, event);
    expect(slackPayload.channel).toBe("#competitor-watch");
    expect(slackPayload.text).toContain("DatIQ Signal Alert");
    expect(slackPayload.attachments[0].color).toBe("#b91c1c");

    const webhookRule = {
      id: "rule_wh",
      name: "Sync to Ops",
      action_type: ACTION_TYPES.WEBHOOK,
      action_config: { webhook_url: "https://ops.test/signals" },
    };

    const whPayload = formatActionPayload(webhookRule, event);
    expect(whPayload.url).toBe("https://ops.test/signals");
    expect(whPayload.payload.event.domain).toBe("stripe.com");
  });
});
