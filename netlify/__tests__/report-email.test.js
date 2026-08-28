// netlify/functions/report-email.test.js
// POST /api/report-email — emails an extraction/batch/discoverability report
// with the actual file attached (see lib/reportEmail.js). The one rule this
// endpoint exists to enforce: the recipient is ALWAYS the authenticated
// session's own email, never something a client can supply.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateBearer: vi.fn() }));
vi.mock("../functions/lib/supabaseServerClient.js", () => authMock);

const sendMock = vi.hoisted(() => ({ sendReportEmail: vi.fn() }));
vi.mock("../functions/lib/reportEmail.js", () => sendMock);

const storeMock = vi.hoisted(() => ({ getAuditFull: vi.fn() }));
vi.mock("../functions/lib/audit/auditStore.js", () => storeMock);

const rehydrateMock = vi.hoisted(() => ({ rehydrate: vi.fn() }));
vi.mock("../functions/discoverability.js", () => rehydrateMock);

const entitlementMock = vi.hoisted(() => ({ requireCapability: vi.fn() }));
vi.mock("../functions/lib/requireEntitlement.js", () => entitlementMock);

let handler;

function post(body, { authorized = true } = {}) {
  return { httpMethod: "POST", headers: authorized ? { authorization: "Bearer jwt" } : {}, body: JSON.stringify(body) };
}

function extractionsFrom(rows) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: async () => ({ data: rows, error: null }),
  };
  return { from: () => chain };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateBearer.mockResolvedValue({
    ok: true,
    user: { id: "u1", email: "alice@example.com" },
    client: extractionsFrom([{ id: "e1", url: "https://lumio.io" }]),
  });
  sendMock.sendReportEmail.mockResolvedValue({ sent: true });
  storeMock.getAuditFull.mockResolvedValue({ audit: {}, result: {}, signals: [] });
  rehydrateMock.rehydrate.mockReturnValue({ target: { url: "https://lumio.io" }, finalScore: 78 });
  entitlementMock.requireCapability.mockResolvedValue({ check: { allowed: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/report-email.js");
  return mod.handler;
}

describe("report-email — authentication", () => {
  it("requires a signed-in user", async () => {
    authMock.authenticateBearer.mockResolvedValue({ ok: false, status: 401, body: { error: "Authentication required" } });
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"] }, { authorized: false }));
    expect(r.statusCode).toBe(401);
    expect(sendMock.sendReportEmail).not.toHaveBeenCalled();
  });

  it("refuses an account with no email on file", async () => {
    authMock.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u1", email: null }, client: extractionsFrom([]) });
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"] }));
    expect(r.statusCode).toBe(400);
    expect(sendMock.sendReportEmail).not.toHaveBeenCalled();
  });
});

describe("report-email — recipient is always server-resolved", () => {
  it("ignores any recipient/email field the client tries to send and uses the session's own email", async () => {
    const h = await loadHandler();
    await h(post({ kind: "extraction", ids: ["e1"], recipient: "attacker@evil.com", email: "attacker@evil.com" }));
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "alice@example.com" }),
    );
    const call = sendMock.sendReportEmail.mock.calls[0][0];
    expect(call.recipient).not.toBe("attacker@evil.com");
  });
});

describe("report-email — validation", () => {
  it("rejects an unknown kind", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "invoice", ids: ["e1"] }));
    expect(r.statusCode).toBe(400);
  });

  it("rejects an extraction/batch request with no ids", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: [] }));
    expect(r.statusCode).toBe(400);
    expect(sendMock.sendReportEmail).not.toHaveBeenCalled();
  });

  it("rejects a discoverability request with no auditId", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "discoverability" }));
    expect(r.statusCode).toBe(400);
  });

  it("404s when the requested extraction ids don't belong to the caller", async () => {
    authMock.authenticateBearer.mockResolvedValue({
      ok: true, user: { id: "u1", email: "alice@example.com" }, client: extractionsFrom([]),
    });
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["not-mine"] }));
    expect(r.statusCode).toBe(404);
  });

  it("404s when the requested audit doesn't exist for this user", async () => {
    storeMock.getAuditFull.mockResolvedValue(null);
    const h = await loadHandler();
    const r = await h(post({ kind: "discoverability", auditId: "a1" }));
    expect(r.statusCode).toBe(404);
  });
});

describe("report-email — extraction/batch send", () => {
  it("loads the rows scoped to the authenticated user and sends", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"], format: "csv" }));
    expect(r.statusCode).toBe(200);
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({
      kind: "extraction", format: "csv", items: [{ id: "e1", url: "https://lumio.io" }],
    }));
  });

  it("defaults to pdf format", async () => {
    const h = await loadHandler();
    await h(post({ kind: "extraction", ids: ["e1"] }));
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({ format: "pdf" }));
  });

  it("502s when the send fails", async () => {
    sendMock.sendReportEmail.mockResolvedValue({ sent: false, reason: "resend_error" });
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"] }));
    expect(r.statusCode).toBe(502);
  });
});

describe("report-email — Brand Kit", () => {
  const BRAND_KIT = { companyName: "Acme Research Co.", accentColor: "#0f766e" };

  it("passes a valid Brand Kit through when the caller is entitled", async () => {
    const h = await loadHandler();
    await h(post({ kind: "extraction", ids: ["e1"], brandKit: BRAND_KIT }));
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ brandKit: { companyName: "Acme Research Co.", accentColor: "#0f766e" } }),
    );
  });

  it("drops the Brand Kit (but still sends) when the caller is NOT entitled — never fails the email over it", async () => {
    entitlementMock.requireCapability.mockResolvedValue({ check: { allowed: false } });
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"], brandKit: BRAND_KIT }));
    expect(r.statusCode).toBe(200);
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({ brandKit: null }));
  });

  it("drops a malformed Brand Kit without failing the send, and never even checks entitlement for it", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "extraction", ids: ["e1"], brandKit: { accentColor: "not-a-color" } }));
    expect(r.statusCode).toBe(200);
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({ brandKit: null }));
    expect(entitlementMock.requireCapability).not.toHaveBeenCalled();
  });

  it("sends with brandKit: null when none is supplied at all", async () => {
    const h = await loadHandler();
    await h(post({ kind: "extraction", ids: ["e1"] }));
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({ brandKit: null }));
    expect(entitlementMock.requireCapability).not.toHaveBeenCalled();
  });
});

describe("report-email — discoverability send", () => {
  it("loads and rehydrates the audit scoped to the authenticated user, then sends", async () => {
    const h = await loadHandler();
    const r = await h(post({ kind: "discoverability", auditId: "a1" }));
    expect(r.statusCode).toBe(200);
    expect(storeMock.getAuditFull).toHaveBeenCalledWith("u1", "a1");
    expect(sendMock.sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({
      kind: "discoverability", audit: { target: { url: "https://lumio.io" }, finalScore: 78 },
    }));
  });
});
