// netlify/__tests__/lib/supabaseServerClient.test.js
//
// Regression test for the 2026-08-13 "Node.js 20 detected without native
// WebSocket support" bug: @supabase/supabase-js >=2.108 eagerly constructs
// a RealtimeClient inside createClient(), which synchronously THROWS on
// any Node runtime without a native global WebSocket (Node <22 — i.e.
// every Netlify Function) unless a `transport` is supplied. This broke
// every Netlify Function that calls createClient(), surfacing to users as
// "Internal error: Node.js 20 detected..." on every integration connect
// (Notion, HubSpot, Airtable, Slack, Zapier) and, unnoticed, on every other
// authenticated endpoint (extractions, schedules, invoices, entitlements).
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { noRealtimeOptions } from "../../functions/lib/supabaseServerClient.js";

describe("supabaseServerClient — noRealtimeOptions", () => {
  it("forces a transport so createClient() never calls getWebSocketConstructor()", () => {
    const opts = noRealtimeOptions({ auth: { persistSession: false } });
    expect(opts.realtime).toBeTruthy();
    expect(typeof opts.realtime.transport).toBe("function");
    // caller's own options must survive untouched
    expect(opts.auth).toEqual({ persistSession: false });
  });

  it("preserves any caller-supplied realtime sub-options alongside the forced transport", () => {
    const opts = noRealtimeOptions({ realtime: { timeout: 5000 } });
    expect(opts.realtime.timeout).toBe(5000);
    expect(typeof opts.realtime.transport).toBe("function");
  });

  it("does not throw when created under a Node-20-shaped environment (no native WebSocket) — the exact crash Netlify Functions hit", () => {
    const savedWS = globalThis.WebSocket;
    // Netlify Functions run on Node 20, which has no native global
    // WebSocket. Simulate that here regardless of the test runner's own
    // Node version.
    // eslint-disable-next-line no-undef
    delete globalThis.WebSocket;
    try {
      // Without the fix this throws:
      //   "Node.js 20 detected without native WebSocket support. ..."
      expect(() =>
        createClient(
          "https://example.supabase.co",
          "anon-key",
          noRealtimeOptions({ auth: { persistSession: false } })
        )
      ).not.toThrow();
    } finally {
      globalThis.WebSocket = savedWS;
    }
  });

  it("reproduces the bug when the transport is NOT supplied (proves the test actually detects the regression)", () => {
    const savedWS = globalThis.WebSocket;
    // eslint-disable-next-line no-undef
    delete globalThis.WebSocket;
    try {
      expect(() =>
        createClient("https://example.supabase.co", "anon-key", {
          auth: { persistSession: false },
        })
      ).toThrow(/WebSocket/i);
    } finally {
      globalThis.WebSocket = savedWS;
    }
  });
});
