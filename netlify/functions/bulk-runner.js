// netlify/functions/bulk-runner.js — PRD 3's missing durability.
//
// The chunk runner existed but was driven entirely by a client POST, so a job
// only advanced while the browser tab was open and polling it. Closing the tab
// stranded the list mid-enrichment: rows stayed `queued` for ever, the job
// stayed `running`, and nothing anywhere said so. PRD 3 asks for "queue-based
// asynchronous processing with progress" — this is the queue half.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE. See watchlist-monitor.js for
// why (v2-only export, silently ignored for our v1 handlers). It must also be
// registered in AUTOMATION_JOBS — `cron-registry-parity.test.js` asserts both.
//
// ── THE CLIENT PATH IS KEPT, DELIBERATELY ───────────────────────────────────
//
// `POST /api/bulk-enrichment {action:"process_chunk"}` still works, and the UI
// still calls it while the tab is open. That is not redundancy — it is what
// makes a small list feel instant instead of waiting up to five minutes for a
// cron. The two paths are safe to run concurrently because the unit of work is
// claimed per ITEM: an item moves `queued → running → completed`, and both
// drivers select only `queued` rows. The worst case is that a chunk does less
// work than it could have, never that an item is enriched twice.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
//
// It does not retry a `failed` item. A domain that could not be read is a
// finding about that domain, and silently re-crawling it every five minutes
// would spend the customer's credits on the same refusal for ever. Re-running
// failures is an explicit user action (`/lists` → "Re-run failed"), which is
// where a human can look at the reason first.

import { withJobRun } from "./lib/jobControl.js";
import { serviceDb, processJobChunk } from "./lib/bulkStore.js";

const JOB_ID = "bulk-runner";

/** Wall-clock budget. Netlify kills a synchronous function at 10s stock. */
export const RUN_BUDGET_MS = Number(process.env.BULK_RUNNER_BUDGET_MS) || 20_000;

/** Jobs advanced per run. Round-robin so one huge list cannot starve the rest. */
export const MAX_JOBS_PER_RUN = 5;

/**
 * A job with no queued items left but still marked running is finished; a job
 * that has not moved in this long with items still queued is stuck and worth
 * surfacing rather than retrying invisibly for ever.
 */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

async function run() {
  const startedAt = Date.now();
  const deadlineAt = startedAt + RUN_BUDGET_MS;
  const db = serviceDb();

  if (!db) return { skipped: "supabase_unconfigured", jobs: 0, processed: 0 };

  // Oldest first: a job that has been waiting longest gets served first, so a
  // steady stream of new lists cannot indefinitely postpone an old one.
  const { data: jobs, error } = await db
    .from("enrichment_jobs")
    .select("id, list_id, user_id, status, created_at, updated_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (error) throw new Error(`could not read enrichment jobs: ${error.message}`);

  const totals = { jobs: 0, processed: 0, completed: 0, stuck: 0, errors: [] };

  for (const job of jobs || []) {
    if (Date.now() >= deadlineAt) break;

    totals.jobs += 1;
    // Each job gets what is left of the budget, capped so one job cannot
    // consume the entire run and starve the others in this batch.
    const perJob = Math.min(deadlineAt - Date.now(), Math.floor(RUN_BUDGET_MS / MAX_JOBS_PER_RUN));

    let res;
    try {
      res = await processJobChunk(job.id, Math.max(2000, perJob));
    } catch (e) {
      totals.errors.push(`${job.id}: ${e.message}`);
      continue;
    }

    if (!res?.ok) {
      totals.errors.push(`${job.id}: ${res?.reason || "unknown"}`);
      continue;
    }

    totals.processed += res.processed || 0;
    if (res.done) totals.completed += 1;

    // A job that processed nothing, is not done, and has been idle for an hour
    // is not progressing. Reported rather than retried silently — the failure
    // mode this whole engine exists to remove is a job that looks alive and is
    // not, and replacing "stranded by a closed tab" with "stranded by a stuck
    // cron" would be no improvement at all.
    if (!res.done && (res.processed || 0) === 0) {
      const idleMs = Date.now() - Date.parse(job.updated_at || job.created_at || 0);
      if (Number.isFinite(idleMs) && idleMs > STUCK_AFTER_MS) {
        totals.stuck += 1;
        totals.errors.push(`${job.id}: no progress for ${Math.round(idleMs / 60000)}m`);
      }
    }
  }

  return {
    ...totals,
    errors: totals.errors.slice(0, 10),
    durationMs: Date.now() - startedAt,
    budgetExhausted: Date.now() >= deadlineAt,
  };
}

export const handler = withJobRun(JOB_ID, run);
export const _internal = { run };
