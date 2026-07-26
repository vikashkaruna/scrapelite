// billingNotices.js — WHICH billing notice is due, and WHEN.
//
// Pure and clock-injected so the whole dunning schedule can be tested without a
// cron, a database or a mail provider.
//
// Two properties this file exists to guarantee:
//
//  1. AT MOST ONE NOTICE PER RUN. If the cron misses a few days (an incident, a
//     bad deploy, a disabled schedule) we do NOT then send the three notices
//     that came due while it was down. A customer receiving a burst of billing
//     mail reads as a system malfunction, which is exactly the moment you least
//     want to look broken. Only the most recent applicable notice is sent.
//
//  2. EACH NOTICE FIRES ONCE PER CYCLE. The window_key is derived from the
//     cycle's period_end, never from today — see the header of
//     0017_billing_lifecycle.sql for the bug in reengagement.js that this
//     avoids.
import { DEACTIVATE_AFTER_DAYS, PURGE_AFTER_DAYS, isLifecycleManaged } from "./entitlementModel.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The notice series, in chronological order. `at` is days relative to
 * period_end: negative before expiry, positive after.
 *
 * Requirement 6 asks for a week ahead, two days ahead, and the day itself.
 * Requirement 13 asks for the same shape before deletion.
 */
export const NOTICES = Object.freeze([
  { kind: "renewal_t7",      at: -7,                       phase: "active" },
  { kind: "renewal_t2",      at: -2,                       phase: "active" },
  { kind: "lapsed_d0",       at: 0,                        phase: "suspended" },
  { kind: "suspend_d7",      at: 7,                        phase: "suspended" },
  { kind: "suspend_d21",     at: 21,                       phase: "suspended" },
  { kind: "deactivate_d30",  at: DEACTIVATE_AFTER_DAYS,    phase: "deactivated" },
  { kind: "delete_d83",      at: PURGE_AFTER_DAYS - 7,     phase: "deactivated" },
  { kind: "delete_d88",      at: PURGE_AFTER_DAYS - 2,     phase: "deactivated" },
  { kind: "delete_d90",      at: PURGE_AFTER_DAYS,         phase: "deactivated" },
]);

export const NOTICE_BY_KIND = Object.fromEntries(NOTICES.map((n) => [n.kind, n]));

/**
 * How long after its trigger a notice may still be sent.
 *
 * Wide enough that a couple of missed cron runs do not silently skip a notice —
 * which matters most for delete_d90, since billing-purge refuses to act until
 * it has been sent. Narrow enough that a long outage does not resurrect
 * ancient notices.
 */
export const GRACE_DAYS = 3;

/** ISO date (UTC) of a timestamp — the cycle identifier used in window_key. */
export function cycleKey(periodEnd) {
  const t = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  return Number.isNaN(t.getTime()) ? "unknown" : t.toISOString().slice(0, 10);
}

/** Stable idempotency key: the notice kind plus the CYCLE it belongs to. */
export function windowKeyFor(kind, periodEnd) {
  return `${kind}:${cycleKey(periodEnd)}`;
}

/**
 * The single notice due for this account right now, or null.
 *
 * @param {object} ent  entitlements row
 * @param {Date}   [now]
 * @returns {{kind, at, phase, windowKey, dueAt}|null}
 */
export function pickDueNotice(ent, now = new Date()) {
  // Free and never-paid accounts have no billing cycle and are never dunned.
  if (!isLifecycleManaged(ent)) return null;
  // A purged account has nothing left to warn about.
  if (ent.status === "purged") return null;

  const end = Date.parse(ent.period_end);
  if (!Number.isFinite(end)) return null;

  // An admin comp suppresses the whole series: the account is not actually
  // lapsing while someone is deliberately covering it.
  const comp = ent.comp_until ? Date.parse(ent.comp_until) : null;
  if (Number.isFinite(comp) && comp > now.getTime()) return null;

  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  let best = null;
  for (const n of NOTICES) {
    const dueAt = end + n.at * DAY;
    if (nowMs < dueAt) continue;                       // not yet
    if (nowMs > dueAt + GRACE_DAYS * DAY) continue;    // too late; skip, don't backfill
    // Chronologically later wins → at most one, the most recent.
    if (!best || n.at > best.at) best = { ...n, dueAt };
  }

  if (!best) return null;
  return { ...best, windowKey: windowKeyFor(best.kind, ent.period_end) };
}

/** Subject + body copy for a notice. Kept beside the schedule so they cannot drift. */
export function noticeCopy(kind, { planName = "your plan", endsOn = "", purgeOn = "" } = {}) {
  switch (kind) {
    case "renewal_t7":
      return {
        subject: `${planName} renews in 7 days`,
        heading: "Your subscription renews in a week",
        body: `Your ${planName} subscription ends on ${endsOn}. Renew any time before then to keep everything running without a break — you can also renew early and the remaining days are carried over.`,
        cta: "Renew now",
      };
    case "renewal_t2":
      return {
        subject: `${planName} renews in 2 days`,
        heading: "Your subscription renews in two days",
        body: `Your ${planName} subscription ends on ${endsOn}. If it lapses, extractions, batches and scheduled monitors pause until you renew — your saved data stays exactly where it is.`,
        cta: "Renew now",
      };
    case "lapsed_d0":
      return {
        subject: `${planName} has ended — your data is safe`,
        heading: "Your subscription has ended",
        body: `Your ${planName} subscription ended today. New extractions, batches and scheduled monitors are paused, but you can still sign in, browse everything you have saved, and export it in any format. Renew whenever you are ready and everything resumes automatically.`,
        cta: "Reactivate",
      };
    case "suspend_d7":
      return {
        subject: "Your DatIQ account is paused",
        heading: "Still here whenever you want to come back",
        body: `Your subscription ended a week ago. Your workspace is intact and fully exportable. Scheduled monitors will resume on their own as soon as you reactivate.`,
        cta: "Reactivate",
      };
    case "suspend_d21":
      return {
        subject: "Your DatIQ data will be removed on " + purgeOn,
        heading: "A heads-up about your saved data",
        body: `Your subscription has been inactive for three weeks. Your extractions and schedules are scheduled for removal on ${purgeOn}. Reactivating at any point before then keeps everything.`,
        cta: "Reactivate",
      };
    case "deactivate_d30":
      return {
        subject: "Your DatIQ account is now deactivated",
        heading: "Your account has been deactivated",
        body: `You can still sign in and export everything you have saved. Your data will be removed on ${purgeOn} unless you reactivate before then.`,
        cta: "Reactivate",
      };
    case "delete_d83":
      return {
        subject: `Your DatIQ data will be deleted in 7 days`,
        heading: "Last week to keep your data",
        body: `Your saved extractions, collections and schedules will be permanently deleted on ${purgeOn}. You can export everything now, or reactivate to keep it. Your invoices are always retained and remain downloadable.`,
        cta: "Export or reactivate",
      };
    case "delete_d88":
      return {
        subject: `Your DatIQ data will be deleted in 2 days`,
        heading: "Two days left",
        body: `This is your second-to-last reminder: your saved data will be permanently deleted on ${purgeOn}. Exporting takes a few seconds and there is no charge for it.`,
        cta: "Export or reactivate",
      };
    case "delete_d90":
      return {
        subject: "Your DatIQ data is being deleted today",
        heading: "Your data is being deleted today",
        body: `As notified, your saved extractions, collections and schedules are being removed today. Your account and your invoices are retained — you can sign in and start again on any plan at any time.`,
        cta: "Choose a plan",
      };
    default:
      return {
        subject: "An update about your DatIQ subscription",
        heading: "Subscription update",
        body: "",
        cta: "Open DatIQ",
      };
  }
}
