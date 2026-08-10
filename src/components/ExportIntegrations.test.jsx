// src/components/ExportIntegrations.test.jsx — F18 (export modal).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExportIntegrations from "./ExportIntegrations.jsx";

vi.mock("../lib/airtable.js", async () => {
  const actual = await vi.importActual("../lib/airtable.js");
  return {
    ...actual,
    pushToAirtable: vi.fn(),
  };
});
vi.mock("../lib/notion.js", async () => {
  const actual = await vi.importActual("../lib/notion.js");
  return {
    ...actual,
    pushToNotion: vi.fn(),
    fetchNotionSchema: vi.fn(),
  };
});
vi.mock("../lib/utils.js", async () => {
  const actual = await vi.importActual("../lib/utils.js");
  return {
    ...actual,
    openInGoogleSheets: vi.fn(),
  };
});

vi.mock("../lib/integrationsClient.js", () => ({
  getIntegrationStatus: vi.fn().mockResolvedValue({ connected: false }),
  pushToIntegration: vi.fn(),
  PUSH_PROVIDERS: [
    { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "CRM" },
    { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "DB" },
    { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Base" },
    { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Channel" },
  ],
}));

import { pushToAirtable } from "../lib/airtable.js";
import { pushToNotion, fetchNotionSchema } from "../lib/notion.js";
import { openInGoogleSheets } from "../lib/utils.js";
import { getIntegrationStatus, pushToIntegration } from "../lib/integrationsClient.js";

const sampleItems = [
  { id: "ext_a", url: "https://a.com", page_title: "A", host: "a.com", ai_summary: "s", created_at: "2026-07-19T00:00:00Z" },
  { id: "ext_b", url: "https://b.com", page_title: "B", host: "b.com", ai_summary: "s", created_at: "2026-07-19T00:00:00Z" },
];

function renderModal(overrides = {}) {
  const onClose = vi.fn();
  const result = render(
    <MemoryRouter>
      <ExportIntegrations items={sampleItems} onClose={onClose} {...overrides} />
    </MemoryRouter>
  );
  return { onClose, ...result };
}

beforeEach(() => {
  try {
    localStorage.removeItem("datiq.airtableConfig");
    localStorage.removeItem("datiq.notionConfig");
  } catch {}
  pushToAirtable.mockReset();
  pushToNotion.mockReset();
  fetchNotionSchema.mockReset();
  openInGoogleSheets.mockReset();
  getIntegrationStatus.mockReset();
  pushToIntegration.mockReset();
  // Default: Slack is connected (most tests don't care; the Slack-specific
  // tests override this to exercise the not-connected path).
  getIntegrationStatus.mockResolvedValue({ connected: true, connection: { account_label: "Test channel" } });
});

describe("ExportIntegrations (F18)", () => {
  it("renders the modal title and all five destination tabs", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Send to a destination/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Google Sheets/i })).toBeInTheDocument();
    // HubSpot was added in §13 follow-on parity work so the Batch
    // page's "Send to Destination" matches the Preview + Dashboard
    // PushIntegrationMenu. The tab MUST sit between Sheets and
    // Airtable to match the source order in ExportIntegrations.jsx.
    expect(screen.getByRole("tab", { name: /HubSpot/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Airtable/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Notion/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Slack/i })).toBeInTheDocument();
  });

  it("subheader names all five destinations (not just the original four)", () => {
    renderModal();
    // Pin the list of destinations in the subhead so a future
    // refactor that drops one (or reorders them) doesn't silently
    // mislead the user. The §13 parity commit added HubSpot here.
    const sub = screen.getByText(/Push 2 selected rows/i);
    expect(sub.textContent).toMatch(/Google Sheets/);
    expect(sub.textContent).toMatch(/HubSpot/);
    expect(sub.textContent).toMatch(/Airtable/);
    expect(sub.textContent).toMatch(/Notion/);
    expect(sub.textContent).toMatch(/Slack/);
  });

  it("shows the row count in the subtitle", () => {
    renderModal();
    expect(screen.getByText(/Push 2 selected rows/i)).toBeInTheDocument();
  });

  it("shows the empty-state hint when no items are passed", () => {
    renderModal({ items: [] });
    expect(screen.getByText(/No rows selected/i)).toBeInTheDocument();
  });

  it("Google Sheets tab is the default and explains the upload flow", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: /Google Sheets/i })).toHaveAttribute("aria-selected", "true");
    // Help text contains the upload step instructions (matches both the
    // paragraph and the ordered list — they describe the same flow)
    expect(screen.getAllByText(/File . Import . Upload/i).length).toBeGreaterThanOrEqual(1);
  });

  it("clicking the Sheets CTA downloads CSV + opens Google Sheets in a new tab", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: /Open Google Sheets/i }));
    expect(openInGoogleSheets).toHaveBeenCalledWith(sampleItems);
    expect(onClose).toHaveBeenCalled();
  });

  it("switching to Airtable shows the API key + Base + Table fields", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    expect(screen.getByLabelText(/API key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Table ID/i)).toBeInTheDocument();
  });

  it("Airtable push shows validation errors when fields are empty", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.click(screen.getByRole("button", { name: /Push .* record/i }));
    await waitFor(() => {
      expect(screen.getByText(/API key is required/i)).toBeInTheDocument();
    });
    expect(pushToAirtable).not.toHaveBeenCalled();
  });

  it("Airtable push with valid config calls pushToAirtable and closes the modal on success", async () => {
    const user = userEvent.setup();
    pushToAirtable.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.type(screen.getByLabelText(/API key/i), "patABCDEFGHIJKLMNOP");
    await user.type(screen.getByLabelText(/Base ID/i), "appABCDEFGHIJK");
    await user.type(screen.getByLabelText(/Table ID/i), "tblABCDEFGHIJK");
    await user.click(screen.getByRole("button", { name: /Push .* record/i }));
    await waitFor(() => expect(pushToAirtable).toHaveBeenCalledWith(
      sampleItems,
      expect.objectContaining({ apiKey: "patABCDEFGHIJKLMNOP", baseId: "appABCDEFGHIJK", tableId: "tblABCDEFGHIJK" }),
    ));
    expect(onClose).toHaveBeenCalled();
  });

  it("Airtable push with failure shows the failed-records error", async () => {
    const user = userEvent.setup();
    pushToAirtable.mockResolvedValue({
      ok: false, pushed: 0, total: 2, errors: ["1 record(s) failed"],
      failedRecords: [{ url: "https://a.com", error: "422 INVALID_VALUE_FOR_COLUMN" }],
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.type(screen.getByLabelText(/API key/i), "patABCDEFGHIJKLMNOP");
    await user.type(screen.getByLabelText(/Base ID/i), "appABCDEFGHIJK");
    await user.type(screen.getByLabelText(/Table ID/i), "tblABCDEFGHIJK");
    await user.click(screen.getByRole("button", { name: /Push .* record/i }));
    await waitFor(() => {
      expect(screen.getByText(/422 INVALID_VALUE_FOR_COLUMN/i)).toBeInTheDocument();
    });
  });

  it("Notion push shows validation errors when database ID is empty", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    await user.type(screen.getByLabelText(/API key/i), "secret_xxxxxxxxxxxxxx");
    await user.click(screen.getByRole("button", { name: /Push .* page/i }));
    await waitFor(() => {
      expect(screen.getByText(/Database ID is required/i)).toBeInTheDocument();
    });
    expect(pushToNotion).not.toHaveBeenCalled();
  });

  it("Notion: clicking 'Load columns' calls fetchNotionSchema and shows the schema list", async () => {
    const user = userEvent.setup();
    fetchNotionSchema.mockResolvedValue({
      ok: true,
      titleColumn: "Name",
      properties: { Name: "title", URL: "url", Summary: "rich_text" },
      rawTitle: "My DB",
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    await user.type(screen.getByLabelText(/API key/i), "secret_xxxxxxxxxxxxxx");
    await user.type(screen.getByLabelText(/Database ID/i), "abcdef0123456789abcdef0123456789");
    await user.click(screen.getByRole("button", { name: /Load columns/i }));
    await waitFor(() => {
      expect(fetchNotionSchema).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "secret_xxxxxxxxxxxxxx", databaseId: "abcdef0123456789abcdef0123456789" }));
    });
    expect(screen.getByText(/Schema loaded/i)).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("Notion push with valid config calls pushToNotion and closes the modal on success", async () => {
    const user = userEvent.setup();
    pushToNotion.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    await user.type(screen.getByLabelText(/API key/i), "secret_xxxxxxxxxxxxxx");
    await user.type(screen.getByLabelText(/Database ID/i), "abcdef0123456789abcdef0123456789");
    await user.click(screen.getByRole("button", { name: /Push .* page/i }));
    await waitFor(() => expect(pushToNotion).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc closes the modal", async () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click closes the modal", () => {
    const { onClose } = renderModal();
    const overlay = screen.getByRole("dialog");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking inside the modal does NOT close it", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText(/Send to a destination/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("HubSpot tab", () => {
    // HubSpot was added in the §13 parity work so the Batch page's
    // "Send to Destination" matches the Preview + Dashboard
    // PushIntegrationMenu. The tab shape mirrors Slack: connection
    // status only on the client (server uses the stored Private App
    // token), and a single button that fires pushToIntegration which
    // loops per-item server-side.
    it("shows the 'connected' status banner with the account label when HubSpot is set up", async () => {
      const user = userEvent.setup();
      getIntegrationStatus.mockImplementation(async (slug) => {
        if (slug === "hubspot") return { connected: true, connection: { account_label: "ACME CRM" } };
        return { connected: false };
      });
      renderModal();
      await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
      await waitFor(() => {
        expect(screen.getByText(/Connected as ACME CRM/)).toBeInTheDocument();
      });
      // The CTA copy should reflect the row count.
      expect(screen.getByRole("button", { name: /Push 2 records to HubSpot/i })).toBeEnabled();
    });

    it("shows the 'not connected' banner + setup link when HubSpot has no token", async () => {
      const user = userEvent.setup();
      getIntegrationStatus.mockImplementation(async (slug) => {
        if (slug === "hubspot") return { connected: false };
        return { connected: false };
      });
      renderModal();
      await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
      await waitFor(() => {
        expect(screen.getByText(/HubSpot isn.t connected yet/)).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /Push 2 records to HubSpot/i })).toBeDisabled();
    });

    it("'Push N records to HubSpot' calls pushToIntegration('hubspot', items) and closes on success", async () => {
      const user = userEvent.setup();
      getIntegrationStatus.mockImplementation(async (slug) => {
        if (slug === "hubspot") return { connected: true, connection: {} };
        return { connected: false };
      });
      pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
      const { onClose } = renderModal();
      await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
      await user.click(screen.getByRole("button", { name: /Push 2 records to HubSpot/i }));
      await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("hubspot", sampleItems));
      expect(onClose).toHaveBeenCalled();
    });

    it("HubSpot push surfaces per-row failedRecords in the error list", async () => {
      const user = userEvent.setup();
      getIntegrationStatus.mockImplementation(async (slug) => {
        if (slug === "hubspot") return { connected: true, connection: {} };
        return { connected: false };
      });
      pushToIntegration.mockResolvedValue({
        ok: false,
        pushed: 1,
        total: 2,
        errors: ["HubSpot rejected the token (status 401)"],
        failedRecords: [{ url: "https://a.com", error: "HubSpot rejected the token (status 401)" }],
      });
      renderModal();
      await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
      await user.click(screen.getByRole("button", { name: /Push 2 records to HubSpot/i }));
      // Per-row URL + error format matches Slack's pattern (the dashboard
      // already uses this shape for HubSpot pushes from PushIntegrationMenu).
      await waitFor(() => {
        expect(screen.getByText(/https:\/\/a\.com: HubSpot rejected the token/)).toBeInTheDocument();
      });
    });
  });

  describe("Slack tab", () => {
    it("shows the 'connected' status banner with the account label when Slack is set up", async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole("tab", { name: /Slack/i }));
      // Status banner shows account_label from the stored connection.
      expect(await screen.findByText(/Connected as Test channel/i)).toBeInTheDocument();
      // Send button is enabled.
      expect(screen.getByRole("button", { name: /Post 2 messages to Slack/i })).toBeEnabled();
    });

    it("shows the 'not connected' banner + setup link when Slack has no webhook", async () => {
      const user = userEvent.setup();
      getIntegrationStatus.mockResolvedValue({ connected: false });
      renderModal();
      await user.click(screen.getByRole("tab", { name: /Slack/i }));
      // The "not connected" banner appears.
      expect(await screen.findByText(/Slack isn.t connected yet/i)).toBeInTheDocument();
      // The setup link is rendered as a button (it navigates to /account#integrations).
      expect(screen.getByRole("button", { name: /Set up a webhook in Account/i })).toBeInTheDocument();
      // Send button is disabled.
      expect(screen.getByRole("button", { name: /Post 2 messages to Slack/i })).toBeDisabled();
    });

    it("'Post N messages to Slack' calls pushToIntegration('slack', items) and closes on success", async () => {
      const user = userEvent.setup();
      pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
      const { onClose } = renderModal();
      await user.click(screen.getByRole("tab", { name: /Slack/i }));
      await user.click(screen.getByRole("button", { name: /Post 2 messages to Slack/i }));
      await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("slack", sampleItems));
      expect(onClose).toHaveBeenCalled();
    });

    it("slack 412 (not connected) surfaces a structured error and keeps the modal open", async () => {
      const user = userEvent.setup();
      pushToIntegration.mockResolvedValue({
        ok: false,
        pushed: 0,
        total: 2,
        errors: ["Slack is not connected. Set a webhook URL in Account → Integrations."],
        not_connected: true,
        message: "Slack is not connected. Set a webhook URL in Account → Integrations.",
      });
      const { onClose } = renderModal();
      await user.click(screen.getByRole("tab", { name: /Slack/i }));
      await user.click(screen.getByRole("button", { name: /Post 2 messages to Slack/i }));
      await waitFor(() => {
        expect(screen.getByText(/Slack is not connected. Set a webhook URL/i)).toBeInTheDocument();
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
