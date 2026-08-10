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
