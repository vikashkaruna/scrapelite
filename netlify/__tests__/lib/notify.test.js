// netlify/__tests__/lib/notify.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/integrationConnectionStore.js", () => ({
  getConnection: vi.fn(),
}));

vi.mock("../../functions/lib/zapierEmitter.js", () => ({
  emitNewExtraction: vi.fn(),
  emitNewEnrichment: vi.fn(),
  emitMonitoringAlert: vi.fn(),
}));

import {
  buildSlackNewExtraction,
  notifyExtractionComplete,
  notifyEnrichmentComplete,
  notifyMonitoringChange,
  _internal,
} from "../../functions/lib/notify.js";
import { getConnection } from "../../functions/lib/integrationConnectionStore.js";
import { emitNewExtraction, emitNewEnrichment, emitMonitoringAlert } from "../../functions/lib/zapierEmitter.js";

describe("notify (F-INT-4)", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.SLACK_WEBHOOK_URL;
    // resetAllMocks (not clearAllMocks) so per-test mockResolvedValue from
    // earlier tests doesn't leak into later ones. This matters for the
    // "no channels configured" tests, which assume getConnection returns
    // undefined by default.
    vi.resetAllMocks();
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

  describe("notifyMonitoringChange", () => {
    const schedule = { id: "s1", label: "Acme monitor", intent: "summary", target: "https://acme.com" };
    const changedSummary = { previousHash: "abc", newHash: "def" };

    it("returns ok with slack:null when no channels are configured", async () => {
      const r = await notifyMonitoringChange({ userId: "u1", schedule, changedSummary });
      expect(r.ok).toBe(true);
      expect(r.slack).toBeNull();
    });

    it("posts to Slack when SLACK_WEBHOOK_URL is set", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/AAA/BBB/CCC";
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const r = await notifyMonitoringChange({ userId: "u1", schedule, changedSummary });
      expect(r.slack.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      // The change alert payload text is human-readable
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toMatch(/changed/);
    });

    it("prefers the per-user Slack webhook over the global env", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/global-env";
      getConnection.mockResolvedValue({
        ok: true,
        connection: { config: { webhook_url: "https://hooks.slack.com/per-user" } },
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const r = await notifyMonitoringChange({ userId: "u1", schedule, changedSummary });
      expect(r.slack.ok).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.slack.com/per-user");
    });

    it("emits a monitoring_alert event for the Zapier fan-out", async () => {
      emitMonitoringAlert.mockResolvedValue({ ok: true });
      const r = await notifyMonitoringChange({ userId: "u1", schedule, changedSummary });
      expect(r.zapier.ok).toBe(true);
      expect(emitMonitoringAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          schedule: expect.objectContaining({ id: "s1" }),
          changedSummary,
        }),
      );
    });

    it("returns ok:false when schedule is missing", async () => {
      const r = await notifyMonitoringChange({ userId: "u1", schedule: null, changedSummary: {} });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("missing_schedule");
    });

    it("survives a Slack 502 — the Zapier leg still fires", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/AAA/BBB/CCC";
      fetchMock.mockResolvedValue({ ok: false, status: 502 });
      emitMonitoringAlert.mockResolvedValue({ ok: true });
      const r = await notifyMonitoringChange({ userId: "u1", schedule, changedSummary });
      expect(r.slack.ok).toBe(false);
      expect(r.slack.status).toBe(502);
      expect(r.zapier.ok).toBe(true);
    });
  });

  describe("_internal", () => {
    it("exposes the helpers for tests", () => {
      expect(typeof _internal.buildSlackNewExtraction).toBe("function");
    });
  });
});
