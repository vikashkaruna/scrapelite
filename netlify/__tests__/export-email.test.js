// netlify/__tests__/export-email.test.js — POST /api/export-email
//
// The contract that matters most: this is signed-in only (unlike most
// capability checks in this codebase, which fail open for a guest), because
// it sends mail to an arbitrary, client-supplied recipient list. Everything
// else mirrors the existing export/email gating (export.<fmt> + export.email)
// so emailing a format is never more permissive than downloading it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "u1", email: "u1@example.com" } },
  error: null,
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

// requireCapabilityForUser hits the entitlements table via plain fetch() —
// not the mocked @supabase/supabase-js client — which would otherwise
// consume slots from this file's Resend fetch mock (see the integrations-*
// contract tests for the same trap, hit and fixed there first).
const mockRequireCapabilityForUser = vi.fn().mockResolvedValue({ check: { allowed: true } });
vi.mock("../functions/lib/requireEntitlement.js", () => ({
  requireCapabilityForUser: (...args) => mockRequireCapabilityForUser(...args),
  denyBody: (check) => ({ error: check.reason, code: check.code, upgradeTo: check.upgradeTo ?? null }),
  DENY_STATUS: 402,
}));

// jsPDF's real Node build is heavy for a unit test — mock the PDF builder,
// the same way the CSV/Markdown/JSON builders (pure, cheap) are left real.
vi.mock("../../src/lib/pdfExport.js", () => ({
  extractionsPdfBuffer: vi.fn(() => new TextEncoder().encode("%PDF-fake").buffer),
  extractionsPdfFilename: vi.fn(() => "datiq-export.pdf"),
}));

import { handler } from "../functions/export-email.js";

const ITEM = { id: "e1", url: "https://acme.com/pricing", page_title: "Acme Pricing", headings: [], links: [] };

function makeEvent(overrides = {}, httpMethod = "POST") {
  return {
    httpMethod,
    headers: { authorization: "Bearer jwt" },
    body: JSON.stringify({
      items: [ITEM],
      format: "csv",
      to: ["reader@example.com"],
      ...overrides,
    }),
  };
}

const parse = (r) => JSON.parse(r.body);
const sentPayload = () => JSON.parse(global.fetch.mock.calls[0][1].body);

function resendOk(id = "re_123") {
  return { ok: true, status: 200, json: () => Promise.resolve({ id }), text: () => Promise.resolve("") };
}

describe("export-email", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_KEY = "service";
    process.env.RESEND_API_KEY = "resend-key";
    delete process.env.EXPORT_EMAIL_FROM;
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: "u1@example.com" } }, error: null });
    mockRequireCapabilityForUser.mockResolvedValue({ check: { allowed: true } });
    global.fetch = vi.fn(() => Promise.resolve(resendOk()));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ── Method + auth ────────────────────────────────────────────────────────

  it("returns 204 for OPTIONS preflight", async () => {
    const r = await handler(makeEvent({}, "OPTIONS"));
    expect(r.statusCode).toBe(204);
  });

  it("rejects non-POST methods", async () => {
    const r = await handler(makeEvent({}, "GET"));
    expect(r.statusCode).toBe(405);
  });

  it("refuses an unauthenticated request — unlike most capability checks, this endpoint does NOT fail open for guests", async () => {
    const r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ items: [ITEM], format: "csv", to: ["x@example.com"] }) });
    expect(r.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Payload validation ───────────────────────────────────────────────────

  it("rejects malformed JSON", async () => {
    const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer jwt" }, body: "not-json" });
    expect(r.statusCode).toBe(400);
  });

  it("rejects an unknown format", async () => {
    const r = await handler(makeEvent({ format: "xlsx" }));
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/format must be one of/i);
  });

  it("rejects an empty items array", async () => {
    const r = await handler(makeEvent({ items: [] }));
    expect(r.statusCode).toBe(400);
  });

  it("rejects more than the per-email item cap", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ ...ITEM, id: `e${i}` }));
    const r = await handler(makeEvent({ items }));
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/at most 200/i);
  });

  it("rejects when no recipient is given", async () => {
    const r = await handler(makeEvent({ to: [] }));
    expect(r.statusCode).toBe(400);
  });

  it("rejects an invalid recipient address", async () => {
    const r = await handler(makeEvent({ to: ["not-an-email"] }));
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/invalid email/i);
  });

  it("rejects more than 10 recipients", async () => {
    const to = Array.from({ length: 11 }, (_, i) => `r${i}@example.com`);
    const r = await handler(makeEvent({ to }));
    expect(r.statusCode).toBe(400);
  });

  it("dedupes recipients", async () => {
    const r = await handler(makeEvent({ to: ["a@example.com", "a@example.com", "A@Example.com"] }));
    expect(r.statusCode).toBe(200);
    expect(parse(r).sent).toBe(2);
  });

  // ── Entitlement gating (server-side mirror of checkCanEmail/checkCanExport) ─

  it("refuses with 402 when export.email is denied, before touching Resend", async () => {
    mockRequireCapabilityForUser.mockImplementation((userId, cap) =>
      Promise.resolve({ check: cap === "export.email" ? { allowed: false, reason: "Email export is not available on your current plan.", code: "NOT_IN_PLAN" } : { allowed: true } }),
    );
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(402);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses with 402 when export.<format> is denied, before touching Resend", async () => {
    mockRequireCapabilityForUser.mockImplementation((userId, cap) =>
      Promise.resolve({ check: cap === "export.json" ? { allowed: false, reason: "JSON export is not available on your current plan.", code: "NOT_IN_PLAN" } : { allowed: true } }),
    );
    const r = await handler(makeEvent({ format: "json" }));
    expect(r.statusCode).toBe(402);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("checks both export.email and export.<format>", async () => {
    await handler(makeEvent({ format: "markdown" }));
    const caps = mockRequireCapabilityForUser.mock.calls.map((c) => c[1]);
    expect(caps).toEqual(expect.arrayContaining(["export.email", "export.markdown"]));
  });

  // ── Attachment building per format ──────────────────────────────────────

  it("sends CSV as the attachment for format=csv", async () => {
    const r = await handler(makeEvent({ format: "csv" }));
    expect(r.statusCode).toBe(200);
    const payload = sentPayload();
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toMatch(/\.csv$/);
    const decoded = Buffer.from(payload.attachments[0].content, "base64").toString("utf8");
    expect(decoded).toContain("acme.com");
  });

  it("sends Markdown as the attachment for format=markdown", async () => {
    const r = await handler(makeEvent({ format: "markdown" }));
    expect(r.statusCode).toBe(200);
    const payload = sentPayload();
    expect(payload.attachments[0].filename).toMatch(/\.md$/);
  });

  it("sends JSON as the attachment for format=json", async () => {
    const r = await handler(makeEvent({ format: "json" }));
    expect(r.statusCode).toBe(200);
    const payload = sentPayload();
    expect(payload.attachments[0].filename).toMatch(/\.json$/);
    const decoded = JSON.parse(Buffer.from(payload.attachments[0].content, "base64").toString("utf8"));
    expect(decoded.export.count).toBe(1);
  });

  it("sends PDF as the attachment for format=pdf, via the mocked Node-safe PDF builder", async () => {
    const r = await handler(makeEvent({ format: "pdf" }));
    expect(r.statusCode).toBe(200);
    const payload = sentPayload();
    expect(payload.attachments[0].filename).toBe("datiq-export.pdf");
    const decoded = Buffer.from(payload.attachments[0].content, "base64").toString("utf8");
    expect(decoded).toContain("%PDF-fake");
  });

  // ── Resend payload shape ─────────────────────────────────────────────────

  it("uses EXPORT_EMAIL_FROM when set, defaults to hello@datiq.app otherwise", async () => {
    await handler(makeEvent());
    expect(sentPayload().from).toBe("DatIQ <hello@datiq.app>");

    process.env.EXPORT_EMAIL_FROM = "DatIQ Exports <exports@datiq.app>";
    global.fetch.mockClear();
    await handler(makeEvent());
    expect(sentPayload().from).toBe("DatIQ Exports <exports@datiq.app>");
  });

  it("always replies to hello@datiq.app regardless of sender", async () => {
    await handler(makeEvent());
    expect(sentPayload().reply_to).toBe("hello@datiq.app");
  });

  it("subject names the count and the format", async () => {
    const items = [ITEM, { ...ITEM, id: "e2" }];
    await handler(makeEvent({ items, format: "pdf" }));
    expect(sentPayload().subject).toMatch(/2 extractions \(PDF\)/);
  });

  // ── Infra failures ───────────────────────────────────────────────────────

  it("returns 503 when RESEND_API_KEY is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 502 when Resend responds with a non-OK status, without leaking the response body", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited, key=secret") }));
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(502);
    expect(parse(r).error).not.toContain("secret");
  });

  it("returns 502 when the Resend request throws", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(502);
  });
});
