// netlify/functions/lib/reportEmail.test.js — the branded HTML email + real
// Resend attachment for extraction/batch/discoverability reports.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let sendReportEmail;

const EXTRACTION = { id: "e1", url: "https://lumio.io", page_title: "Lumio", ai_summary: "Lumio is great." };
const AUDIT = { target: { url: "https://lumio.io" }, finalScore: 78, pillars: {}, issues: [], recommendations: [] };

beforeEach(async () => {
  vi.resetModules();
  process.env.RESEND_API_KEY = "re_test_key";
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  ({ sendReportEmail } = await import("../../functions/lib/reportEmail.js"));
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.REPORT_EMAIL_FROM;
  vi.unstubAllGlobals();
});

describe("reportEmail — guardrails", () => {
  it("does not send without a Resend key", async () => {
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
    ({ sendReportEmail } = await import("../../functions/lib/reportEmail.js"));
    const r = await sendReportEmail({ kind: "extraction", recipient: "a@b.com", items: [EXTRACTION] });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send without a recipient", async () => {
    const r = await sendReportEmail({ kind: "extraction", items: [EXTRACTION] });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_recipient");
  });

  it("does not send an extraction/batch email with no items", async () => {
    const r = await sendReportEmail({ kind: "extraction", recipient: "a@b.com", items: [] });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_data");
  });

  it("does not send a discoverability email with no audit", async () => {
    const r = await sendReportEmail({ kind: "discoverability", recipient: "a@b.com" });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_data");
  });

  it("never throws — a Resend HTTP error is reported, not raised", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const r = await sendReportEmail({ kind: "extraction", recipient: "a@b.com", items: [EXTRACTION] });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("resend_error");
  });
});

describe("reportEmail — extraction attachment", () => {
  it("attaches a real, non-empty base64 PDF by default", async () => {
    const r = await sendReportEmail({ kind: "extraction", recipient: "a@b.com", items: [EXTRACTION] });
    expect(r.sent).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toMatch(/\.pdf$/);
    expect(payload.attachments[0].content.length).toBeGreaterThan(100);
    // Decode and check the PDF signature.
    const bytes = Buffer.from(payload.attachments[0].content, "base64");
    expect(bytes.slice(0, 4).toString()).toBe("%PDF");
  });

  it("attaches CSV when format is csv", async () => {
    await sendReportEmail({ kind: "extraction", recipient: "a@b.com", format: "csv", items: [EXTRACTION] });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.attachments[0].filename).toMatch(/\.csv$/);
    const csv = Buffer.from(payload.attachments[0].content, "base64").toString("utf-8");
    expect(csv).toContain("# DatIQ Export");
  });

  it("recipient is used exactly as given, never altered", async () => {
    await sendReportEmail({ kind: "extraction", recipient: "alice@example.com", items: [EXTRACTION] });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual(["alice@example.com"]);
    expect(payload.reply_to).toBe("hello@datiq.app");
  });

  it("subject and HTML body carry the DatIQ brand and the source URL", async () => {
    await sendReportEmail({ kind: "extraction", recipient: "a@b.com", items: [EXTRACTION] });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.subject).toContain("DatIQ");
    expect(payload.html).toContain("lumio.io");
    expect(payload.text).toContain("lumio.io");
  });
});

describe("reportEmail — discoverability attachment", () => {
  it("attaches a real PDF for a discoverability audit", async () => {
    const r = await sendReportEmail({ kind: "discoverability", recipient: "a@b.com", audit: AUDIT });
    expect(r.sent).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.attachments[0].filename).toMatch(/^discoverability-/);
    const bytes = Buffer.from(payload.attachments[0].content, "base64");
    expect(bytes.slice(0, 4).toString()).toBe("%PDF");
  });

  it("attaches JSON with the score when format is json", async () => {
    await sendReportEmail({ kind: "discoverability", recipient: "a@b.com", format: "json", audit: AUDIT });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const json = JSON.parse(Buffer.from(payload.attachments[0].content, "base64").toString("utf-8"));
    expect(json.framework_scores.overall).toBe(78);
    expect(json.export.tool).toBe("DatIQ");
  });
});
