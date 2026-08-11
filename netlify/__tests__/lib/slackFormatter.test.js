// netlify/__tests__/lib/slackFormatter.test.js — F17 (Slack formatter unit tests).
import { describe, it, expect, vi } from "vitest";
import {
  buildSlackChangeAlert,
  buildSlackWeeklyRunSummary,
  buildSlackWelcomeMessage,
  postToSlack,
  _internal,
} from "../../functions/lib/slackFormatter.js";

describe("slackFormatter (F17)", () => {
  describe("buildSlackChangeAlert", () => {
    it("returns a payload with text + blocks for a single-URL schedule", () => {
      const payload = buildSlackChangeAlert({
        label: "Stripe pricing",
        type: "single",
        target: "https://stripe.com/pricing",
        intent: "summary",
      });
      expect(payload.text).toMatch(/Stripe pricing/);
      expect(Array.isArray(payload.blocks)).toBe(true);
      // header + section (fields) + section (targets) + actions
      expect(payload.blocks.length).toBeGreaterThanOrEqual(4);
      const header = payload.blocks.find((b) => b.type === "header");
      expect(header).toBeDefined();
    });

    it("includes a context block when previousHash and newHash are provided", () => {
      const payload = buildSlackChangeAlert(
        { label: "X", type: "single", target: "https://x.com" },
        { previousHash: "abc", newHash: "def" },
      );
      const ctx = payload.blocks.find((b) => b.type === "context");
      expect(ctx).toBeDefined();
      expect(JSON.stringify(ctx)).toMatch(/abc.*def/);
    });

    it("omits the context block when no hashes are provided", () => {
      const payload = buildSlackChangeAlert({ label: "X", type: "single", target: "https://x.com" });
      expect(payload.blocks.find((b) => b.type === "context")).toBeUndefined();
    });

    it("truncates batch targets to MAX_TARGETS and reports the full count in the fields", () => {
      const targets = Array.from({ length: 20 }, (_, i) => `https://x${i}.com`);
      const payload = buildSlackChangeAlert({ label: "Big batch", type: "batch", target: targets, intent: "summary" });
      // The "Batch (20 URLs)" summary line lives in the fields section, not the targets list.
      const fieldsBlock = payload.blocks.find((b) => b.type === "section" && Array.isArray(b.fields));
      const fieldsText = JSON.stringify(fieldsBlock);
      expect(fieldsText).toMatch(/Batch \(20 URLs\)/);
      // The targets block lists the first MAX_TARGETS URLs only.
      const targetsBlock = payload.blocks.find((b) => b.text?.text?.startsWith("*Targets*"));
      expect(targetsBlock.text.text).toContain("x0.com");
      expect(targetsBlock.text.text).not.toContain("x19.com");
    });

    it("strips tracking params from the link target (Slack <url|label> shows full label)", () => {
      const payload = buildSlackChangeAlert({
        label: "X", type: "single",
        target: "https://example.com/p?utm_source=fb&id=1",
      });
      const targetsBlock = payload.blocks.find((b) => b.text?.text?.startsWith("*Targets*"));
      // The link target (inside <…>) has utm stripped; the label (after the |) shows the original.
      expect(targetsBlock.text.text).toMatch(/<https:\/\/example\.com\/p\?id=1\|/);
    });
  });

  describe("buildSlackWeeklyRunSummary", () => {
    it("renders an empty-state message when there are no changes", () => {
      const payload = buildSlackWeeklyRunSummary({ userName: "V", weekOf: "2026-07-13", changes: [] });
      expect(payload.text).toMatch(/0 change/);
      const section = payload.blocks.find((b) => b.type === "section");
      expect(section.text.text).toMatch(/No content changes/);
    });

    it("renders a section per change (capped at 5)", () => {
      const changes = Array.from({ length: 8 }, (_, i) => ({
        label: `Sched ${i}`,
        target: `https://x${i}.com`,
        scheduleId: `s${i}`,
        detectedAt: new Date().toISOString(),
      }));
      const payload = buildSlackWeeklyRunSummary({ userName: "V", weekOf: "2026-07-13", changes });
      const sectionBlocks = payload.blocks.filter((b) => b.type === "section" && /Sched \d/.test(b.text?.text || ""));
      expect(sectionBlocks.length).toBe(5);
    });

    it("uses the username in the greeting when provided", () => {
      const payload = buildSlackWeeklyRunSummary({ userName: "Vikash", weekOf: "2026-07-13", changes: [] });
      const section = payload.blocks.find((b) => b.type === "section");
      expect(section.text.text).toMatch(/Hi Vikash/);
    });
  });

  describe("buildSlackWelcomeMessage", () => {
    it("greets by username when provided", () => {
      const payload = buildSlackWelcomeMessage({ userName: "Vikash" });
      expect(payload.text).toMatch(/Vikash/);
      const header = payload.blocks.find((b) => b.type === "header");
      expect(header.text.text).toMatch(/Vikash/);
    });

    it("uses a generic greeting when no username", () => {
      const payload = buildSlackWelcomeMessage({});
      expect(payload.text).toMatch(/Welcome to DatIQ/);
    });

    it("includes the plan label in the body", () => {
      const payload = buildSlackWelcomeMessage({ userName: "V", planLabel: "Pro" });
      const section = payload.blocks.find((b) => b.type === "section");
      expect(section.text.text).toMatch(/Pro/);
    });
  });

  describe("postToSlack", () => {
    it("returns ok:false with an error when no webhook URL is set", async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const r = await postToSlack({ text: "x" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not configured/);
    });

    it("posts the payload as JSON to the configured URL", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const r = await postToSlack({ text: "hello" }, { webhookUrl: "https://hooks.slack.com/services/XXX", fetchFn });
      expect(r.ok).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/XXX",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        }),
      );
      const sentBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(sentBody.text).toBe("hello");
    });

    it("captures network errors", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
      const r = await postToSlack({ text: "x" }, { webhookUrl: "https://hooks.slack.com/XXX", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("network down");
    });

    it("returns ok:false when Slack responds with 4xx/5xx", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const r = await postToSlack({ text: "x" }, { webhookUrl: "https://hooks.slack.com/XXX", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(404);
    });

    // Regression: postToSlack used to discard Slack's response body, so a
    // 400 from Block Kit (invalid_blocks, no_text, channel_not_found…)
    // showed up in the dashboard as a bare `slack_400`. Now the body's
    // `error` field is surfaced so the user (and the failedRecords list
    // on the dashboard) can see *why* the post failed.
    it("surfaces Slack's error reason from the response body on 400", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          ok: false,
          error: "invalid_blocks",
          response_metadata: { messages: ["invalid character at line 1 of the header block"] },
        })),
      });
      const r = await postToSlack({ text: "x" }, { webhookUrl: "https://hooks.slack.com/XXX", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
      // The dashboard pattern is `slack_<status>`. We keep that as a
      // suffix so existing client code that greps for `slack_400` still
      // works, and we prepend the human-readable reason.
      expect(r.error).toMatch(/invalid_blocks/);
      expect(r.error).toMatch(/slack_400/);
    });

    it("falls back to a plain-text body slice when Slack's body is not JSON", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("upstream slack outage"),
      });
      const r = await postToSlack({ text: "x" }, { webhookUrl: "https://hooks.slack.com/XXX", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("upstream slack outage");
      expect(r.error).toMatch(/slack_502/);
    });

    it("still returns slack_<status> when the response has no body at all", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve(""),
      });
      const r = await postToSlack({ text: "x" }, { webhookUrl: "https://hooks.slack.com/XXX", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("slack_503");
    });
  });

  describe("_internal", () => {
    it("exposes MAX_TARGETS = 8", () => {
      expect(_internal.MAX_TARGETS).toBe(8);
    });
  });
});
