// src/components/EditIntegrationModal.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditIntegrationModal from "./EditIntegrationModal.jsx";

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "mock-jwt" } },
      }),
    },
  },
}));

vi.mock("../lib/integrationsClient.js", () => ({
  patchIntegrationConnection: vi.fn(),
  testIntegrationConnection: vi.fn(),
  fetchAirtableTablesClient: vi.fn().mockResolvedValue({ ok: true, tables: [] }),
  createAirtableTableClient: vi.fn().mockResolvedValue({ ok: true }),
}));

import { supabase } from "../lib/supabaseClient.js";
import {
  patchIntegrationConnection,
  testIntegrationConnection,
} from "../lib/integrationsClient.js";

describe("EditIntegrationModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "mock-jwt" } },
    });
    patchIntegrationConnection.mockResolvedValue({ ok: true });
    testIntegrationConnection.mockResolvedValue({ ok: true, detail: "Connection verified" });
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Zapier fields and allows editing Webhook URL", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <EditIntegrationModal
        open={true}
        slug="zapier"
        status={{
          connected: true,
          provider: "zapier",
          connection: {
            account_label: "Zapier Account",
            token_hint: "1a2b",
            webhook_url: "https://hooks.zapier.com/hooks/catch/111/aaa",
          },
        }}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    expect(screen.getByRole("heading", { name: /Edit Zapier/i })).toBeInTheDocument();
    const input = screen.getByDisplayValue("https://hooks.zapier.com/hooks/catch/111/aaa");
    expect(input).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "https://hooks.zapier.com/hooks/catch/222/bbb");
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(patchIntegrationConnection).toHaveBeenCalledWith("zapier", {
        action: "connect",
        accountLabel: "Zapier Account",
        webhookUrl: "https://hooks.zapier.com/hooks/catch/222/bbb",
      });
    });
  });

  it("handles token rotation for Zapier", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: "zap_minted_secret_token_123" }),
    });

    render(
      <EditIntegrationModal
        open={true}
        slug="zapier"
        status={{
          connected: true,
          provider: "zapier",
          connection: {
            account_label: "Zapier",
            token_hint: "9999",
          },
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const rotateBtn = screen.getByRole("button", { name: /Rotate \/ mint new secret token/i });
    await user.click(rotateBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/integrations/zapier/connect",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ regenerate: true, action: "connect" }),
        })
      );
    });

    expect(await screen.findByText(/New token minted/i)).toBeInTheDocument();
    expect(screen.getByText("zap_minted_secret_token_123")).toBeInTheDocument();
  });

  it("handles secret key testing with success and error feedback", async () => {
    const user = userEvent.setup();
    testIntegrationConnection.mockResolvedValueOnce({
      ok: false,
      error: "Secret key invalid or does not match active token.",
    });

    render(
      <EditIntegrationModal
        open={true}
        slug="zapier"
        status={{
          connected: true,
          provider: "zapier",
          connection: {
            token_hint: "abcd",
          },
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const keyInput = screen.getByPlaceholderText(/Paste zap_\.\.\. token to test/i);
    await user.type(keyInput, "zap_wrong_secret");
    await user.click(screen.getByRole("button", { name: /Verify key/i }));

    expect(await screen.findByText(/Secret key invalid or does not match active token/i)).toBeInTheDocument();

    testIntegrationConnection.mockResolvedValueOnce({
      ok: true,
      detail: "Secret key is valid and matches active token.",
    });

    await user.clear(keyInput);
    await user.type(keyInput, "zap_correct_secret");
    await user.click(screen.getByRole("button", { name: /Verify key/i }));

    expect(await screen.findByText(/Secret key is valid and matches active token/i)).toBeInTheDocument();
  });

  it("handles test connection button in footer", async () => {
    const user = userEvent.setup();
    testIntegrationConnection.mockResolvedValue({
      ok: true,
      detail: "Zapier test ping sent to webhook.",
    });

    render(
      <EditIntegrationModal
        open={true}
        slug="zapier"
        status={{
          connected: true,
          provider: "zapier",
          connection: {
            webhook_url: "https://hooks.zapier.com/hooks/catch/123/456",
          },
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() => {
      expect(testIntegrationConnection).toHaveBeenCalledWith("zapier");
    });
    expect(await screen.findByText(/Zapier test ping sent to webhook/i)).toBeInTheDocument();
  });
});
