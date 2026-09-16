import { describe, it, expect } from "vitest";
import {
  createList,
  getList,
  startJob,
  processJobChunk,
  assertJobOwner,
  assertListOwner,
} from "../../functions/lib/bulkStore.js";

describe("bulkStore — lists and durable enrichment runner", () => {
  const userId = "test_user_bulk_1";

  it("creates a list and initiates an enrichment job", async () => {
    const res = await createList(
      userId,
      {
        name: "Enterprise Leads",
        domains: ["stripe.com", "openai.com", "notion.so"],
      },
      {} // empty env -> local mock store
    );

    expect(res.ok).toBe(true);
    expect(res.total).toBe(3);
    expect(res.jobId).toBeDefined();

    const isOwner = await assertListOwner(res.list.id, userId, {});
    expect(isOwner).toBe(true);

    const isJobOwner = await assertJobOwner(res.jobId, userId, {});
    expect(isJobOwner).toBe(true);
  });

  it("processes a chunk and updates list stats", async () => {
    const createRes = await createList(
      userId,
      {
        name: "Fintech Targets",
        domains: ["stripe.com", "brex.com"],
      },
      {}
    );

    const chunkRes = await processJobChunk(createRes.jobId, 10000, {});
    expect(chunkRes.ok).toBe(true);
    expect(chunkRes.processed).toBeGreaterThan(0);

    const listDetails = await getList(createRes.list.id, userId, {});
    expect(listDetails.records.length).toBe(2);
    expect(listDetails.completed_records).toBeGreaterThan(0);
  });

  it("allows startJob to re-queue or retrieve jobs on existing lists", async () => {
    const createRes = await createList(
      userId,
      {
        name: "SaaS Accounts",
        domains: ["slack.com"],
      },
      {}
    );

    const startRes = await startJob(userId, createRes.list.id, {});
    expect(startRes.ok).toBe(true);
    expect(startRes.jobId).toBeDefined();
  });
});
