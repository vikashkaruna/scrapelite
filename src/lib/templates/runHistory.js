// runHistory.js — PURE. Filter and summarise template runs.
//
// Runs have been persisted since 0036 and `listRuns` has existed in the client
// since Phase 1, and NOTHING EVER CALLED IT. Every workflow run a user paid
// credits for was written to the database and then unreachable from anywhere
// in the product — the fourth instance in this codebase of a mechanism
// shipping complete, tested and unwired.
//
// One module so the Dashboard's filtered table and the Account page's summary
// cannot disagree about what "this month" or "succeeded" means.
//
// ─────────────────────────────────────────────────────────────────────────────
// A PARTIAL RUN IS NOT A FAILURE, AND NOT A SUCCESS EITHER.
//
// `partial` means we produced real output and said plainly that some of what
// the template promises is missing. Counting it as success overstates what the
// user got; counting it as failure understates it and would make the success
// rate a lie in the other direction. It is its own bucket everywhere here, and
// the UI is expected to show it as its own bucket too.
// ─────────────────────────────────────────────────────────────────────────────

import { RUN_STATUS } from "./templateModel.js";

/** Statuses that produced usable output. */
export const SUCCEEDED = Object.freeze([RUN_STATUS.COMPLETE]);
/** Produced output, with a stated gap. */
export const PARTIAL = Object.freeze([RUN_STATUS.PARTIAL, RUN_STATUS.NEEDS_REVIEW]);
/** Produced nothing usable. */
export const FAILED = Object.freeze([RUN_STATUS.FAILED, RUN_STATUS.CANCELLED]);
/** Still going. */
export const IN_FLIGHT = Object.freeze([RUN_STATUS.QUEUED, RUN_STATUS.RUNNING]);

export const RUN_FILTERS = Object.freeze([
  { key: "all", label: "All runs" },
  { key: "succeeded", label: "Succeeded", statuses: SUCCEEDED },
  { key: "partial", label: "Partial", statuses: PARTIAL },
  { key: "failed", label: "Failed", statuses: FAILED },
  { key: "running", label: "Running", statuses: IN_FLIGHT },
]);

const asTime = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** The month key a run belongs to, in UTC — the same basis credit_balance uses. */
export function monthOf(run) {
  const t = asTime(run?.created_at);
  return t ? new Date(t).toISOString().slice(0, 7) : "";
}

export function bucketOf(run) {
  const s = run?.status;
  if (SUCCEEDED.includes(s)) return "succeeded";
  if (PARTIAL.includes(s)) return "partial";
  if (FAILED.includes(s)) return "failed";
  if (IN_FLIGHT.includes(s)) return "running";
  // An unknown status is reported as unknown rather than silently bucketed as
  // a failure — inventing a verdict about someone's run is worse than saying
  // we do not recognise it.
  return "unknown";
}

/**
 * Filter runs.
 *
 * @param {Array} runs
 * ⚠️ `bucket`, NOT `status`. A run row has a `status` ('complete', 'partial',
 * 'needs_review'…) and this filters on the BUCKET those map to ('succeeded',
 * 'partial'…). Naming the parameter `status` made them look interchangeable —
 * and they coincidentally are for 'failed', so the mistake passes its first
 * test and fails on 'complete' vs 'succeeded' later.
 *
 * @param {{bucket?:string, templateKey?:string, month?:string, query?:string}} f
 */
export function filterRuns(runs, f = {}) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === "object");
  const bucket = f.bucket && f.bucket !== "all" ? f.bucket : null;
  const q = String(f.query || "").trim().toLowerCase();

  return list.filter((r) => {
    if (bucket && bucketOf(r) !== bucket) return false;
    if (f.templateKey && f.templateKey !== "all" && r.template_key !== f.templateKey) return false;
    if (f.month && f.month !== "all" && monthOf(r) !== f.month) return false;
    if (q) {
      // Search what the user can actually see: the template, the target they
      // typed, and the summary line. Not the id — nobody remembers a run id.
      const hay = [
        r.template_key,
        r.output_summary,
        r.input?.domain, r.input?.url, r.input?.company,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => asTime(b.created_at) - asTime(a.created_at));
}

/** Distinct template keys present, for the filter dropdown. */
export function templateKeysIn(runs) {
  return [...new Set((Array.isArray(runs) ? runs : []).map((r) => r?.template_key).filter(Boolean))].sort();
}

/** Distinct months present, newest first. */
export function monthsIn(runs) {
  return [...new Set((Array.isArray(runs) ? runs : []).map(monthOf).filter(Boolean))].sort().reverse();
}

/**
 * Summarise a set of runs for the Account page.
 *
 * `creditsSpent` sums `credits_actual` and IGNORES `credits_estimated`
 * entirely. An estimate is what we guessed before doing the work; presenting
 * it as spend would put a number on a billing surface that no ledger row
 * backs. A run still in flight has no actual yet and contributes nothing.
 */
export function summariseRuns(runs, { month = null } = {}) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === "object");
  const scoped = month ? list.filter((r) => monthOf(r) === month) : list;

  const byBucket = { succeeded: 0, partial: 0, failed: 0, running: 0, unknown: 0 };
  const byTemplate = {};
  let creditsSpent = 0;

  for (const r of scoped) {
    byBucket[bucketOf(r)] += 1;
    const k = r.template_key || "unknown";
    byTemplate[k] = (byTemplate[k] || 0) + 1;
    if (Number.isFinite(r.credits_actual)) creditsSpent += r.credits_actual;
  }

  const finished = byBucket.succeeded + byBucket.partial + byBucket.failed;
  return {
    total: scoped.length,
    ...byBucket,
    creditsSpent,
    // Of FINISHED runs only. Including in-flight runs in the denominator would
    // make the rate dip every time someone starts a run and recover when it
    // lands — movement no outcome caused.
    successRate: finished ? Math.round((byBucket.succeeded / finished) * 100) / 100 : null,
    byTemplate: Object.entries(byTemplate)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    lastRunAt: scoped.reduce((acc, r) => Math.max(acc, asTime(r.created_at)), 0) || null,
  };
}
