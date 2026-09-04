// src/lib/rules/retryModel.js
//
// PURE. Decides whether a failed signal dispatch should be retried, and when.
// Closes PRD 5's last "Must": *"Retry failed actions."*
//
// Shared client↔server like every other model here, so the "next attempt in
// ~5 minutes" a user reads in the rule history is computed by the same code
// that scheduled it.
//
// ── WHAT IS RETRYABLE, AND WHAT IS EMPHATICALLY NOT ─────────────────────────
//
// A retry is only ever worth making when the same request could plausibly
// succeed unchanged. That splits the dispatcher's outcomes cleanly:
//
//   failed    → RETRY. A 503, a timeout, a DNS blip. The request was fine; the
//               world was briefly not.
//   refused   → NEVER. The destination was rejected by the SSRF guard. Retrying
//               is not just useless, it is the wrong instinct entirely: it would
//               turn one blocked request into a scheduled, repeating attempt to
//               reach a private address. A refusal is a decision, not an error.
//   skipped   → NEVER. An operator has not configured the mailer, or there is no
//               HubSpot connection. Nothing about waiting five minutes changes
//               that, and retrying would bury the one signal that tells the
//               operator to go and fix it.
//   success   → NEVER, obviously.
//
// A 4xx from the destination is also not retried: the receiving system told us
// the request was wrong, and sending it again unchanged is how a broken rule
// turns into a rate-limit ban on a customer's own Slack workspace.
//
// ── THE BACKOFF IS THE ONE THE REPO ALREADY USES ────────────────────────────
//
// Deliberately the same shape as `workflowEnqueue.backoffMs` — 1m, 5m, 30m, 2h,
// 12h — so an operator reasoning about "when will this try again?" has one
// answer across the platform rather than two schedules to remember.
//
// ── WHY A CEILING, AND WHY IT IS LOW ────────────────────────────────────────
//
// MAX_ATTEMPTS is 5. A rule whose destination has been unreachable across five
// attempts spanning ~14 hours is not experiencing a blip; it is misconfigured or
// abandoned, and continuing to call it is spending the customer's quota to
// generate noise. At the ceiling the execution settles as `failed` and stays
// visible in the history, which is the state that prompts somebody to look.

/** Terminal and non-terminal outcomes a dispatch can record. */
export const EXECUTION_STATUS = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
  REFUSED: "refused",
  RETRYING: "retrying",
});

/** Mirrors the CHECK in 0046. A status outside this set is a programming error. */
export const ALLOWED_STATUSES = Object.freeze(Object.values(EXECUTION_STATUS));

/**
 * After this many attempts a dispatch stops being retried and settles `failed`.
 * Attempt 1 is the original send, so this allows 4 retries.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Delay before attempt N+1, given N attempts so far. Index 0 is unused (the
 * first send is immediate); index 1 is the wait after the first failure.
 *
 * Note the table cannot be looked up with `||` — table[0] is 0 and would fall
 * through to the default. The same footnote exists in workflowEnqueue.js, for
 * the same reason, and is repeated because it has caught someone once already.
 */
const BACKOFF_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

export function backoffMs(attempt) {
  const n = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempt) || 0));
  return BACKOFF_MS[n];
}

/**
 * Should this outcome be retried?
 *
 * @param {{status: string, httpStatus?: number|null}} outcome
 * @param {number} attempt  Attempts made so far, including this one.
 * @returns {{retry: boolean, reason: string}}
 */
export function shouldRetry(outcome = {}, attempt = 1) {
  const status = String(outcome.status || "");
  const n = Number(attempt) || 1;

  if (status !== EXECUTION_STATUS.FAILED) {
    // Everything else is settled by definition — see the header.
    return { retry: false, reason: `status '${status || "unknown"}' is not retryable` };
  }
  if (n >= MAX_ATTEMPTS) {
    return { retry: false, reason: `exhausted after ${MAX_ATTEMPTS} attempts` };
  }

  const http = Number(outcome.httpStatus);
  if (Number.isFinite(http) && http >= 400 && http < 500 && http !== 408 && http !== 429) {
    // The destination told us the request itself was wrong. 408 (timeout) and
    // 429 (rate limited) are the two 4xx that DO resolve on their own, and both
    // are exactly the case a backoff exists for.
    return { retry: false, reason: `destination rejected the request (${http})` };
  }

  return { retry: true, reason: `attempt ${n} of ${MAX_ATTEMPTS}` };
}

/**
 * When the next attempt is due.
 * @returns {string|null} ISO timestamp, or null when there is no next attempt.
 */
export function nextRetryAt(outcome = {}, attempt = 1, from = new Date()) {
  const verdict = shouldRetry(outcome, attempt);
  if (!verdict.retry) return null;
  const base = from instanceof Date ? from.getTime() : new Date(from).getTime();
  return new Date(base + backoffMs(Number(attempt) || 1)).toISOString();
}

/**
 * The status to STORE for an outcome, given whether it will be retried.
 *
 * A dispatch awaiting another attempt is `retrying`, not `failed`: reporting it
 * as failed would show a permanent failure in the rule history for something
 * still in flight, and the user would go and "fix" a rule that was about to
 * work by itself.
 */
export function statusFor(outcome = {}, attempt = 1) {
  const status = String(outcome.status || EXECUTION_STATUS.FAILED);
  if (!ALLOWED_STATUSES.includes(status)) return EXECUTION_STATUS.FAILED;
  if (status !== EXECUTION_STATUS.FAILED) return status;
  return shouldRetry(outcome, attempt).retry
    ? EXECUTION_STATUS.RETRYING
    : EXECUTION_STATUS.FAILED;
}

/** Human-readable summary for the rule-history UI. */
export function describeRetry(outcome = {}, attempt = 1) {
  const verdict = shouldRetry(outcome, attempt);
  if (!verdict.retry) {
    if (String(outcome.status) === EXECUTION_STATUS.REFUSED) {
      return "Not retried — the destination was refused, and retrying would repeat the attempt.";
    }
    if (String(outcome.status) === EXECUTION_STATUS.SKIPPED) {
      return "Not retried — this needs a configuration change, not another attempt.";
    }
    return `Not retried — ${verdict.reason}.`;
  }
  const mins = Math.round(backoffMs(attempt) / 60_000);
  return `Retrying in ${mins} minute${mins === 1 ? "" : "s"} (${verdict.reason}).`;
}

export const _internal = { BACKOFF_MS };
