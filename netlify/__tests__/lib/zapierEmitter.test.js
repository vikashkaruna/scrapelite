// netlify/__tests__/lib/zapierEmitter.test.js
import { describe, it, expect, vi } from "vitest";

const mockAppend = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../../functions/lib/zapierEventStore.js", () => ({
  appendEvent: (...args) => mockAppend(...args),
}));

import { emitNewExtraction, emitNewEnrichment, emitMonitoringAlert } from "../../functions/lib/zapierEmitter.js";

describe("zapierEmitter", () => {
  it("emits a new_extraction event with a stable dedupe key", async () => {
    await emitNewExtraction({ userId: "u1", extraction: { id: "e1", url: "https://x.com", page_title: "X" } });
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      eventType: "new_extraction",
      dedupeKey: "extraction:e1",
    }));
  });
  it("emits a new_enrichment event", async () => {
    await emitNewEnrichment({ userId: "u1", extractionId: "e1", focus: "contacts", data: { emails: [] } });
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "new_enrichment",
      payload: expect.objectContaining({ focus: "contacts" }),
    }));
  });
  it("emits a monitoring_alert event with a hash-keyed dedupe", async () => {
    await emitMonitoringAlert({
      userId: "u1",
      schedule: { id: "s1", target: "https://x.com", label: "L" },
      changedSummary: { previousHash: "abc", newHash: "def" },
    });
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "monitoring_alert",
      dedupeKey: "alert:s1:def",
    }));
  });
  it("is a no-op when required fields are missing", async () => {
    mockAppend.mockClear();
    await emitNewExtraction({ userId: "u1" });
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
