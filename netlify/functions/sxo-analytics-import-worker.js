// Durable Stage 3 analytics-import worker.
//
// The public endpoint only validates/privacy-minimizes a request and queues it.
// This scheduled worker owns persistence, bounded retries, and stuck-claim
// recovery. The import_job_id unique constraint makes a retry after a partial
// failure converge on one aggregate row rather than double-counting it.

import { withJobRun } from "./lib/jobControl.js";
import * as store from "./lib/audit/auditStore.js";

const JOB_ID = "sxo-analytics-import-worker";
export const MAX_IMPORTS_PER_RUN = 25;

export async function runOnce() {
  const jobs = await store.claimAnalyticsImportJobs(MAX_IMPORTS_PER_RUN);
  const totals = { claimed: jobs.length, completed: 0, retrying: 0, failed: 0 };

  for (const job of jobs) {
    try {
      const payload = job.aggregate_payload || {};
      const saved = await store.saveAnalyticsAggregates(job.user_id, {
        ...payload,
        workspaceId: job.workspace_id || payload.workspaceId || null,
        importJobId: job.id,
      });
      if (!saved.ok) throw new Error(saved.error || "Could not persist analytics aggregate.");

      const counts = payload.eventCounts || {};
      const result = {
        // Total events, and separately how many distinct normalized events they
        // were. The first key used to carry the type count under an events name.
        imported_events_count: Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0),
        imported_event_types_count: Object.keys(counts).length,
        event_counts: payload.eventCounts || {},
        unmapped: payload.unmapped || [],
        aggregate_id: saved.aggregate?.id || null,
      };
      const completed = await store.completeAnalyticsImportJob(job.id, result);
      if (!completed.ok) throw new Error("Import completed but its job state could not be persisted.");
      totals.completed += 1;
    } catch (error) {
      const failed = await store.failAnalyticsImportJob(job, error?.message || "Analytics import failed");
      totals[failed.state === "failed" ? "failed" : "retrying"] += 1;
    }
  }

  return totals;
}

export const handler = withJobRun(JOB_ID, runOnce);
