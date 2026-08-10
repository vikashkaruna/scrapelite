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

import { PUSH_PROVIDERS, pushToIntegration, getIntegrationStatus } from "./integrationsClient.js";

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
  it("includes slack alongside hubspot, notion, airtable", () => {
    const slugs = PUSH_PROVIDERS.map((p) => p.slug);
    expect(slugs).toContain("hubspot");
    expect(slugs).toContain("notion");
    expect(slugs).toContain("airtable");
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

describe("integrationsClient — pushToIntegration(slack)", () => {
  const items = [
    { id: "e1", url: "https://a.com", page_title: "A" },
    { id: "e2", url: "https://b.com", page_title: "B" },
  ];

  it("POSTs to /api/integrations/slack/send with the items list", async () => {
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
        body: JSON.stringify({ items }),
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
