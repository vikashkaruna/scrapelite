// src/pages/Engagement.integration.test.jsx — Full Lifecycle End-to-End Integration Suite
import { describe, it, expect } from "vitest";
import {
  PROSPECT_STATUSES,
  transitionProspect,
  calculateEngagementScore,
  detectStaleProspects,
} from "../lib/engagement/stateMachine.js";
import {
  generatePersonalizedVariants,
  validateMessageGuardrails,
  CHANNELS,
} from "../lib/engagement/aiMessageGenerator.js";
import {
  resolveChannelForProspect,
  dispatchMessage,
} from "../lib/engagement/channelRouter.js";
import {
  dedupeProspects,
  normalizeEmail,
  normalizePhone,
} from "../lib/engagement/syncConnectors.js";

describe("DatIQ Prospect Engagement Engine — E2E Lifecycle", () => {
  const brandKit = {
    company_name: "DatIQ Intelligence",
    value_prop: "Automated real-time web extraction and competitive signals",
    cta_url: "https://datiq.app/demo",
    cta_label: "Access Intelligence Demo",
    tone: "direct",
    compliance_footer: "Reply STOP to unsubscribe. DatIQ Inc.",
  };

  const sampleProspectsRaw = [
    {
      first_name: "Elena",
      last_name: "Rostova",
      email: " Elena.Rostova@ApexTech.io ",
      phone: "+1 (555) 234-5678",
      company: "Apex Tech",
      role: "VP Engineering",
      industry: "Fintech",
      channel_preference: "email",
    },
    {
      first_name: "Vikram",
      last_name: "Patel",
      email: "vikram@finscale.in",
      phone: "+91 98765 43210",
      company: "FinScale",
      role: "Founder & CEO",
      industry: "B2B SaaS",
      channel_preference: "whatsapp",
    },
    // Duplicate of Elena with different casing
    {
      first_name: "Elena",
      last_name: "Rostova",
      email: "elena.rostova@apextech.io",
      phone: "+15552345678",
      company: "Apex Tech",
    },
  ];

  it("Step 1: Normalizes and deduplicates ingested prospect records", () => {
    const { unique, duplicates } = dedupeProspects(sampleProspectsRaw, []);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);

    const elena = unique.find((p) => p.email === "elena.rostova@apextech.io");
    expect(elena).toBeDefined();
    expect(elena.phone).toBe("+15552345678");
  });

  it("Step 2: Generates compliant multi-channel copy variants with guardrails", () => {
    const prospect = {
      id: "prs_test_01",
      first_name: "Elena",
      last_name: "Rostova",
      company: "Apex Tech",
      role: "VP Engineering",
      industry: "Fintech",
    };

    // Generate Email Variants
    const variants = generatePersonalizedVariants(
      prospect,
      { intent: "cold_intro", channels: [CHANNELS.EMAIL] },
      brandKit
    );
    expect(variants.length).toBeGreaterThanOrEqual(2);
    expect(variants[0].subject).toContain("Apex Tech");
    expect(variants[0].body).toContain("Elena");

    // Guardrail Check
    const guardrailCheck = validateMessageGuardrails(variants[0]);
    expect(guardrailCheck.passed).toBe(true);
    expect(guardrailCheck.violations).toEqual([]);

    // Generate SMS Copy (strict <160 chars for single segment)
    const smsVariants = generatePersonalizedVariants(
      prospect,
      { intent: "cold_intro", channels: [CHANNELS.SMS] },
      brandKit
    );
    expect(smsVariants[0].body.length).toBeLessThanOrEqual(160);
  });

  it("Step 3: Dispatches message through channel router and advances state machine", async () => {
    const prospect = {
      id: "prs_test_01",
      status: PROSPECT_STATUSES.NEW,
      email: "elena@apextech.io",
      phone: "+15552345678",
      channel_preference: "email",
      engagement_score: 0,
    };

    // Transition NEW -> QUEUED
    const queuedRes = transitionProspect(prospect, PROSPECT_STATUSES.QUEUED, {
      eventType: "message_scheduled",
    });
    expect(queuedRes.ok).toBe(true);
    expect(queuedRes.prospect.status).toBe(PROSPECT_STATUSES.QUEUED);
    expect(queuedRes.activity.to_status).toBe(PROSPECT_STATUSES.QUEUED);

    // Dispatch message via channel router
    const resolvedChannel = resolveChannelForProspect(prospect, ["email", "whatsapp"]);
    expect(resolvedChannel).toBe("email");

    const message = {
      id: "msg_test_01",
      channel: "email",
      subject: "Apex Tech Intelligence",
      body: "Hi Elena, here is your intelligence report.",
    };

    const dispatchResult = await dispatchMessage(message, prospect);
    expect(dispatchResult.ok).toBe(true);
    expect(dispatchResult.status).toBe("sent");
    expect(dispatchResult.external_message_id).toBeDefined();

    // Transition QUEUED -> SENT
    const sentRes = transitionProspect(
      queuedRes.prospect,
      PROSPECT_STATUSES.SENT,
      { messageId: message.id, details: { external_id: dispatchResult.external_message_id } }
    );
    expect(sentRes.ok).toBe(true);
    expect(sentRes.prospect.status).toBe(PROSPECT_STATUSES.SENT);
    expect(sentRes.activity.to_status).toBe(PROSPECT_STATUSES.SENT);
  });

  it("Step 4: Processes inbound engagement webhooks and computes engagement score", () => {
    let prospect = {
      id: "prs_test_01",
      status: PROSPECT_STATUSES.SENT,
      engagement_score: 10,
    };

    // Inbound Delivery Webhook -> DELIVERED
    const delivered = transitionProspect(prospect, PROSPECT_STATUSES.DELIVERED);
    expect(delivered.ok).toBe(true);
    expect(delivered.prospect.status).toBe(PROSPECT_STATUSES.DELIVERED);
    prospect = delivered.prospect;

    // Inbound Open Webhook -> OPENED
    const opened = transitionProspect(prospect, PROSPECT_STATUSES.OPENED);
    expect(opened.ok).toBe(true);
    expect(opened.prospect.status).toBe(PROSPECT_STATUSES.OPENED);
    expect(opened.prospect.engagement_score).toBeGreaterThan(prospect.engagement_score);
    prospect = opened.prospect;

    // Inbound Click Webhook -> CLICKED
    const clicked = transitionProspect(prospect, PROSPECT_STATUSES.CLICKED, { details: { url: "https://datiq.app/demo" } });
    expect(clicked.ok).toBe(true);
    expect(clicked.prospect.status).toBe(PROSPECT_STATUSES.CLICKED);
    expect(clicked.prospect.engagement_score).toBeGreaterThan(prospect.engagement_score);
    prospect = clicked.prospect;

    // Inbound Reply Webhook -> REPLIED
    const replied = transitionProspect(prospect, PROSPECT_STATUSES.REPLIED, { details: { reply_text: "Let's schedule a call this Thursday." } });
    expect(replied.ok).toBe(true);
    expect(replied.prospect.status).toBe(PROSPECT_STATUSES.REPLIED);
    expect(replied.prospect.engagement_score).toBeGreaterThan(prospect.engagement_score);
    prospect = replied.prospect;

    // Terminal Conversion -> CONVERTED
    const converted = transitionProspect(prospect, PROSPECT_STATUSES.CONVERTED, { details: { deal_value: 5000 } });
    expect(converted.ok).toBe(true);
    expect(converted.prospect.status).toBe(PROSPECT_STATUSES.CONVERTED);
  });

  it("Step 5: Enforces STOP compliance opt-outs and blocks further transitions", () => {
    let prospect = {
      id: "prs_test_optout",
      status: PROSPECT_STATUSES.DELIVERED,
      engagement_score: 15,
    };

    // User replies STOP -> OPTED_OUT
    const optedOut = transitionProspect(prospect, PROSPECT_STATUSES.OPTED_OUT, {
      details: { reason: "keyword_stop", channel: "sms" },
    });
    expect(optedOut.ok).toBe(true);
    expect(optedOut.prospect.status).toBe(PROSPECT_STATUSES.OPTED_OUT);

    // Any subsequent automatic transition from OPTED_OUT must be rejected
    const illegalAttempt = transitionProspect(optedOut.prospect, PROSPECT_STATUSES.QUEUED);
    expect(illegalAttempt.ok).toBe(false);
    expect(illegalAttempt.error).toBe("compliance_violation_opted_out");
  });

  it("Step 6: Detects stale prospects and flags Follow-Up Due after threshold", () => {
    const staleDate = new Date(Date.now() - 5 * 86400000).toISOString(); // 5 days ago
    const freshDate = new Date(Date.now() - 1 * 86400000).toISOString(); // 1 day ago

    const prospects = [
      { id: "prs_stale", status: PROSPECT_STATUSES.SENT, last_contacted_at: staleDate },
      { id: "prs_fresh", status: PROSPECT_STATUSES.SENT, last_contacted_at: freshDate },
    ];

    const staleList = detectStaleProspects(prospects, 4); // 4 days threshold
    expect(staleList).toHaveLength(1);
    expect(staleList[0].id).toBe("prs_stale");
  });
});
