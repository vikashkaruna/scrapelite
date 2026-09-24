// src/lib/engagement/aiMessageGenerator.test.js
import { describe, it, expect } from "vitest";
import {
  generatePersonalizedVariants,
  validateMessageGuardrails,
  assignVariant,
  escapeHtml,
  UNSUBSCRIBE_PLACEHOLDER,
  CHANNELS,
} from "./aiMessageGenerator.js";

const prospect = {
  id: "p-1",
  first_name: "Alex",
  company: "Acme Cloud",
  role: "VP Product",
  industry: "Enterprise SaaS",
};
const brandKit = {
  company_name: "Northwind",
  value_prop: "same-day payroll for small teams",
  cta_url: "https://northwind.test/demo",
  cta_label: "See a demo",
};

describe("drafts — one channel, one variant, per call (review F-2)", () => {
  it("returns exactly what was asked for", () => {
    const v = generatePersonalizedVariants(prospect, {}, brandKit, { channels: [CHANNELS.EMAIL], variants: ["B"] });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ channel: "email", variant: "B" });
  });

  it("defaults to email only — never a fan-out across channels", () => {
    const v = generatePersonalizedVariants(prospect, {}, brandKit);
    expect(new Set(v.map((x) => x.channel))).toEqual(new Set(["email"]));
  });

  it("assigns the same variant to the same prospect every time, and uses both arms", () => {
    expect(assignVariant("p-1")).toBe(assignVariant("p-1"));
    const arms = new Set(Array.from({ length: 50 }, (_, i) => assignVariant(`prospect-${i}`)));
    expect(arms).toEqual(new Set(["A", "B"]));
  });

  it("SMS stays within one segment and carries an opt-out", () => {
    const [sms] = generatePersonalizedVariants(prospect, {}, brandKit, { channels: [CHANNELS.SMS] });
    expect(sms.body.length).toBeLessThanOrEqual(160);
    expect(sms.body).toContain("STOP");
    expect(sms.guardrails.passed).toBe(true);
  });
});

describe("drafts — no invented claims, no borrowed brand (review F-11)", () => {
  it("never claims monitoring or findings the record does not support", () => {
    for (const variant of ["A", "B"]) {
      const [e] = generatePersonalizedVariants(prospect, {}, brandKit, { channels: ["email"], variants: [variant] });
      expect(e.body).not.toMatch(/monitor|uncovered|synthesi[sz]ed|we (set up|noticed)|shifts/i);
      expect(e.guardrails.passed).toBe(true);
    }
  });

  it("does not default to DatIQ when the brand kit is empty", () => {
    const [e] = generatePersonalizedVariants(prospect, {}, {}, { channels: ["email"], variants: ["A"] });
    expect(`${e.subject} ${e.body} ${e.bodyHtml}`).not.toMatch(/datiq/i);
  });

  it("uses the brand kit fields the editor saves", () => {
    const [e] = generatePersonalizedVariants(prospect, {}, brandKit, { channels: ["email"], variants: ["A"] });
    expect(e.body).toContain("Northwind");
    expect(e.body).toContain("same-day payroll for small teams");
    expect(e.body).toContain("https://northwind.test/demo");
  });

  it("carries the unsubscribe placeholder in both parts", () => {
    const [e] = generatePersonalizedVariants(prospect, {}, brandKit, { channels: ["email"], variants: ["A"] });
    expect(e.body).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(e.bodyHtml).toContain(UNSUBSCRIBE_PLACEHOLDER);
  });
});

describe("drafts — prospect data is untrusted (review F-12)", () => {
  const hostile = {
    id: "p-2",
    first_name: '<img src=x onerror="alert(1)">',
    company: "Acme\r\nBcc: everyone@x.test",
  };

  it("escapes prospect fields in HTML", () => {
    const [e] = generatePersonalizedVariants(hostile, {}, brandKit, { channels: ["email"], variants: ["A"] });
    expect(e.bodyHtml).not.toContain("<img");
    expect(e.bodyHtml).toContain("&lt;img");
  });

  it("strips line breaks so a field cannot become a header", () => {
    const [e] = generatePersonalizedVariants(hostile, {}, brandKit, { channels: ["email"], variants: ["B"] });
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it("drops a non-http call-to-action link", () => {
    const [e] = generatePersonalizedVariants(prospect, {}, { ...brandKit, cta_url: "javascript:alert(1)" }, { channels: ["email"], variants: ["A"] });
    expect(`${e.body}${e.bodyHtml}`).not.toContain("javascript:");
  });

  it("escapeHtml covers the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
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

  it("flags completely empty body as a violation", () => {
    const emptyDraft = { channel: CHANNELS.EMAIL, subject: "Hello", body: "   " };
    const res = validateMessageGuardrails(emptyDraft);
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.includes("cannot be empty"))).toBe(true);
  });

  it("warns when subject line length exceeds 120 characters", () => {
    const longSubjectDraft = {
      channel: CHANNELS.EMAIL,
      subject: "A".repeat(125),
      body: "Just a standard email body here. Unsubscribe",
    };
    const res = validateMessageGuardrails(longSubjectDraft);
    expect(res.warnings.some((w) => w.includes("subject is long"))).toBe(true);
  });
});
