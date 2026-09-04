// netlify/functions/signal-retry.js — PRD 5's "retry failed actions".
//
// The dispatcher records a retryable failure as `retrying` with a `next_retry_at`.
// This is what comes back for it.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE. `export const config =
// { schedule }` is a v2 (`export default`) feature and every function here is
// v1, so declaring it in this file is silently ignored — the exact way four
// crons sat unscheduled from R19 until 2026-07-27 with no build or runtime
// error. It must also appear in AUTOMATION_JOBS; `cron-registry-parity.test.js`
// asserts both halves agree.
//
// ── WHY THIS IS ITS OWN CRON RATHER THAN A BRANCH INSIDE ANOTHER ────────────
//
// `bulk-runner` already runs every five minutes, which is the cadence a retry
// backoff wants, and folding this in would have saved a file. It is separate for
// the same reason `discoverability-monitor` does not live inside
// `scheduled-runner`: they share a cadence and nothing else.
//
// Concretely, separation buys three things that matter to an operator:
//   * its own `job_runs` history, so "are retries working?" is answerable
//     without reading bulk-enrichment logs;
//   * its own kill switch — an operator can stop retrying a misbehaving
//     destination without also stopping every customer's enrichment;
//   * a failure here cannot fail the other job's run, and vice versa.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
//
// It does not re-evaluate the rule's conditions. The rule matched when the event
// happened; a retry is about DELIVERY, not about re-litigating the decision
// against a world that has since moved on. Re-evaluating would silently drop
// retries whenever the underlying value changed back, leaving `retrying` rows
// that never settle — a queue that quietly stops draining is worse than one that
// visibly fails.

import { withJobRun } from "./lib/jobControl.js";
import { retryDueDispatches } from "./lib/signalDispatch.js";

const JOB_ID = "signal-retry";

/** Wall-clock budget. Netlify kills a synchronous function at 10s stock. */
export const RUN_BUDGET_MS = Number(process.env.SIGNAL_RETRY_BUDGET_MS) || 20_000;

/**
 * Retries attempted per run. Each is one outbound HTTP call with a 6s ceiling,
 * so this is bounded well inside the budget even in the worst case where every
 * destination times out.
 */
export const MAX_RETRIES_PER_RUN = 25;

async function run() {
  const startedAt = Date.now();
  const res = await retryDueDispatches({ limit: MAX_RETRIES_PER_RUN, now: new Date() });

  if (!res.ok && res.reason === "supabase_unconfigured") {
    // A preview deploy with no service key has nothing to retry. Not an error,
    // and it must not fill job_runs with failures.
    return { skipped: "supabase_unconfigured", retried: 0 };
  }
  if (!res.ok) throw new Error(`retry sweep failed: ${res.reason}`);

  return {
    retried: res.retried,
    succeeded: res.succeeded,
    settled: res.settled,
    errors: (res.errors || []).slice(0, 10),
    durationMs: Date.now() - startedAt,
  };
}

export const handler = withJobRun(JOB_ID, run);
export const _internal = { run };
