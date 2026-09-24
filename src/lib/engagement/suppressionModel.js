// src/lib/engagement/suppressionModel.js — who may NOT be contacted, and on what.
//
// PURE. Imported by the React dashboard AND by netlify/ (the dispatcher, the
// webhook, the unsubscribe page), the same way entitlementModel.js is — so the
// "opted out" the dashboard shows and the "opted out" the sender obeys cannot
// be computed by two different pieces of code.
//
// ── THE RULES ───────────────────────────────────────────────────────────────
//
// 1. CONSENT IS PER CHANNEL (owner decision, 2026-09-23). "Stop emailing me"
//    is not "stop texting me". Opting out of several channels is several rows.
//
// 2. CONSENT IS ABOUT A PERSON, NOT A CAMPAIGN ROW. A suppression is keyed by
//    (tenant, channel, normalised address) and applies to every campaign that
//    tenant runs. 0081 stored it as a prospect status, so the same person in a
//    second campaign was still contactable.
//
// 3. A SUPPRESSION IS CHECKED AT SEND TIME, never only at approval. Approval
//    can happen days before the send; the recipient can say STOP in between.
//
// 4. NORMALISE BEFORE COMPARING. "A@x.com" and "a@x.com" are one person; a
//    suppression that misses on case is a message sent to someone who asked
//    us to stop.

export const SUPPRESSION_CHANNELS = Object.freeze(["email", "whatsapp", "sms", "telegram"]);

/** Channels that can actually send today (Phase 1: email only). */
export const LIVE_CHANNELS = Object.freeze(["email"]);

export const SUPPRESSION_REASONS = Object.freeze({
  UNSUBSCRIBE: "unsubscribe",
  STOP_KEYWORD: "stop_keyword",
  BOUNCE: "bounce",
  COMPLAINT: "complaint",
  MANUAL: "manual",
});

/** Reasons the RECIPIENT caused. These are their words, not the tenant's. */
export const RECIPIENT_REASONS = Object.freeze([
  SUPPRESSION_REASONS.UNSUBSCRIBE,
  SUPPRESSION_REASONS.STOP_KEYWORD,
  SUPPRESSION_REASONS.COMPLAINT,
]);

export const REASON_LABELS = Object.freeze({
  unsubscribe: "Unsubscribed",
  stop_keyword: "Replied STOP",
  bounce: "Address bounced",
  complaint: "Marked as spam",
  manual: "Opted out by your team",
});

export const CHANNEL_LABELS = Object.freeze({
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  telegram: "Telegram",
});

/**
 * Where each channel's address lives on a prospect.
 * ⚠️ Telegram is NOT reachable by phone number: a bot can only message a chat
 * id, and only after that user has started the bot (review F-18). 0081 treated
 * a phone as a Telegram address, which would have made "stop every channel"
 * incomplete for anyone with a phone.
 */
const ADDRESS_OF = {
  email: (p) => p.email,
  whatsapp: (p) => p.phone,
  sms: (p) => p.phone,
  telegram: (p) => p.custom_attributes?.telegram_chat_id,
};

/**
 * Normalise an address for a channel. Returns null when there is nothing
 * usable — a null address can never be suppressed OR contacted.
 */
export function normalizeAddress(channel, value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (channel === "email") {
    const e = raw.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  }
  if (channel === "telegram") return /^-?\d{3,20}$/.test(raw) ? raw : null;
  // Phone-based channels: keep a single leading "+", then digits only.
  const plus = raw.startsWith("+") || raw.startsWith("whatsapp:+");
  const digits = raw.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return plus ? `+${digits}` : digits;
}

/** The normalised address a prospect has on a channel, or null. */
export function addressFor(prospect, channel) {
  const get = ADDRESS_OF[channel];
  if (!get || !prospect) return null;
  return normalizeAddress(channel, get(prospect));
}

export function suppressionKey(channel, address) {
  return `${channel}:${address}`;
}

/** Index a list of suppression rows for O(1) lookups. */
export function indexSuppressions(rows = []) {
  const map = new Map();
  for (const r of rows || []) {
    if (r?.channel && r?.address) map.set(suppressionKey(r.channel, r.address), r);
  }
  return map;
}

/**
 * The suppression that blocks `prospect` on `channel`, or null.
 * `index` is the Map from indexSuppressions().
 */
export function findSuppression(index, prospect, channel) {
  const address = addressFor(prospect, channel);
  if (!address) return null;
  return index.get(suppressionKey(channel, address)) || null;
}

/**
 * Rows to write when a prospect is opted out of `channels`. A channel the
 * prospect has no address on produces no row — there is nothing to suppress,
 * and a row keyed on nothing would block nobody.
 */
export function optOutRows({ userId, prospect, channels, reason, source, note = null }) {
  const out = [];
  const seen = new Set();
  for (const channel of channels || []) {
    if (!SUPPRESSION_CHANNELS.includes(channel)) continue;
    const address = addressFor(prospect, channel);
    if (!address) continue;
    const key = suppressionKey(channel, address);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      user_id: userId,
      channel,
      address,
      reason,
      source,
      prospect_id: prospect?.id || null,
      note,
    });
  }
  return out;
}

/**
 * May the TENANT remove this suppression from the dashboard?
 *
 * This is a compliance decision, not a technical one, and it is the only thing
 * standing between a recipient's "stop" and the next campaign. Consider:
 *   - `reason`: who caused it — see RECIPIENT_REASONS vs "bounce" vs "manual".
 *   - A recipient who unsubscribed and later asks to be re-added is real; a
 *     tenant re-adding someone to hit a quota is also real, and looks identical.
 *   - A "bounce" means the address did not exist — lifting it re-sends to a dead
 *     address and damages the sender's reputation, but addresses do get fixed.
 *
 * @param {{ reason: string, source?: string, created_at?: string }} suppression
 * @returns {boolean}
 */
export function canLiftSuppression(suppression) {
  // TODO(owner): decide which suppressions a tenant may lift from the dashboard.
  // Conservative default until then: nothing is liftable.
  void suppression;
  return false;
}

/**
 * Per-channel consent state for one prospect — what the dashboard renders.
 * Channels the prospect has no address on are reported with `address: null`
 * so the UI can say "no phone on file" instead of silently omitting a row.
 */
export function consentStatus(prospect, index) {
  return SUPPRESSION_CHANNELS.map((channel) => {
    const address = addressFor(prospect, channel);
    const s = address ? index.get(suppressionKey(channel, address)) || null : null;
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      address,
      live: LIVE_CHANNELS.includes(channel),
      suppressed: Boolean(s),
      reason: s?.reason || null,
      reasonLabel: s ? REASON_LABELS[s.reason] || s.reason : null,
      since: s?.created_at || null,
      liftable: s ? canLiftSuppression(s) : false,
    };
  });
}
