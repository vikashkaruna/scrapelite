// netlify/functions/lib/engagement/optOut.js — the ONE way a contact is opted out.
//
// Three callers: the dashboard (a tenant opting a contact out), the public
// unsubscribe page (the recipient), and the Resend webhook (bounce/complaint).
// They share this function so "opted out" means the same thing whoever caused it.
//
// Per channel (owner decision 2026-09-23): each channel is its own row. The
// prospect's funnel STATUS becomes `opted_out` only when every channel the
// prospect can be reached on is suppressed — opting out of email alone leaves
// a WhatsApp-reachable prospect in the funnel, but no email will ever send.

import { serviceDb, updateProspectStatus } from "./engagementStore.js";
import {
  optOutRows, addressFor, SUPPRESSION_CHANNELS, suppressionKey,
} from "../../../../src/lib/engagement/suppressionModel.js";
import { PROSPECT_STATUSES } from "../../../../src/lib/engagement/stateMachine.js";

/**
 * @param {object} args
 * @param {string} args.userId        the TENANT whose list this lands on
 * @param {object} args.prospect      a prospect row (may be a stub { email } / { phone })
 * @param {string[]} args.channels
 * @param {string} args.reason        see SUPPRESSION_REASONS
 * @param {string} args.source        e.g. "dashboard", "unsubscribe_page", "resend_webhook"
 * @param {string} [args.note]
 */
export async function applyOptOut({ userId, prospect, channels, reason, source, note = null }, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, status: 503, code: "store_unconfigured" };

  const rows = optOutRows({ userId, prospect, channels, reason, source, note });
  if (!rows.length) return { ok: false, status: 400, code: "no_address", error: "This contact has no address on those channels." };

  const { error } = await db.from("engagement_suppressions")
    .upsert(rows, { onConflict: "user_id,channel,address", ignoreDuplicates: true });
  if (error) {
    console.error("[engagement optOut] suppression write failed:", error.message);
    return { ok: false, status: 500, code: "store_error" };
  }

  if (prospect?.id && prospect?.campaign_id) {
    for (const r of rows) {
      await db.from("engagement_activity_log").insert({
        user_id: userId, campaign_id: prospect.campaign_id, prospect_id: prospect.id,
        event_type: "channel_opted_out", channel: r.channel, details: { reason, source, ...(note ? { note } : {}) },
      });
    }

    // Is every reachable channel now suppressed?
    const reachable = SUPPRESSION_CHANNELS
      .map((c) => ({ c, a: addressFor(prospect, c) }))
      .filter((x) => x.a);
    const { data: existing } = await db.from("engagement_suppressions").select("channel,address")
      .eq("user_id", userId).in("address", [...new Set(reachable.map((x) => x.a))]);
    const have = new Set((existing || []).map((s) => suppressionKey(s.channel, s.address)));
    const allSuppressed = reachable.length > 0 && reachable.every((x) => have.has(suppressionKey(x.c, x.a)));

    if (allSuppressed && prospect.status !== PROSPECT_STATUSES.OPTED_OUT) {
      await updateProspectStatus(prospect.id, prospect.campaign_id, userId, PROSPECT_STATUSES.OPTED_OUT, {
        eventType: "opted_out_all_channels", details: { reason, source },
      }, env);
    }
    return { ok: true, suppressed: rows.map((r) => r.channel), allChannels: allSuppressed };
  }
  return { ok: true, suppressed: rows.map((r) => r.channel), allChannels: false };
}
