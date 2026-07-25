// contactWebhook.js — fire-and-forget POST of a contact submission to the
// CRM/automation pipeline.
//
// SCAFFOLDING. The downstream endpoint is not built yet: today this posts to
// VITE_CONTACT_WEBHOOK_URL when set, otherwise to the generic VITE_WEBHOOK_URL,
// otherwise it no-ops. The event envelope below is the contract the future
// pipeline should consume — keep `event`, `sent_at`, and `data` stable when
// wiring the real endpoint so consumers don't have to change.
//
// This path must NEVER block or fail a contact submission: the email (via
// Web3Forms) is the delivery guarantee, this is best-effort enrichment.

import { CONTACT_WEBHOOK_URL } from "./config.js";

export const CONTACT_WEBHOOK_EVENT = "contact.submitted";

/**
 * Build the webhook envelope for a contact submission. Exported separately so
 * the payload contract is testable without a network round-trip.
 */
export function buildContactWebhookPayload(submission, now = Date.now()) {
  const {
    type, inbox, routeTo, name, email, subject, message, source,
  } = submission || {};
  return {
    event: CONTACT_WEBHOOK_EVENT,
    sent_at: new Date(now).toISOString(),
    data: {
      type: type || "",
      inbox: inbox || "",
      route_to: routeTo || "",
      name: name || "",
      email: email || "",
      subject: subject || "",
      message: message || "",
      source: source || "contact-form",
    },
  };
}

/**
 * POST the submission to the contact webhook. Resolves to a result object and
 * never rejects — callers can safely leave it un-awaited.
 *
 * @returns {Promise<{delivered: boolean, skipped?: boolean, reason?: string}>}
 */
export async function notifyContactWebhook(submission, opts = {}) {
  const url = opts.url ?? CONTACT_WEBHOOK_URL;
  if (!url) return { delivered: false, skipped: true, reason: "not-configured" };

  const doFetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch) return { delivered: false, skipped: true, reason: "no-fetch" };

  try {
    await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildContactWebhookPayload(submission, opts.now)),
      // Don't hold the page open waiting on the automation pipeline.
      keepalive: true,
    });
    return { delivered: true };
  } catch (err) {
    console.warn("[DatIQ] Contact webhook delivery failed:", err);
    return { delivered: false, reason: "network-error" };
  }
}
