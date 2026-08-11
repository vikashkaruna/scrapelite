// src/components/IntegrationConnectModal.test.jsx
//
// Focused on the Zapier flow because it had a regression (§19) where
// the modal's "Generate a new token" option mapped to { regenerate: false }
// and the server (correctly) rejected it with "Provide either { token }
// to store an existing token, or { regenerate: true } to mint a new one."
// The server-required regenerate:true was only sent by "Replace the
// existing token", so the default-and-only-option users actually wanted
// ("Generate a new token") was broken.
//
// Fix: the Zapier provider now has an empty fields array; the modal
// always sends { regenerate: true } and shows a standalone help
// paragraph explaining that every connect mints a fresh token.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegrationConnectModal from "./IntegrationConnectModal.jsx";

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "jwt" } },
      }),
    },
  },
}));

import { supabase } from "../lib/supabaseClient.js";

const PROVIDER_SLUG = "zapier";

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: "jwt" } },
  });
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderModal(overrides = {}) {
  const onClose = vi.fn();
  const onConnected = vi.fn();
  const onTokenMinted = vi.fn();
  const result = render(
    <IntegrationConnectModal
      open
      provider={PROVIDER_SLUG}
      onClose={onClose}
      onConnected={onConnected}
      onTokenMinted={onTokenMinted}
      {...overrides}
    />
  );
  return { onClose, onConnected, onTokenMinted, ...result };
}

describe("IntegrationConnectModal — Zapier", () => {
  it("renders the standalone help text (no select, no fields)", () => {
    const { container } = renderModal();
    // The modal title (h3) is the only accessible landmark.
    expect(screen.getByRole("heading", { name: /Connect Zapier/i })).toBeInTheDocument();
    // The desc is in a paragraph under the heading.
    expect(screen.getByText(/Generate a DatIQ Zapier token/i)).toBeInTheDocument();
    // The select is gone. There's no "Action" label and no
    // "Generate a new token" / "Replace the existing token" options.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The provider-level help (no fields) renders as a .icm-help-standalone
    // paragraph with both "mint a fresh token" and "invalidated" in it.
    const helpNode = container.querySelector(".icm-help-standalone");
    expect(helpNode).toBeInTheDocument();
    expect(helpNode.textContent).toMatch(/mint a fresh token/i);
    expect(helpNode.textContent).toMatch(/invalidated/i);
    // The submit button still says "Connect Zapier".
    expect(screen.getByRole("button", { name: /Connect Zapier/i })).toBeInTheDocument();
  });

  it("clicking Connect Zapier POSTs { regenerate: true, action: 'connect' } and never the old { token } shape", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, connected: true, token: "zap_NEWLY_MINTED" }),
    });
    renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/integrations/zapier/connect");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    // The fix: regenerate MUST be true (server only mints on true).
    expect(body.regenerate).toBe(true);
    // body.action is the dispatch-source fallback for the §15/§16 fix.
    expect(body.action).toBe("connect");
    // No leftover _regenerate field.
    expect(body._regenerate).toBeUndefined();
    // No leftover token field.
    expect(body.token).toBeUndefined();
  });

  it("shows the mint-once copy-box with the new plaintext token on success", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, connected: true, token: "zap_NEWLY_MINTED" }),
    });
    const { onTokenMinted, onConnected } = renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    // The plaintext appears in a <code> element inside .icm-token-box.
    await waitFor(() => {
      expect(screen.getByText("zap_NEWLY_MINTED")).toBeInTheDocument();
    });
    expect(screen.getByText(/won't be shown again/i)).toBeInTheDocument();
    expect(onTokenMinted).toHaveBeenCalledWith("zap_NEWLY_MINTED");
    expect(onConnected).toHaveBeenCalled();
  });

  it("surfaces the server error inline (no thrown exception) when connect fails", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Provide either { token } to store an existing token, or { regenerate: true } to mint a new one." }),
    });
    renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    await waitFor(() => {
      expect(screen.getByText(/Provide either \{ token \}/i)).toBeInTheDocument();
    });
  });

  it("rejects when the user is not signed in (no fetch call)", async () => {
    const user = userEvent.setup();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    await waitFor(() => {
      expect(screen.getByText(/You must be signed in/i)).toBeInTheDocument();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Regression: branch deploys are gated by Netlify Edge Access. An
  // unauth'd fetch returns 401 with an HTML body that JS-redirects to
  // app.netlify.com/edge-access. The old code's res.json().catch(() => ({}))
  // turned that into the bare string "HTTP 401" — which made it look
  // like the user's HubSpot token was bad when in fact it was the
  // platform blocking them. The fix detects the HTML shape and shows
  // a clear, actionable message.
  it("surfaces Edge Access 401 (HTML body) as a 'refresh and sign in' message, not 'HTTP 401'", async () => {
    const user = userEvent.setup();
    // Netlify Edge Access shape: 401, text/html, body is the login
    // redirect JS page. json() throws (caller catches it) and the
    // modal must NOT fall back to "HTTP 401".
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      text: async () => "<!DOCTYPE html><html>...edge-access redirect...</html>",
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });
    renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    await waitFor(() => {
      expect(screen.getByText(/Site authentication required/i)).toBeInTheDocument();
    });
    // Critically: the user must NOT see the bare "HTTP 401" — that's
    // the whole bug we're fixing.
    expect(screen.queryByText(/^HTTP 401$/)).not.toBeInTheDocument();
  });

  it("sets credentials: 'same-origin' so the Edge Access cookie travels with the request", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, connected: true, token: "zap_NEW" }),
    });
    renderModal();
    await user.click(screen.getByRole("button", { name: /Connect Zapier/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const init = globalThis.fetch.mock.calls[0][1];
    // The same-origin default WOULD include cookies, but explicit is
    // defensive against future bundler changes.
    expect(init.credentials).toBe("same-origin");
  });
});

// 2026-08-11 fix: the Account UI's "Connect X" modal used to show
// "HTTP 502" with nothing else when a Netlify function crashed before
// producing a structured `error` field. The fix is two-part:
//   1. The Slack / Zapier / Notion handlers now wrap their dispatch in
//      try/catch and return 500 + err.message. HubSpot + Airtable
//      already did this.
//   2. The modal now reads the response body as text first, parses it
//      if possible, and falls back to data.errorMessage / data.message
//      / the first non-empty string in the body / a 240-char snippet
//      of the raw body — in that order — before giving up on "HTTP
//      <status>". The old `data.error || \`HTTP ${res.status}\``
//      fallback hid every non-`error`-shaped 5xx, which made every
//      function crash a black box. These tests pin the new fallback
//      chain so a future refactor can't regress to the bare "HTTP 502"
//      message.
//
// Helper: provider-aware "click Connect" — providers with required
// fields (slack / notion / airtable / hubspot) need the field filled
// before submit; zapier has no fields, so no fill is needed. Without
// this, the browser's native form-validation blocks submit and the
// test times out without ever seeing the error path.
async function clickConnect(user, provider) {
  if (provider === "slack") {
    await user.type(screen.getByLabelText(/Slack Incoming Webhook URL/i), "https://hooks.slack.com/services/X/Y/Z");
  } else if (provider === "notion") {
    await user.type(screen.getByLabelText(/Notion Internal Integration secret/i), "secret_abcdefghijklmnop");
    await user.type(screen.getByLabelText(/Database ID/i), "abc".repeat(11));
  } else if (provider === "hubspot") {
    await user.type(screen.getByLabelText(/HubSpot Private App token/i), "pat-na1-abcdefghijklmnop1234");
  }
  await user.click(screen.getByRole("button", { name: new RegExp(`Connect ${provider[0].toUpperCase()}${provider.slice(1)}`, "i") }));
}

describe("IntegrationConnectModal — error fallback when data.error is missing (2026-08-11 fix)", () => {
  it("surfaces data.errorMessage when the response has no data.error (Netlify crash shape)", async () => {
    const user = userEvent.setup();
    // Netlify's function-injected crash body has { errorType,
    // errorMessage, trace } but no `error` field. Before the fix, the
    // modal showed "HTTP 502" and nothing else.
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({
        errorType: "Error",
        errorMessage: "Cannot read property 'foo' of undefined",
        trace: ["at handleConnect (integrations-slack.js:122:5)"],
      }),
      json: async () => ({
        errorType: "Error",
        errorMessage: "Cannot read property 'foo' of undefined",
        trace: ["at handleConnect (integrations-slack.js:122:5)"],
      }),
    });
    renderModal({ provider: "slack" });
    await clickConnect(user, "slack");
    await waitFor(() => {
      // The user must see the errorMessage, NOT the bare "HTTP 502".
      expect(screen.getByText(/Cannot read property 'foo' of undefined/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^HTTP 502$/)).not.toBeInTheDocument();
  });

  it("surfaces the Internal error message from the new try/catch handler wrap (500 response)", async () => {
    const user = userEvent.setup();
    // After the §2026-08-11 fix, the Slack/Zapier/Notion handlers
    // return 500 with { error: "Internal error: <msg>" } when a
    // downstream call throws. The modal must surface that, not
    // "HTTP 500".
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: "Internal error: simulated db down" }),
      json: async () => ({ error: "Internal error: simulated db down" }),
    });
    renderModal({ provider: "slack" });
    await clickConnect(user, "slack");
    await waitFor(() => {
      expect(screen.getByText(/simulated db down/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^HTTP 500$/)).not.toBeInTheDocument();
  });

  it("surfaces data.message as a fallback when the body has neither error nor errorMessage", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ message: "Service unavailable" }),
      json: async () => ({ message: "Service unavailable" }),
    });
    renderModal({ provider: "notion" });
    await clickConnect(user, "notion");
    await waitFor(() => {
      expect(screen.getByText(/Service unavailable/)).toBeInTheDocument();
    });
  });

  it("surfaces a snippet of a non-JSON 5xx body as a last-resort fallback", async () => {
    const user = userEvent.setup();
    // Some upstream proxy returns 502 with text/plain — a non-JSON
    // body. The modal must show SOMETHING from the body, not just
    // "HTTP 502".
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "text/plain" },
      text: async () => "Bad Gateway: upstream connection refused",
      json: async () => { throw new SyntaxError("Unexpected token B"); },
    });
    renderModal({ provider: "hubspot" });
    await clickConnect(user, "hubspot");
    await waitFor(() => {
      expect(screen.getByText(/upstream connection refused/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^HTTP 502$/)).not.toBeInTheDocument();
  });

  it("truncates a very long non-JSON body to a single-line snippet (≤240 chars)", async () => {
    const user = userEvent.setup();
    const long = "stacktrace_fragment " + "x".repeat(500);
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "text/plain" },
      text: async () => long,
      json: async () => { throw new SyntaxError("Unexpected token s"); },
    });
    renderModal({ provider: "hubspot" });
    await clickConnect(user, "hubspot");
    await waitFor(() => {
      // The 240-char cap is part of the contract: longer bodies get
      // truncated with … so the modal toast stays on one line.
      const nodes = screen.getAllByText(/stacktrace_fragment/);
      expect(nodes.length).toBeGreaterThan(0);
      const text = nodes[0].textContent || "";
      expect(text.length).toBeLessThanOrEqual(240);
      expect(text).toMatch(/…$/);
    });
  });

  it("still falls back to 'HTTP 502' only when the body is truly empty (the unavoidable case)", async () => {
    const user = userEvent.setup();
    // No JSON, no text — truly empty. The user gets the bare status
    // (this is the ONLY acceptable case for the old fallback now).
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      text: async () => "",
      json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
    });
    renderModal({ provider: "slack" });
    await clickConnect(user, "slack");
    await waitFor(() => {
      expect(screen.getByText(/^HTTP 502$/)).toBeInTheDocument();
    });
  });

  it("does NOT show the 'HTTP 502' fallback when a structured error is present", async () => {
    const user = userEvent.setup();
    // Sanity check that the existing data.error path still wins
    // (priority order: data.error > errorMessage > message > ...).
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({
        error: "Slack rejected the webhook: 404",
        errorMessage: "should be ignored",
      }),
      json: async () => ({
        error: "Slack rejected the webhook: 404",
        errorMessage: "should be ignored",
      }),
    });
    renderModal({ provider: "slack" });
    await clickConnect(user, "slack");
    await waitFor(() => {
      expect(screen.getByText(/Slack rejected the webhook: 404/)).toBeInTheDocument();
    });
    // The errorMessage must NOT win over the error field.
    expect(screen.queryByText(/should be ignored/)).not.toBeInTheDocument();
  });
});
