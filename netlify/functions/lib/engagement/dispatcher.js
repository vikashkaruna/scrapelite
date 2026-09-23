// netlify/functions/lib/engagement/dispatcher.js — the ONLY path a queued
// outreach message takes to a provider.
//
// Two drivers call processQueue(): the dashboard's "Send approved" (bounded by
// the request's time budget) and the `engagement-dispatcher` cron (which
// drains whatever the request did not reach). They are safe to run together
// because the unit of work is claimed per MESSAGE — the bulk-runner pattern.
//
// ── THE ORDER OF CHECKS IS THE POINT ────────────────────────────────────────
//
//   1. CLAIM      queued → sending, conditional UPDATE. Zero rows = someone
//                 else has it. Never read-then-write (review F-1).
//   2. ACCESS     beta gate for the message's owner.
//   3. CHANNEL    live in this phase? (Phase 1: email only)
//   4. ADDRESS    does the prospect still have one?
//   5. CONSENT    suppression list + prospect status — checked HERE, at send
//                 time, because a STOP can arrive after approval (review F-3).
//   6. SENDER     the campaign's sender passes validation.
//   7. CREDITS    the owner can afford it (fails OPEN on infrastructure, like
//                 every other gate — see creditMeter.js's header).
//   8. SEND       with Idempotency-Key = message id.
//   9. RECORD     message → sent + provider id; prospect → sent; charge.
//
// Anything refused at 3–5 is `skipped` (it will never be sent). A sender
// misconfiguration is `failed` and can be retried once fixed. Out of credits
// releases the claim back to `queued` so it goes out after a top-up.
//
// ── A CLAIM THAT DIED ───────────────────────────────────────────────────────
// A function killed between the provider accepting the email and us recording
// it leaves a row in `sending`. After STALE_CLAIM_MS the cron re-claims it and
// sends again with the SAME idempotency key, and Resend returns the original
// email rather than a second one. That is why the key is the message id.

import { serviceDb, updateProspectStatus } from "./engagementStore.js";
import { engagementAccess, validateSender, signUnsubscribeToken, unsubscribeUrl } from "./engagementGuards.js";
import { sendOutreachEmail } from "./emailSender.js";
import {
  LIVE_CHANNELS, addressFor, normalizeAddress,
} from "../../../../src/lib/engagement/suppressionModel.js";
import { PROSPECT_STATUSES } from "../../../../src/lib/engagement/stateMachine.js";
import * as meterLib from "../creditMeter.js";

export const STALE_CLAIM_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
/** Longest a single provider call may take; shrunk to fit what the budget has left. */
const PER_SEND_TIMEOUT_MS = 8_000;
/** Below this, starting another send would only be aborted — stop and leave it queued. */
const MIN_SEND_WINDOW_MS = 2_500;
/** Kept back for recording the outcome of the send in flight. */
const RECORD_RESERVE_MS = 800;
const CREDIT_KIND = { email: "outreach_email" };

const now = () => new Date().toISOString();

/** Statuses a prospect can be in when a message is sent to them. */
const SENDABLE_PROSPECT = [
  PROSPECT_STATUSES.QUEUED, PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.UNRESPONSIVE,
];

async function finish(db, msg, patch) {
  const { error } = await db.from("engagement_messages").update({ ...patch, updated_at: now() })
    .eq("id", msg.id).eq("status", "sending");
  if (error) console.error("[engagement-dispatcher] could not record outcome:", msg.id, error.message);
}

async function claim(db, msg) {
  let q = db.from("engagement_messages")
    .update({ status: "sending", claimed_at: now(), attempts: (msg.attempts || 0) + 1, updated_at: now() })
    .eq("id", msg.id).eq("status", msg.status);
  // A stale re-claim must match the exact claim it is taking over, so two
  // crons cannot both take the same dead send.
  if (msg.status === "sending") q = q.eq("claimed_at", msg.claimed_at);
  const { data, error } = await q.select("*");
  if (error) return null;
  return data && data.length ? data[0] : null;
}

async function logEvent(db, msg, event_type, details = {}) {
  await db.from("engagement_activity_log").insert({
    user_id: msg.user_id, campaign_id: msg.campaign_id, prospect_id: msg.prospect_id,
    message_id: msg.id, event_type, channel: msg.channel, details,
  });
}

/**
 * Send queued messages.
 *
 * @param {object} opts
 * @param {string} [opts.userId]      restrict to one tenant (the dashboard path)
 * @param {string} [opts.campaignId]  restrict to one campaign
 * @param {string[]} [opts.messageIds] restrict to these messages
 * @param {{ remaining: () => number }} opts.deadline  time budget
 * @param {number} [opts.limit]
 * @param {object} [opts.env]
 * @param {Function} [opts.fetchImpl]
 * @param {object} [opts.meter]       injectable creditMeter (tests)
 */
export async function processQueue({
  userId = null, campaignId = null, messageIds = null, deadline, limit = 100,
  env = process.env, fetchImpl, meter = meterLib,
} = {}) {
  const db = serviceDb(env);
  const summary = { sent: 0, simulated: 0, skipped: 0, failed: 0, deferred: 0, claimedByOthers: 0, remaining: 0, results: [] };
  if (!db) return { ok: false, status: 503, code: "store_unconfigured", ...summary };

  let q = db.from("engagement_messages").select("*").eq("status", "queued").eq("approval_status", "approved");
  if (userId) q = q.eq("user_id", userId);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  if (Array.isArray(messageIds) && messageIds.length) q = q.in("id", messageIds);
  const { data: queued, error } = await q.order("created_at", { ascending: true }).limit(limit);
  if (error) {
    console.error("[engagement-dispatcher] queue read failed:", error.message);
    return { ok: false, status: 500, code: "store_error", ...summary };
  }

  let work = queued || [];
  // Only the unscoped (cron) run takes over dead claims; a dashboard click
  // must never pick up another tenant's stale work.
  if (!userId) {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const stale = await db.from("engagement_messages").select("*")
      .eq("status", "sending").lt("claimed_at", staleBefore).limit(limit);
    if (!stale.error) work = [...(stale.data || []), ...work];
  }

  const ctxByUser = new Map();
  const campaignCache = new Map();
  const outOfCredit = new Set();
  const allowed = new Map();

  for (let i = 0; i < work.length; i++) {
    const candidate = work[i];
    // ⚠️ Compare against a MINIMUM window, not the full per-send timeout. The
    // first version required 8.5s free before each send, while the dashboard
    // budget is 7s and the cron's 8s — so neither path could ever send.
    if (deadline && deadline.remaining() < MIN_SEND_WINDOW_MS + RECORD_RESERVE_MS) {
      summary.remaining = work.length - i;
      break;
    }
    if (outOfCredit.has(candidate.user_id)) { summary.deferred += 1; continue; }

    if (!allowed.has(candidate.user_id)) allowed.set(candidate.user_id, engagementAccess(candidate.user_id, env).ok);
    if (!allowed.get(candidate.user_id)) { summary.deferred += 1; continue; }

    const msg = await claim(db, candidate);
    if (!msg) { summary.claimedByOthers += 1; continue; }

    const outcome = await sendOne(db, msg, { env, fetchImpl, meter, ctxByUser, campaignCache, outOfCredit, deadline });
    summary[outcome.kind] += 1;
    if (outcome.mock) summary.simulated += 1;
    summary.results.push({ message_id: msg.id, prospect_id: msg.prospect_id, outcome: outcome.kind, code: outcome.code || null });
  }

  for (const ctx of ctxByUser.values()) {
    try { await meter.flush(ctx, env); } catch { /* metering never breaks the run */ }
  }
  return { ok: true, ...summary };
}

async function sendOne(db, msg, { env, fetchImpl, meter, ctxByUser, campaignCache, outOfCredit, deadline }) {
  const skip = async (code) => {
    await finish(db, msg, { status: "skipped", failure_code: code });
    await logEvent(db, msg, "message_skipped", { code });
    return { kind: "skipped", code };
  };
  const failPermanently = async (code, details = {}) => {
    await finish(db, msg, { status: "failed", failure_code: code });
    await logEvent(db, msg, "message_failed", { code, ...details });
    return { kind: "failed", code };
  };

  if (!LIVE_CHANNELS.includes(msg.channel)) return skip("channel_not_enabled");

  const { data: prospect } = await db.from("engagement_prospects").select("*")
    .eq("id", msg.prospect_id).eq("user_id", msg.user_id).maybeSingle();
  if (!prospect) return skip("prospect_missing");

  const address = addressFor(prospect, msg.channel);
  if (!address) return skip("no_address");

  // ── consent, at send time ──
  if (prospect.status === PROSPECT_STATUSES.OPTED_OUT) return skip("opted_out");
  const { data: sup, error: supErr } = await db.from("engagement_suppressions").select("id,reason")
    .eq("user_id", msg.user_id).eq("channel", msg.channel).eq("address", address).limit(1);
  // 🔴 The one lookup in this file that FAILS CLOSED. If we cannot read the
  // suppression list we cannot know the recipient did not say stop — release
  // the claim and try again later rather than guess.
  if (supErr) {
    await db.from("engagement_messages").update({ status: "queued", updated_at: now() }).eq("id", msg.id).eq("status", "sending");
    return { kind: "deferred", code: "suppression_unreadable" };
  }
  if (sup && sup.length) return skip(`suppressed_${sup[0].reason}`);

  // ── sender ──
  let campaign = campaignCache.get(msg.campaign_id);
  if (!campaign) {
    const { data } = await db.from("engagement_campaigns").select("*").eq("id", msg.campaign_id).eq("user_id", msg.user_id).maybeSingle();
    campaign = data;
    campaignCache.set(msg.campaign_id, campaign);
  }
  if (!campaign) return skip("campaign_missing");
  if (campaign.status !== "active") {
    await db.from("engagement_messages").update({ status: "queued", updated_at: now() }).eq("id", msg.id).eq("status", "sending");
    return { kind: "deferred", code: "campaign_paused" };
  }
  const sender = validateSender(campaign.sender, env);
  if (!sender.ok) return failPermanently(sender.code);

  // ── credits ──
  const kind = CREDIT_KIND[msg.channel];
  const afford = await meter.affords(msg.user_id, 1, env);
  if (!afford.ok) {
    outOfCredit.add(msg.user_id);
    await db.from("engagement_messages").update({ status: "queued", failure_code: "insufficient_credits", updated_at: now() })
      .eq("id", msg.id).eq("status", "sending");
    return { kind: "deferred", code: "insufficient_credits" };
  }

  // ── send ──
  const token = signUnsubscribeToken({
    userId: msg.user_id, prospectId: prospect.id, channel: msg.channel, address: normalizeAddress(msg.channel, address),
  }, env);
  const unsub = unsubscribeUrl(token, env);

  const controller = new AbortController();
  const sendWindow = deadline ? Math.max(1_000, deadline.remaining() - RECORD_RESERVE_MS) : PER_SEND_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), Math.min(PER_SEND_TIMEOUT_MS, sendWindow));
  let res;
  try {
    res = await sendOutreachEmail({
      message: msg, to: address, sender: sender.sender, unsubscribeUrl: unsub, env, fetchImpl, signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.retryable && (msg.attempts || 1) < MAX_ATTEMPTS) {
      await db.from("engagement_messages").update({ status: "queued", failure_code: res.code, updated_at: now() })
        .eq("id", msg.id).eq("status", "sending");
      return { kind: "deferred", code: res.code };
    }
    return failPermanently(res.code, res.status ? { http_status: res.status } : {});
  }

  // ── record ──
  const sentAt = now();
  const { error: recErr } = await db.from("engagement_messages").update({
    status: "sent", sent_at: sentAt, provider: res.mock ? "mock" : res.provider, external_message_id: res.externalId,
    failure_code: null, updated_at: sentAt,
  }).eq("id", msg.id).eq("status", "sending");
  if (recErr) console.error("[engagement-dispatcher] sent but not recorded:", msg.id, recErr.message);

  // A simulated send reached nobody, so it is recorded as provider "mock" (the
  // UI labels it "test mode — not delivered") and it costs nothing.
  if (!res.mock) {
    if (!ctxByUser.has(msg.user_id)) {
      ctxByUser.set(msg.user_id, meter.meterContext({ caller: "engagement-dispatcher", userId: msg.user_id }));
    }
    meter.record(ctxByUser.get(msg.user_id), { kind, quantity: 1, meta: { message_id: msg.id } });
  }

  if (SENDABLE_PROSPECT.includes(prospect.status)) {
    // new → sent is not a legal jump; walk through queued first.
    if (prospect.status === PROSPECT_STATUSES.NEW || prospect.status === PROSPECT_STATUSES.UNRESPONSIVE) {
      await updateProspectStatus(prospect.id, msg.campaign_id, msg.user_id, PROSPECT_STATUSES.QUEUED,
        { channel: msg.channel, messageId: msg.id, eventType: "message_queued" }, env);
    }
    await updateProspectStatus(prospect.id, msg.campaign_id, msg.user_id, PROSPECT_STATUSES.SENT, {
      channel: msg.channel, messageId: msg.id, eventType: "message_sent",
      details: { provider: res.provider, external_message_id: res.externalId, mock: Boolean(res.mock) },
    }, env);
  } else {
    await logEvent(db, msg, "message_sent", { provider: res.provider, external_message_id: res.externalId, mock: Boolean(res.mock) });
  }
  return { kind: "sent", mock: Boolean(res.mock) };
}
