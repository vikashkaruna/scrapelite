// src/lib/engagement/aiMessageGenerator.test.js
import { describe, it, expect } from "vitest";
import {
  generatePersonalizedVariants,
  validateMessageGuardrails,
  CHANNELS,
} from "./aiMessageGenerator.js";

describe("aiMessageGenerator — variant generation", () => {
  const prospect = {
    first_name: "Alex",
    last_name: "Morgan",
    company: "Acme Cloud",
    role: "VP Product",
    industry: "Enterprise SaaS",
  };

  const campaign = {
    name: "Acme Outreach",
    channels: [CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.SMS],
  };

  const brandKit = {
    company_name: "DatIQ",
    value_prop: "automated web extraction and competitor tracking",
    cta_url: "https://datiq.app/acme",
    cta_label: "View Acme Snapshot",
  };

  it("generates variants across all specified channels", () => {
    const variants = generatePersonalizedVariants(prospect, campaign, brandKit);
    expect(variants.length).toBeGreaterThanOrEqual(4);

    const emailVariants = variants.filter((v) => v.channel === CHANNELS.EMAIL);
    expect(emailVariants.length).toBe(2);
    expect(emailVariants[0].variant).toBe("A");
    expect(emailVariants[1].variant).toBe("B");

    const waVariants = variants.filter((v) => v.channel === CHANNELS.WHATSAPP);
    expect(waVariants.length).toBe(2);

    const smsVariants = variants.filter((v) => v.channel === CHANNELS.SMS);
    expect(smsVariants.length).toBe(1);
  });

  it("injects personalized prospect fields and brand kit into copy", () => {
    const variants = generatePersonalizedVariants(prospect, campaign, brandKit);
    const emailA = variants.find((v) => v.channel === CHANNELS.EMAIL && v.variant === "A");

    expect(emailA.subject).toContain("Acme Cloud");
    expect(emailA.body).toContain("Alex");
    expect(emailA.body).toContain("VP Product");
    expect(emailA.body).toContain("Enterprise SaaS");
    expect(emailA.body).toContain("DatIQ");
    expect(emailA.body).toContain("https://datiq.app/acme");
  });

  it("enforces SMS length constraint (under 160 chars for single segment)", () => {
    const variants = generatePersonalizedVariants(prospect, campaign, brandKit);
    const sms = variants.find((v) => v.channel === CHANNELS.SMS);
    expect(sms.body.length).toBeLessThanOrEqual(160);
    expect(sms.body).toContain("STOP");
  });
});

describe("aiMessageGenerator — guardrails & compliance validation", () => {
  it("flags banned spam keywords", () => {
    const spamDraft = {
      channel: CHANNELS.EMAIL,
      subject: "Hello there",
      body: "We offer a 100% free guaranteed way to double revenue! Reply STOP to opt out.",
    };

    const res = validateMessageGuardrails(spamDraft);
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.includes("Forbidden spam trigger"))).toBe(true);
  });

  it("requires opt-out clause on SMS and WhatsApp", () => {
    const noOptOutSms = {
      channel: CHANNELS.SMS,
      body: "Check out this link: https://datiq.app",
    };

    const res = validateMessageGuardrails(noOptOutSms);
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.includes("opt-out disclosure"))).toBe(true);
  });

  it("passes compliant messages with appropriate warnings", () => {
    const compliant = {
      channel: CHANNELS.WHATSAPP,
      body: "Hi Alex, here is your competitor snapshot: https://datiq.app. Reply STOP to opt out.",
    };

    const res = validateMessageGuardrails(compliant);
    expect(res.passed).toBe(true);
    expect(res.violations.length).toBe(0);
  });

  it("flags oversized SMS messages exceeding character limits", () => {
    const longSms = {
      channel: CHANNELS.SMS,
      body: "A".repeat(350) + " Reply STOP to opt out",
    };

    const res = validateMessageGuardrails(longSms);
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.includes("maximum allowable length"))).toBe(true);
  });
});
