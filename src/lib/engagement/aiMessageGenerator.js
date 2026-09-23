// src/lib/engagement/aiMessageGenerator.js — outreach drafts + compliance guardrails
//
// ⚠️ PHASE 1 DRAFTS ARE TEMPLATES, NOT MODEL OUTPUT. Phase 2 (owner decision
// 2026-09-23) keeps these skeletons and has an LLM fill the named slots from
// prospect fields only. Until then the slots are filled directly.
//
// ── THREE RULES THE TEMPLATES OBEY ──────────────────────────────────────────
//
// 1. NO CLAIM THE RECORD DOES NOT SUPPORT. 0081's copy told every prospect
//    "we set up an automated intelligence monitor for {company}. It uncovered a
//    few interesting shifts" — for companies nobody had monitored. That is a
//    fabricated statement sent under the customer's name (review F-11).
//
// 2. PROSPECT DATA IS ESCAPED IN HTML. Names and companies arrive from CSVs,
//    spreadsheets and scraped pages; interpolating them raw into body_html put
//    attacker-controlled markup into outbound email (review F-12).
//
// 3. ONE CHANNEL, ONE VARIANT, PER CALL. 0081 generated two emails, two
//    WhatsApps and an SMS for every prospect and the dispatcher sent all five
//    (review F-2). A/B means different prospects receive different variants —
//    never one prospect receiving both. assignVariant() makes that stable.
//
// The unsubscribe link is the literal `{{unsubscribe_url}}`; emailSender fills
// it with a signed per-recipient URL at send time.

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

/** Escape a value for interpolation into HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip control characters (incl. CR/LF) and cap length — slot values end up in subjects too. */
function clean(value, max = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Only http(s) URLs are allowed as the call to action. */
function safeUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Stable A/B assignment: the same prospect always gets the same variant, so a
 * regenerate never flips someone into the other arm of the test.
 */
export function assignVariant(prospectId, variants = ["A", "B"]) {
  const s = String(prospectId || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return variants[h % variants.length];
}

export const UNSUBSCRIBE_PLACEHOLDER = "{{unsubscribe_url}}";

function slots(prospect = {}, brandKit = {}) {
  const company = clean(prospect.company) || "your team";
  const firstName = clean(prospect.first_name, 60) || "there";
  return {
    firstName,
    company,
    role: clean(prospect.role, 80),
    industry: clean(prospect.industry, 60),
    // No DatIQ default: an unfilled brand kit must not turn a customer's
    // campaign into an advert for DatIQ.
    sender: clean(brandKit.company_name, 80) || "our team",
    valueProp: clean(brandKit.value_prop, 200),
    ctaUrl: safeUrl(brandKit.cta_url),
    ctaLabel: clean(brandKit.cta_label, 60) || "Learn more",
    signoff: clean(brandKit.signoff_name, 80),
  };
}

function emailDraft(variant, s) {
  const roleLine = s.role ? ` as ${s.role}` : "";
  const valueLine = s.valueProp ? `At ${s.sender}, we offer ${s.valueProp}.` : `I'm getting in touch from ${s.sender}.`;
  const cta = s.ctaUrl ? `${s.ctaLabel}: ${s.ctaUrl}` : "Would a short call next week be useful?";
  const sign = s.signoff ? `${s.signoff}\n${s.sender}` : `The ${s.sender} team`;

  const subject = variant === "B"
    ? `A question for ${s.company}`
    : `${s.sender} × ${s.company}`;

  const opening = variant === "B"
    ? `Hi ${s.firstName},\n\nA quick question for you${roleLine} at ${s.company}: is this something your team is looking at this quarter?`
    : `Hi ${s.firstName},\n\nI'm reaching out to you${roleLine} at ${s.company}${s.industry ? `, given your work in ${s.industry}` : ""}.`;

  const body = `${opening}\n\n${valueLine}\n\n${cta}\n\nBest regards,\n${sign}\n\n---\nIf you'd rather not hear from us, unsubscribe here: ${UNSUBSCRIBE_PLACEHOLDER}`;

  const e = (v) => escapeHtml(v);
  const openingHtml = variant === "B"
    ? `<p>Hi ${e(s.firstName)},</p><p>A quick question for you${e(roleLine)} at ${e(s.company)}: is this something your team is looking at this quarter?</p>`
    : `<p>Hi ${e(s.firstName)},</p><p>I'm reaching out to you${e(roleLine)} at ${e(s.company)}${s.industry ? `, given your work in ${e(s.industry)}` : ""}.</p>`;
  const ctaHtml = s.ctaUrl
    ? `<p><a href="${e(s.ctaUrl)}">${e(s.ctaLabel)}</a></p>`
    : `<p>Would a short call next week be useful?</p>`;
  const signHtml = s.signoff ? `${e(s.signoff)}<br/>${e(s.sender)}` : `The ${e(s.sender)} team`;
  const bodyHtml = `${openingHtml}<p>${e(valueLine)}</p>${ctaHtml}<p>Best regards,<br/>${signHtml}</p>`
    + `<hr/><p style="font-size:11px;color:#888">If you'd rather not hear from us, <a href="${UNSUBSCRIBE_PLACEHOLDER}">unsubscribe here</a>.</p>`;

  return { subject, body, bodyHtml };
}

function shortDraft(channel, variant, s) {
  const cta = s.ctaUrl ? ` ${s.ctaUrl}` : "";
  if (channel === CHANNELS.SMS) {
    return `Hi ${s.firstName}, ${s.sender} here.${cta} Reply STOP to opt out`;
  }
  const opener = variant === "B"
    ? `Hi ${s.firstName}, a quick question for ${s.company} from ${s.sender}.`
    : `Hi ${s.firstName}, this is ${s.sender} reaching out to ${s.company}.`;
  const value = s.valueProp ? ` We offer ${s.valueProp}.` : "";
  const stop = channel === CHANNELS.TELEGRAM ? "" : "\n\nReply STOP to opt out.";
  return `${opener}${value}${cta}${stop}`;
}

/**
 * Build outreach drafts for one prospect.
 *
 * @param {object} prospect
 * @param {object} campaign  { intent?, channels? }
 * @param {object} brandKit  { company_name, value_prop, cta_url, cta_label, signoff_name }
 * @param {{ channels?: string[], variants?: string[] }} [opts]
 *   Callers that SEND must pass exactly one channel and one variant
 *   (see assignVariant). The defaults exist for previews.
 * @returns {Array<{ channel, variant, subject, body, bodyHtml, guardrails }>}
 */
export function generatePersonalizedVariants(prospect = {}, campaign = {}, brandKit = {}, opts = {}) {
  const s = slots(prospect, brandKit || {});
  const channels = opts.channels || campaign.channels || [CHANNELS.EMAIL];
  const variants = opts.variants || ["A", "B"];
  const out = [];

  for (const channel of channels) {
    if (!Object.values(CHANNELS).includes(channel)) continue;
    // SMS and Telegram carry one variant: at 160 characters there is no room
    // for two meaningfully different messages.
    const vs = channel === CHANNELS.EMAIL || channel === CHANNELS.WHATSAPP ? variants : [variants[0]];
    for (const variant of vs) {
      if (channel === CHANNELS.EMAIL) {
        const d = emailDraft(variant, s);
        out.push({
          channel, variant, subject: d.subject, body: d.body, bodyHtml: d.bodyHtml,
          guardrails: validateMessageGuardrails({ channel, subject: d.subject, body: d.body }),
        });
      } else {
        const body = shortDraft(channel, variant, s);
        out.push({
          channel, variant, subject: null, body, bodyHtml: null,
          guardrails: validateMessageGuardrails({ channel, body }),
        });
      }
    }
  }
  return out;
}
