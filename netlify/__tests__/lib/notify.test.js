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

    // Regression: long news-site titles like "https://www.india.com" blew
    // past Slack's 150-char header limit and the webhook returned 400.
    // The dashboard only saw `slack_400` (the body was being discarded),
    // so the user had no idea what was wrong. See postToSlack below for
    // the diagnostic half of the fix.
    it("truncates the header text so it stays under Slack's 150-char cap", () => {
      // India.com's actual title is in the 120-130 char range; this is
      // a representative long news-site title.
      const longTitle =
        "India.com - Latest India News, Live News, India Breaking News, Trending News, India News Headlines, Top News Today | India.com";
      const payload = buildSlackNewExtraction({
        url: "https://www.india.com",
        page_title: longTitle,
        ai_summary: "Short summary.",
      });
      const header = payload.blocks.find((b) => b.type === "header");
      expect(header.text.text.length).toBeLessThanOrEqual(150);
      // The 19-char "✅ New extraction: " prefix + a 120-char (max) title
      // gives a worst case of 139 + 1 ellipsis = 140. Allow 150 strictly.
      expect(header.text.text.length).toBeLessThan(150);
      // Truncation must be visible — an ellipsis, not silent mangling.
      expect(header.text.text).toMatch(/…$/);
      // Fallback text is also bounded so a notification preview client
      // (which renders only the top-level `text` field) doesn't blow up.
      expect(payload.text.length).toBeLessThanOrEqual(3000);
    });

    it("preserves short titles verbatim", () => {
      const payload = buildSlackNewExtraction({
        url: "https://x.com",
        page_title: "Acme",
        ai_summary: "Acme does X",
      });
      const header = payload.blocks.find((b) => b.type === "header");
      expect(header.text.text).toBe("✅ New extraction: Acme");
      // No ellipsis on a short title.
      expect(header.text.text.endsWith("…")).toBe(false);
    });

    it("strips control characters that break Slack's Block Kit parser", () => {
      const payload = buildSlackNewExtraction({
        url: "https://x.com",
        // \u0000 (null) + literal newline in the middle of the title.
        page_title: "Acme\u0000\nCorp",
        ai_summary: "Summary with \u0007 bell.",
      });
      const header = payload.blocks.find((b) => b.type === "header");
      expect(header.text.text).not.toMatch(/[\u0000-\u001F]/);
      // Whitespace is collapsed to a single space — newlines don't survive.
      expect(header.text.text).toBe("✅ New extraction: Acme Corp");
    });

    it("escapes < and > inside URLs so the Slack mrkdwn link doesn't close early", () => {
      const payload = buildSlackNewExtraction({
        url: "https://x.com/foo?a=<bar>&b=>baz",
        page_title: "X",
      });
      const fields = payload.blocks.find((b) => b.type === "section").fields;
      const urlField = fields[0].text;
      // The literal `<` and `>` from the query string must be percent-
      // escaped, otherwise Slack reads them as link delimiters and the
      // block becomes invalid.
      expect(urlField).toContain("%3C");
      expect(urlField).toContain("%3E");
      expect(urlField).not.toMatch(/<https[^>]*>[^<]*</);
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
