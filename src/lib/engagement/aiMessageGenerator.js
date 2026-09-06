// src/lib/engagement/aiMessageGenerator.js — AI Personalized Message Generation & Guardrails
//
// Implements the message generation sub-workflow from DatIQ - Prospect Engagement Engine.md:
//   - Structured input: prospect attributes + campaign intent + brand kit
//   - Multi-variant A/B output (Variant A: Direct/Value, Variant B: Insight/Challenge)
//   - Channel formatting: Email (HTML/MD), WhatsApp (conversational), Telegram, SMS (160 char bounded)
//   - Compliance Guardrail Layer: Spam phrase detection, length limits, mandatory opt-out notices.

export const CAMPAIGN_INTENTS = {
  COLD_INTRO: "cold_intro",
  FOLLOW_UP: "follow_up",
  EVENT_INVITE: "event_invite",
  COMPETITIVE_INTEL: "competitive_intel",
  RENEWAL_REMINDER: "renewal_reminder",
};

export const CHANNELS = {
  EMAIL: "email",
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram",
  SMS: "sms",
};

export const BANNED_SPAM_PHRASES = [
  "100% free guaranteed",
  "make money fast",
  "risk free guarantee",
  "act now before it is too late",
  "congratulations you won",
  "no catch guaranteed",
  "crypto giveaway",
  "wire transfer immediately",
];

export const CHANNEL_LIMITS = {
  [CHANNELS.SMS]: {
    singleSegment: 160,
    maxChars: 320,
    requiresOptOut: true,
  },
  [CHANNELS.WHATSAPP]: {
    maxChars: 1024,
    requiresOptOut: true,
  },
  [CHANNELS.TELEGRAM]: {
    maxChars: 4096,
    requiresOptOut: false,
  },
  [CHANNELS.EMAIL]: {
    maxChars: 10000,
    maxSubjectChars: 120,
    requiresOptOut: true,
  },
};

/**
 * Validates a message draft against compliance rules and channel constraints.
 *
 * @param {object} message Draft containing { channel, subject?, body }
 * @returns {{ passed: boolean, violations: string[], warnings: string[] }}
 */
export function validateMessageGuardrails(message) {
  const channel = message.channel || CHANNELS.EMAIL;
  const limits = CHANNEL_LIMITS[channel] || CHANNEL_LIMITS[CHANNELS.EMAIL];
  const body = (message.body || "").trim();
  const subject = (message.subject || "").trim();
  const lowerBody = body.toLowerCase();
  const violations = [];
  const warnings = [];

  if (!body) {
    violations.push("Message body cannot be empty");
    return { passed: false, violations, warnings };
  }

  // 1. Length constraint checks
  if (channel === CHANNELS.SMS) {
    if (body.length > limits.maxChars) {
      violations.push(`SMS exceeds maximum allowable length (${body.length}/${limits.maxChars} chars).`);
    } else if (body.length > limits.singleSegment) {
      warnings.push(`SMS exceeds single message segment (${body.length}/${limits.singleSegment} chars); carrier will bill as 2 segments.`);
    }
  } else if (body.length > limits.maxChars) {
    violations.push(`${channel.toUpperCase()} message exceeds length limit (${body.length}/${limits.maxChars} chars).`);
  }

  if (channel === CHANNELS.EMAIL) {
    if (!subject) {
      violations.push("Email subject line is required.");
    } else if (subject.length > limits.maxSubjectChars) {
      warnings.push(`Email subject is long (${subject.length} chars); may be truncated in mobile inboxes.`);
    }
  }

  // 2. Banned spam phrases
  for (const phrase of BANNED_SPAM_PHRASES) {
    if (lowerBody.includes(phrase) || (subject && subject.toLowerCase().includes(phrase))) {
      violations.push(`Forbidden spam trigger phrase detected: "${phrase}".`);
    }
  }

  // 3. Mandatory Opt-out / Compliance Disclosure
  if (limits.requiresOptOut) {
    if (channel === CHANNELS.SMS || channel === CHANNELS.WHATSAPP) {
      const hasStop = /\bstop\b/i.test(body) || /\bopt-out\b/i.test(body) || /\bunsubscribe\b/i.test(body);
      if (!hasStop) {
        violations.push(`${channel.toUpperCase()} requires an opt-out disclosure (e.g. "Reply STOP to opt out").`);
      }
    } else if (channel === CHANNELS.EMAIL) {
      const hasUnsub = /unsubscribe/i.test(body) || /opt-out/i.test(body) || /privacy/i.test(body);
      if (!hasUnsub) {
        warnings.push("Email should include an unsubscribe or preferences link to comply with CAN-SPAM / GDPR.");
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
  };
}

export const validateComplianceGuardrails = validateMessageGuardrails;

/**
 * Deterministically constructs personalized outreach variants for a prospect.
 * In production, this can call an LLM (Claude, OpenAI, Gemini), but it provides
 * clean, reliable template-guided copy generation when operating offline or mock.
 *
 * @param {object} prospect
 * @param {object} campaign
 * @param {object} brandKit
 * @returns {Array<object>} Array of message variants (Variant A & Variant B)
 */
export function generatePersonalizedVariants(prospect = {}, campaign = {}, brandKit = {}) {
  const firstName = prospect.first_name || (prospect.company ? `Team ${prospect.company}` : "there");
  const company = prospect.company || "your team";
  const role = prospect.role ? ` as ${prospect.role}` : "";
  const industry = prospect.industry || "B2B";
  const senderCompany = brandKit.company_name || "DatIQ";
  const valueProp = brandKit.value_prop || "real-time web intelligence and structured competitive signals";
  const ctaUrl = brandKit.cta_url || "https://datiq.app";
  const ctaLabel = brandKit.cta_label || "View Live Intelligence";
  const intent = campaign.intent || CAMPAIGN_INTENTS.COLD_INTRO;

  // Determine channels requested
  const channels = campaign.channels || [CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.SMS];

  const variants = [];

  for (const channel of channels) {
    if (channel === CHANNELS.EMAIL) {
      // Variant A: Direct Value & ROI
      const subjectA = `Streamlining competitive intelligence for ${company}`;
      const bodyA = `Hi ${firstName},

I noticed your work at ${company}${role}. Companies in the ${industry} space often spend hours manually tracking competitor movements, pricing shifts, and account signals.

At ${senderCompany}, we provide ${valueProp} — giving your team automated daily visibility without manual scraping.

Would you be open to a brief look at what we've synthesized for ${company}?

${ctaLabel}: ${ctaUrl}

Best regards,
The ${senderCompany} Team

---
To unsubscribe or adjust preferences, reply "Unsubscribe" or visit ${ctaUrl}/privacy`;

      // Variant B: Insight & Challenge
      const subjectB = `Quick question regarding ${company}'s market tracking`;
      const bodyB = `Hi ${firstName},

When competitors in ${industry} adjust their packaging or launch new offerings, how quickly does ${company} pick up on the delta?

We set up an automated intelligence monitor for ${company} using ${senderCompany}. It uncovered a few interesting shifts that your team might want to see:

${ctaLabel}: ${ctaUrl}

Happy to share the brief breakdown if you find it helpful.

Warmly,
The ${senderCompany} Team

---
To opt-out of future updates, reply "Unsubscribe".`;

      variants.push(
        {
          channel: CHANNELS.EMAIL,
          variant: "A",
          subject: subjectA,
          body: bodyA,
          bodyHtml: `<p>Hi ${firstName},</p><p>I noticed your work at ${company}${role}. Companies in the ${industry} space often spend hours manually tracking competitor movements, pricing shifts, and account signals.</p><p>At <strong>${senderCompany}</strong>, we provide ${valueProp}.</p><p><a href="${ctaUrl}">${ctaLabel}</a></p><p>Best regards,<br/>The ${senderCompany} Team</p><hr/><p style="font-size: 11px; color: #888;">To unsubscribe, reply "Unsubscribe" or visit <a href="${ctaUrl}/privacy">privacy</a>.</p>`,
          guardrails: validateMessageGuardrails({ channel: CHANNELS.EMAIL, subject: subjectA, body: bodyA }),
        },
        {
          channel: CHANNELS.EMAIL,
          variant: "B",
          subject: subjectB,
          body: bodyB,
          bodyHtml: `<p>Hi ${firstName},</p><p>When competitors in ${industry} adjust their packaging, how quickly does ${company} pick up on the delta?</p><p>We set up an automated monitor for ${company} with ${senderCompany}:</p><p><a href="${ctaUrl}">${ctaLabel}</a></p><p>Warmly,<br/>The ${senderCompany} Team</p><hr/><p style="font-size: 11px; color: #888;">To opt-out of future updates, reply "Unsubscribe".</p>`,
          guardrails: validateMessageGuardrails({ channel: CHANNELS.EMAIL, subject: subjectB, body: bodyB }),
        }
      );
    } else if (channel === CHANNELS.WHATSAPP) {
      // Variant A
      const bodyWaA = `Hi ${firstName}! 👋 Noticed your focus at *${company}*. We built an automated feed with ${senderCompany} tracking ${industry} market shifts and competitor pricing.

Check your snapshot here: ${ctaUrl}

Reply STOP to opt out.`;

      // Variant B
      const bodyWaB = `Hey ${firstName}, quick insight for *${company}* — we track competitor changes across ${industry} so RevOps teams don't miss pricing moves.

Explore the live brief: ${ctaUrl}

Reply STOP to opt out.`;

      variants.push(
        {
          channel: CHANNELS.WHATSAPP,
          variant: "A",
          subject: null,
          body: bodyWaA,
          bodyHtml: null,
          guardrails: validateMessageGuardrails({ channel: CHANNELS.WHATSAPP, body: bodyWaA }),
        },
        {
          channel: CHANNELS.WHATSAPP,
          variant: "B",
          subject: null,
          body: bodyWaB,
          bodyHtml: null,
          guardrails: validateMessageGuardrails({ channel: CHANNELS.WHATSAPP, body: bodyWaB }),
        }
      );
    } else if (channel === CHANNELS.TELEGRAM) {
      const bodyTgA = `Hi ${firstName}! 🚀 Tracking market & competitor moves for ${company}? We put together a structured intelligence report via ${senderCompany}: ${ctaUrl}`;
      variants.push({
        channel: CHANNELS.TELEGRAM,
        variant: "A",
        subject: null,
        body: bodyTgA,
        bodyHtml: null,
        guardrails: validateMessageGuardrails({ channel: CHANNELS.TELEGRAM, body: bodyTgA }),
      });
    } else if (channel === CHANNELS.SMS) {
      // Strict 160 char limit
      const bodySmsA = `Hi ${firstName}, ${senderCompany} synthesized market shifts for ${company}. See brief: ${ctaUrl} Reply STOP to opt out`;
      variants.push({
        channel: CHANNELS.SMS,
        variant: "A",
        subject: null,
        body: bodySmsA,
        bodyHtml: null,
        guardrails: validateMessageGuardrails({ channel: CHANNELS.SMS, body: bodySmsA }),
      });
    }
  }

  return variants;
}
