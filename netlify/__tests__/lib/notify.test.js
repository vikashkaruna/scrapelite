// netlify/__tests__/lib/notify.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/integrationConnectionStore.js", () => ({
  getConnection: vi.fn(),
}));

vi.mock("../../functions/lib/zapierEmitter.js", () => ({
  emitNewExtraction: vi.fn(),
  emitNewEnrichment: vi.fn(),
}));

import {
  buildSlackNewExtraction,
  notifyExtractionComplete,
  notifyEnrichmentComplete,
  _internal,
} from "../../functions/lib/notify.js";
import { getConnection } from "../../functions/lib/integrationConnectionStore.js";
import { emitNewExtraction, emitNewEnrichment } from "../../functions/lib/zapierEmitter.js";

describe("notify (F-INT-4)", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.SLACK_WEBHOOK_URL;
    vi.clearAllMocks();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  describe("buildSlackNewExtraction", () => {
    it("renders a Block Kit header + summary + actions", () => {
      const payload = buildSlackNewExtraction({
        url: "https://acme.com",
        page_title: "Acme",
        ai_summary: "Acme does X",
      });
      expect(payload.text).toMatch(/Acme/);
      expect(payload.blocks[0].type).toBe("header");
      const actions = payload.blocks.find((b) => b.type === "actions");
      expect(actions).toBeDefined();
    });
    it("returns null for nullish input", () => {
      expect(buildSlackNewExtraction(null)).toBeNull();
      expect(buildSlackNewExtraction(undefined)).toBeNull();
    });
    it("truncates the summary at 1500 chars", () => {
      const payload = buildSlackNewExtraction({
        url: "https://x.com",
        page_title: "X",
        ai_summary: "x".repeat(2000),
      });
      const section = payload.blocks.find((b) => b.text?.text?.includes("Summary"));
      expect(section.text.text.length).toBeLessThan(2000);
    });
  });

  describe("notifyExtractionComplete", () => {
    it("returns ok without doing anything when no channels are configured", async () => {
      const r = await notifyExtractionComplete({ userId: "u1", extraction: { id: "e1" } });
      expect(r.ok).toBe(true);
      expect(r.slack).toBeNull();
      // Zapier is best-effort and may run
    });

    it("posts to Slack when SLACK_WEBHOOK_URL is set", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/AAA/BBB/CCC";
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const r = await notifyExtractionComplete({ userId: "u1", extraction: { id: "e1", url: "https://x.com", page_title: "X" } });
      expect(r.slack.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    });

    it("uses the per-user Slack connection when set", async () => {
      getConnection.mockResolvedValue({
        ok: true,
        connection: { config: { webhook_url: "https://hooks.slack.com/per-user" } },
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const r = await notifyExtractionComplete({ userId: "u1", extraction: { id: "e1", url: "https://x.com", page_title: "X" } });
      expect(r.slack.ok).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.slack.com/per-user");
    });

    it("calls emitNewExtraction for the Zapier fan-out", async () => {
      emitNewExtraction.mockResolvedValue({ ok: true });
      await notifyExtractionComplete({ userId: "u1", extraction: { id: "e1", url: "https://x.com" } });
      expect(emitNewExtraction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", extraction: expect.objectContaining({ id: "e1" }) }),
      );
    });
  });

  describe("notifyEnrichmentComplete", () => {
    it("calls emitNewEnrichment", async () => {
      emitNewEnrichment.mockResolvedValue({ ok: true });
      await notifyEnrichmentComplete({ userId: "u1", extractionId: "e1", focus: "contacts", data: {} });
      expect(emitNewEnrichment).toHaveBeenCalled();
    });
  });

  describe("_internal", () => {
    it("exposes the helpers for tests", () => {
      expect(typeof _internal.buildSlackNewExtraction).toBe("function");
    });
  });
});
