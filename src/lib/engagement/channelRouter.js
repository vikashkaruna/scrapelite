// src/lib/engagement/channelRouter.js — which channel can reach this prospect?
//
// PURE and shared by the dashboard and the server. It decides; it never sends.
//
// ⚠️ SENDING MOVED TO netlify/functions/lib/engagement/emailSender.js.
// This file used to hold `dispatchMessage`, which (a) carried Twilio/Resend
// credential handling in a module that ships to the browser, and (b) returned
// `ok: true, status: "sent"` with a fabricated id whenever a provider key was
// missing — so an unconfigured channel was reported as delivered (review F-4).
// Do not add a send path back here.

import { addressFor, LIVE_CHANNELS } from "./suppressionModel.js";

export const DEFAULT_CHANNEL_PRIORITY = Object.freeze(["email", "whatsapp", "sms"]);

/**
 * The first channel, in preference then campaign-priority order, on which the
 * prospect has a usable address.
 *
 * @param {object} prospect { email, phone, channel_preference }
 * @param {string[]} channelPriority campaign order, e.g. ["email", "whatsapp", "sms"]
 * @param {{ liveOnly?: boolean }} [opts] liveOnly: consider only channels that can send today
 * @returns {string|null}
 */
export function resolveChannelForProspect(prospect = {}, channelPriority = DEFAULT_CHANNEL_PRIORITY, opts = {}) {
  const usable = (ch) => (!opts.liveOnly || LIVE_CHANNELS.includes(ch)) && Boolean(addressFor(prospect, ch));
  const pref = prospect?.channel_preference;
  if (pref && pref !== "auto" && usable(pref)) return pref;
  for (const ch of channelPriority || []) {
    if (usable(ch)) return ch;
  }
  return null;
}
