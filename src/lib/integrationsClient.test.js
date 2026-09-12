// src/lib/integrationsClient.test.js
//
// Focused on the slack branch of pushToIntegration — the only one that
// has a special 412 not-connected case the client must surface. The other
// branches (hubspot / notion / airtable) are tested through their
// dedicated lib tests + the ExportIntegrations integration tests.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "jwt" } },
      }),
    },
  },
}));

import {
  PUSH_PROVIDERS,
  pushToIntegration,
  getIntegrationStatus,
  testIntegrationConnection,
} from "./integrationsClient.js";

beforeEach(() => {
  // Don't use vi.resetAllMocks() here — it would wipe the supabase.auth
  // mock from the module-level vi.mock factory, and getAccessToken()
  // would then throw "not_signed_in" on every call. clearAllMocks()
  // preserves implementations but clears call records, which is what we
  // want for the per-test global fetch setup.
  vi.clearAllMocks();
  globalThis.fetch = vi.fn();
});

describe("integrationsClient — PUSH_PROVIDERS", () => {
  it("includes slack and zapier alongside hubspot, notion, airtable", () => {
    const slugs = PUSH_PROVIDERS.map((p) => p.slug);
    expect(slugs).toContain("hubspot");
    expect(slugs).toContain("notion");
    expect(slugs).toContain("airtable");
    expect(slugs).toContain("zapier");
    expect(slugs).toContain("slack");
  });

  it("every entry has the shape the menu component expects (slug, name, icon, desc)", () => {
    for (const p of PUSH_PROVIDERS) {
      expect(p.slug).toBeTypeOf("string");
      expect(p.name).toBeTypeOf("string");
      expect(p.icon).toBeTypeOf("string");
      expect(p.desc).toBeTypeOf("string");
    }
  });
});

describe("integrationsClient — pushToIntegration(zapier)", () => {
  const items = [
    { id: "e1", url: "https://a.com", page_title: "A" },
    { id: "e2", url: "https://b.com", page_title: "B" },
  ];

  it("POSTs to /api/integrations/zapier/push with the items list + action dispatch", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true, pushed: 2, total: 2 }),
    });

    const r = await pushToIntegration("zapier", items);
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/integrations/zapier/push",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items, action: "push" }),
      })
    );
  });
});

describe("integrationsClient — pushToIntegration(slack)", () => {
  const items = [
    { id: "e1", url: "https://a.com", page_title: "A" },
    { id: "e2", url: "https://b.com", page_title: "B" },
  ];

  it("POSTs to /api/integrations/slack/send with the items list + action dispatch", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, sent: 2, total: 2, errors: [], failedRecords: [] }),
    });
    const result = await pushToIntegration("slack", items);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/integrations/slack/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items, action: "send" }),
      })
    );
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(2);
    expect(result.total).toBe(2);
    expect(result.failedRecords).toEqual([]);
  });

  it("surfaces 412 as a structured not_connected result (no error throw)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 412,
      text: async () => JSON.stringify({ error: "Slack is not connected. Set a webhook URL in Account → Integrations." }),
    });
    const result = await pushToIntegration("slack", items);
    expect(result.ok).toBe(false);
    expect(result.not_connected).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.total).toBe(items.length);
    expect(result.message).toMatch(/not connected/i);
  });

  it("surfaces per-item failures in failedRecords (server returns 200 with body.ok:false)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: false,
        sent: 1,
        total: 2,
        errors: ["slack_429"],
        failedRecords: [{ url: "https://b.com", error: "slack_429" }],
      }),
    });
    const result = await pushToIntegration("slack", items);
    expect(result.ok).toBe(false);
    expect(result.pushed).toBe(1);
    expect(result.total).toBe(2);
    expect(result.failedRecords).toHaveLength(1);
  });

  it("returns no_items for an empty list (no network call)", async () => {
    const result = await pushToIntegration("slack", []);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_items");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("integrationsClient — pushToIntegration(airtable) 412 path", () => {
  // 2026-08-11 fix: the Airtable branch of pushToIntegration previously
  // only surfaced generic errors on non-2xx, so a 412 "Airtable is not
  // connected" came back as a red error box in the Export modal instead
  // of a friendly "Set up Airtable in Account → Integrations" link.
  // Slack had this from the start; Airtable/Notion now do too.
  const items = [{ id: "e1", url: "https://a.com", page_title: "A" }];

  it("surfaces 412 as a structured not_connected result for Airtable", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 412,
      text: async () => JSON.stringify({ error: "Airtable is not connected. Set it up in Account → Integrations." }),
    });
    const result = await pushToIntegration("airtable", items);
    expect(result.ok).toBe(false);
    expect(result.not_connected).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.total).toBe(items.length);
    expect(result.message).toMatch(/not connected/i);
    // The Export modal's onAirtablePush branches on result.not_connected
    // to render the "Set up Airtable in Account → Integrations" link
    // and refresh providerStatus. This test pins that contract.
  });

  it("surfaces 412 as a structured not_connected result for Notion", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 412,
      text: async () => JSON.stringify({ error: "Notion is not connected. Set it up in Account → Integrations." }),
    });
    const result = await pushToIntegration("notion", items);
    expect(result.ok).toBe(false);
    expect(result.not_connected).toBe(true);
    expect(result.message).toMatch(/not connected/i);
  });

  it("does NOT set not_connected for a generic 500 (still a hard error)", async () => {
    // 412 is the only "missing connection" status. Other 4xx/5xx are
    // real errors and should surface as such — the modal shows them in
    // the red error box, not as a "set up" link.
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "internal error" }),
    });
    const result = await pushToIntegration("airtable", items);
    expect(result.ok).toBe(false);
    expect(result.not_connected).toBeUndefined();
  });
});

describe("integrationsClient — getIntegrationStatus", () => {
  it("returns { connected: false } when the server returns a non-2xx", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "upstream_500" }),
    });
    const s = await getIntegrationStatus("slack");
    expect(s.connected).toBe(false);
    expect(s.error).toBeDefined();
  });

  it("passes through the server payload on 2xx", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        connected: true,
        provider: "slack",
        connection: { has_webhook: true, account_label: "Test" },
      }),
    });
    const s = await getIntegrationStatus("slack");
    expect(s.connected).toBe(true);
    expect(s.connection.account_label).toBe("Test");
  });
});

describe("integrationsClient — testIntegrationConnection(zapier)", () => {
  it("POSTs to the authenticated /api/integrations/zapier/test endpoint", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true, type: "webhook", detail: "Catch Hook received test ping successfully" }),
    });

    const result = await testIntegrationConnection("zapier");

    expect(result).toEqual({ ok: true, type: "webhook", detail: "Catch Hook received test ping successfully" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/integrations/zapier/test",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ action: "test" }),
      }),
    );
  });

  it("returns the error when Zapier is disconnected", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 412,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: "Zapier is not connected." }),
    });

    const result = await testIntegrationConnection("zapier");

    expect(result).toEqual({ ok: false, error: "Zapier is not connected." });
  });
});

describe("integrationsClient — Edge Access (Netlify SSO) handling", () => {
  // The branch deploy is SSO-gated by Netlify Edge Access. An unauth'd
  // request gets 401 with an HTML body that JS-redirects to
  // app.netlify.com/edge-access. The old authedFetch used to dump that
  // HTML into `body.error` verbatim — the user saw a multi-KB HTML
  // string in the toast. The fix detects the HTML shape and substitutes
  // a clear "refresh and sign in" message. These tests pin that
  // behavior so a future refactor can't regress to the raw-HTML toast.
  const htmlBody =
    "<!DOCTYPE html><html><body><script>window.location.href = " +
    "'https://app.netlify.com/edge-access?domain=...&requested_path=...';</script></body></html>";

  it("authedFetch substitutes the HTML 401 with a clear Edge Access message", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      text: async () => htmlBody,
    });
    const r = await getIntegrationStatus("slack");
    expect(r.connected).toBe(false);
    expect(r.error).toMatch(/Site authentication required/);
    // The marker field lets callers (e.g. the dashboard toast) react
    // specifically to the Edge Access case if they want to.
    expect(r.edgeAccess).toBe(true);
    // Critically: the raw HTML must NOT appear in the error string.
    expect(r.error).not.toMatch(/<!DOCTYPE/);
  });

  it("authedFetch still surfaces a real JSON error from the function (non-Edge-Access path)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify({ error: "HubSpot rejected the token (status 401)." }),
    });
    const r = await getIntegrationStatus("hubspot");
    expect(r.connected).toBe(false);
    expect(r.error).toMatch(/HubSpot rejected the token/);
    expect(r.edgeAccess).toBeUndefined();
  });

  it("pushToIntegration substitutes the HTML 401 in the call-level error (not raw HTML)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      text: async () => htmlBody,
    });
    const result = await pushToIntegration("slack", [
      { id: "e1", url: "https://a.com" },
      { id: "e2", url: "https://b.com" },
    ]);
    // When the WHOLE call fails (network/SSO/upstream 4xx/5xx), the
    // pushToIntegration wrapper reports a single call-level error —
    // there's no per-row information to put in failedRecords yet.
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Site authentication required/);
    expect(result.errors[0]).toMatch(/Site authentication required/);
    // The raw HTML must not appear anywhere in the user-facing fields.
    expect(result.message).not.toMatch(/<!DOCTYPE/);
    expect(JSON.stringify(result)).not.toMatch(/<!DOCTYPE/);
  });

  it("every request sets credentials: 'same-origin' (Edge Access cookie must travel)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ connected: false, provider: "slack" }),
    });
    await getIntegrationStatus("slack");
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.credentials).toBe("same-origin");
  });
});
