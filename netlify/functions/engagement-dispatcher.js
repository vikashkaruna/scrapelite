// netlify/functions/engagement-dispatcher.js — drains the outreach send queue.
//
// The dashboard's "Send approved" sends what fits in its request budget; this
// cron sends the rest, re-takes sends whose function died mid-flight (safe:
// the provider idempotency key is the message id), and picks up messages that
// were deferred for credits or a paused campaign once that clears.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE — v1 handlers ignore an
// exported `config.schedule`. It is also registered in AUTOMATION_JOBS and in
// admin-monitoring's RUNNABLE map; cron-registry parity asserts they agree.
//
// Honours ENGAGEMENT_ENABLED like the API: with the module off, nothing sends.

import { withJobRun } from "./lib/jobControl.js";
import { processQueue } from "./lib/engagement/dispatcher.js";
import { createDeadline } from "./lib/audit/deadline.js";

const JOB_ID = "engagement-dispatcher";

/** Wall-clock budget; the function timeout is 26s where configured, 10s stock. */
export const RUN_BUDGET_MS = Number(process.env.ENGAGEMENT_DISPATCH_BUDGET_MS) || 8_000;

async function run() {
  if (process.env.ENGAGEMENT_ENABLED !== "1") return { skipped: "engagement_disabled" };
  const res = await processQueue({ deadline: createDeadline(RUN_BUDGET_MS), limit: 200 });
  const { results, ...totals } = res;
  return { ...totals, sample: (results || []).slice(0, 10) };
}

export const handler = withJobRun(JOB_ID, run);
export const _internal = { run };
