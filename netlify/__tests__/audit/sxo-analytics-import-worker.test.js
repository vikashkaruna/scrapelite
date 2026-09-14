import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auditStore from "../../functions/lib/audit/auditStore.js";
import { runOnce } from "../../functions/sxo-analytics-import-worker.js";

describe("SXO analytics import worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("claims normalized imports, writes by import id, and completes the job", async () => {
    vi.spyOn(auditStore, "claimAnalyticsImportJobs").mockResolvedValue([{
      id: "job-1",
      user_id: "user-1",
      workspace_id: "workspace-1",
      attempts: 1,
      max_attempts: 5,
      aggregate_payload: {
        auditId: "audit-1",
        eventCounts: { page_view: 10 },
        unmapped: [{ unmapped_name: "other" }],
      },
    }]);
    vi.spyOn(auditStore, "saveAnalyticsAggregates").mockResolvedValue({
      ok: true,
      aggregate: { id: "aggregate-1" },
    });
    vi.spyOn(auditStore, "completeAnalyticsImportJob").mockResolvedValue({ ok: true });
    const fail = vi.spyOn(auditStore, "failAnalyticsImportJob").mockResolvedValue({ ok: true, state: "retrying" });

    await expect(runOnce()).resolves.toEqual({ claimed: 1, completed: 1, retrying: 0, failed: 0 });
    expect(auditStore.saveAnalyticsAggregates).toHaveBeenCalledWith("user-1", expect.objectContaining({
      auditId: "audit-1",
      workspaceId: "workspace-1",
      importJobId: "job-1",
      eventCounts: { page_view: 10 },
    }));
    expect(auditStore.completeAnalyticsImportJob).toHaveBeenCalledWith("job-1", expect.objectContaining({
      aggregate_id: "aggregate-1",
      // Ten page_view events of ONE normalized type. The key used to report the
      // type count under an events name.
      imported_events_count: 10,
      imported_event_types_count: 1,
    }));
    expect(fail).not.toHaveBeenCalled();
  });

  it("moves a failed persistence attempt onto the bounded retry path", async () => {
    const job = {
      id: "job-2", user_id: "user-1", attempts: 1, max_attempts: 5,
      aggregate_payload: { eventCounts: { page_view: 10 } },
    };
    vi.spyOn(auditStore, "claimAnalyticsImportJobs").mockResolvedValue([job]);
    vi.spyOn(auditStore, "saveAnalyticsAggregates").mockResolvedValue({ ok: false, error: "temporary" });
    vi.spyOn(auditStore, "failAnalyticsImportJob").mockResolvedValue({ ok: true, state: "retrying" });

    await expect(runOnce()).resolves.toEqual({ claimed: 1, completed: 0, retrying: 1, failed: 0 });
    expect(auditStore.failAnalyticsImportJob).toHaveBeenCalledWith(job, "temporary");
  });
});
