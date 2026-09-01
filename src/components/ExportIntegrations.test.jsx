// src/components/ExportIntegrations.test.jsx — F18 (export modal).
//
// 2026-08-11 rewrite: the modal now uses server-stored connections
// (the user sets up PATs + Base/Table IDs at /account#integrations),
// so the Airtable + Notion API-key forms are gone. The four
// server-stored tabs (HubSpot, Airtable, Notion, Slack) all share
// the same pattern: lazy-load status on tab open, show
// "Connected as [label]" or "Not connected → set up", and provide a
// one-click push. The Google Sheets tab is unchanged (no auth, CSV
// download flow).
//
// These tests pin:
//   - 5 tabs render (Sheets, HubSpot, Airtable, Notion, Slack)
//   - Sheets CTA still works
//   - Each server-stored tab fetches status on open
//   - Connected tab shows "Connected as [label]" + push button
//   - Not-connected tab shows the setup link (no API-key form)
//   - Push calls pushToIntegration(slug, items) and closes on success
//   - Airtable with empty field_map shows the "Load columns" button
//     that calls patchIntegrationConnection("airtable", { refreshSchema: true })
//   - HubSpot/Slack 412 (not_connected) surfaces a structured error

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import ExportIntegrations from "./ExportIntegrations.jsx";

vi.mock("../lib/utils.js", async () => {
  const actual = await vi.importActual("../lib/utils.js");
  return {
    ...actual,
    openInGoogleSheets: vi.fn(),
  };
});

vi.mock("../lib/integrationsClient.js", () => ({
  getIntegrationStatus: vi.fn(),
  pushToIntegration: vi.fn(),
  patchIntegrationConnection: vi.fn(),
  testIntegrationConnection: vi.fn(),
  fetchAirtableTablesClient: vi.fn(() => Promise.resolve({ ok: true, tables: [] })),
  createAirtableTableClient: vi.fn(() => Promise.resolve({ ok: true })),
  PUSH_PROVIDERS: [
    { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "CRM" },
    { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "DB" },
    { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Base" },
    { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Channel" },
  ],
}));

import { openInGoogleSheets } from "../lib/utils.js";
import { getIntegrationStatus, pushToIntegration, patchIntegrationConnection } from "../lib/integrationsClient.js";

const sampleItems = [
  { id: "ext_a", url: "https://a.com", page_title: "A", host: "a.com", ai_summary: "s", created_at: "2026-07-19T00:00:00Z" },
  { id: "ext_b", url: "https://b.com", page_title: "B", host: "b.com", ai_summary: "s", created_at: "2026-07-19T00:00:00Z" },
];

// The status mocks return { connected: boolean, connection: { account_label, ... } }.
// For not-connected tests, the default is already `connected: false`,
// which our component treats as "not connected".
function mockStatusFor(slug, status) {
  getIntegrationStatus.mockImplementation(async (s) => {
    if (s === slug) return status;
    return { connected: false };
  });
}

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
  try { localStorage.clear(); } catch {}
  openInGoogleSheets.mockReset();
  getIntegrationStatus.mockReset();
  pushToIntegration.mockReset();
  patchIntegrationConnection.mockReset();
  // Default: every provider is connected (most tests don't care
  // about the connection state; the specific tests override this
  // to exercise the not-connected path).
  getIntegrationStatus.mockResolvedValue({
    connected: true,
    connection: { account_label: "Test workspace" },
  });
  pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
  patchIntegrationConnection.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExportIntegrations (F18) — tab structure", () => {
  it("renders the modal title and all five destination tabs", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Send to a destination/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Google Sheets/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /HubSpot/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Airtable/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Notion/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Slack/i })).toBeInTheDocument();
  });

  it("subheader names all five destinations (not just the original four)", () => {
    renderModal();
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
    expect(screen.getAllByText(/File . Import . Upload/i).length).toBeGreaterThanOrEqual(1);
  });

  it("clicking the Sheets CTA downloads CSV + opens Google Sheets in a new tab", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: /Open Google Sheets/i }));
    expect(openInGoogleSheets).toHaveBeenCalledWith(sampleItems);
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc closes the modal", () => {
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
});

describe("ExportIntegrations (F18) — one-click Airtable (2026-08-11)", () => {
  it("switching to Airtable fetches /status on tab open (no API-key form)", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await waitFor(() => {
      expect(getIntegrationStatus).toHaveBeenCalledWith("airtable");
    });
    // The API key / Base ID / Table ID inputs are GONE — credentials
    // live on the server now.
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base ID/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Table ID/i)).not.toBeInTheDocument();
  });

  it("connected Airtable shows 'Connected as [label]' + the field_map summary + one-click push", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: {
        account_label: "ACME Airtable",
        base_id: "appABCDEFGHIJK",
        table_id: "tblABCDEFGHIJK",
        table_meta: { tableName: "Leads" },
        field_map: { URL: { key: "url" }, Title: { key: "page_title" } },
        field_map_summary: "URL→url, Title→page_title",
      },
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    // "Connected as" appears twice (help paragraph + status banner);
    // the banner is the primary signal, so use findAllByText.
    expect(await screen.findAllByText(/Connected as ACME Airtable/i)).toHaveLength(2);
    // The field_map summary is rendered as the "Field map:" line.
    expect(screen.getByText(/URL→url, Title→page_title/)).toBeInTheDocument();
    // The push CTA is enabled (we have rows + a connection).
    expect(screen.getByRole("button", { name: /Push 2 records to Airtable/i })).toBeEnabled();
  });

  it("Airtable with empty field_map shows the 'Load columns' warning + button", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: {
        account_label: "Legacy",
        base_id: "appOLD",
        table_id: "tblOLD",
        // No field_map — the user connected before refreshSchema shipped.
        field_map: null,
        field_map_summary: null,
      },
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    expect(await screen.findByText(/No field map loaded yet/i)).toBeInTheDocument();
    // The "Load columns" button is in the warning.
    expect(screen.getByRole("button", { name: /Load columns/i })).toBeInTheDocument();
  });

  it("clicking 'Load columns' calls patchIntegrationConnection with refreshSchema:true", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: { account_label: "Legacy", field_map: null, field_map_summary: null },
    });
    patchIntegrationConnection.mockResolvedValue({
      ok: true,
      tableName: "Leads",
      fieldCount: 5,
      matched: 4,
      fieldMap: { URL: { key: "url" }, Title: { key: "page_title" }, Notes: { key: "ai_summary" } },
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    const loadBtn = await screen.findByRole("button", { name: /Load columns/i });
    await user.click(loadBtn);
    await waitFor(() => {
      expect(patchIntegrationConnection).toHaveBeenCalledWith(
        "airtable",
        expect.objectContaining({ refreshSchema: true }),
      );
    });
  });

  it("'Load columns' failure shows the error in the error list", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: { account_label: "Legacy", field_map: null, field_map_summary: null },
    });
    patchIntegrationConnection.mockResolvedValue({
      ok: false,
      error: "Airtable 403: missing schema.bases:read scope",
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.click(await screen.findByRole("button", { name: /Load columns/i }));
    await waitFor(() => {
      expect(screen.getByText(/schema\.bases:read/)).toBeInTheDocument();
    });
  });

  it("'Push N records to Airtable' calls pushToIntegration('airtable', items) and closes on success", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: {
        account_label: "ACME",
        field_map: { URL: { key: "url" } },
        field_map_summary: "URL→url",
      },
    });
    pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.click(screen.getByRole("button", { name: /Push 2 records to Airtable/i }));
    await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("airtable", sampleItems));
    expect(onClose).toHaveBeenCalled();
  });

  it("Airtable push failure surfaces per-row failedRecords", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", {
      connected: true,
      connection: { account_label: "ACME", field_map: { URL: { key: "url" } } },
    });
    pushToIntegration.mockResolvedValue({
      ok: false,
      pushed: 0,
      total: 2,
      errors: ["Airtable 422: Unknown field name: URL"],
      failedRecords: [{ url: "https://a.com", error: "Airtable 422: Unknown field name: URL" }],
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.click(screen.getByRole("button", { name: /Push 2 records to Airtable/i }));
    await waitFor(() => {
      expect(screen.getByText(/https:\/\/a\.com: Airtable 422/)).toBeInTheDocument();
    });
  });

  it("Airtable 412 (not_connected) on push surfaces a setup link and keeps the modal open", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", { connected: true, connection: { account_label: "ACME" } });
    pushToIntegration.mockResolvedValue({
      ok: false,
      pushed: 0,
      total: 2,
      errors: ["Airtable is not connected."],
      not_connected: true,
      message: "Airtable is not connected.",
    });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    await user.click(screen.getByRole("button", { name: /Push 2 records to Airtable/i }));
    await waitFor(() => {
      expect(screen.getByText(/Airtable is not connected\./)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("not-connected Airtable shows the setup link (no API-key form)", async () => {
    const user = userEvent.setup();
    mockStatusFor("airtable", { connected: false });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Airtable/i }));
    expect(await screen.findByText(/Airtable isn.t connected yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up Airtable in Account/i })).toBeInTheDocument();
    // Push button is disabled.
    expect(screen.getByRole("button", { name: /Push 2 records to Airtable/i })).toBeDisabled();
  });
});

describe("ExportIntegrations (F18) — one-click Notion (2026-08-11)", () => {
  it("switching to Notion fetches /status on tab open (no API-key form)", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    await waitFor(() => {
      expect(getIntegrationStatus).toHaveBeenCalledWith("notion");
    });
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Database ID/i)).not.toBeInTheDocument();
  });

  it("connected Notion shows 'Connected as [label]' + database_id + title column + column count + push", async () => {
    const user = userEvent.setup();
    mockStatusFor("notion", {
      connected: true,
      connection: {
        account_label: "Workspace",
        database_id: "abcdef0123456789abcdef0123456789",
        title_column: "Name",
        column_count: 7,
      },
    });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    // "Connected as" appears twice (help paragraph + status banner).
    expect(await screen.findAllByText(/Connected as Workspace/i)).toHaveLength(2);
    // The detail block shows the database ID, title column, and column count.
    // The database ID is rendered truncated to `abcdef01…6789` for
    // display (slice(0,8) + ellipsis + slice(-4)). We assert on the
    // leading 8 chars; the ellipsis character is the same U+2026 the
    // component renders, so the exact substring "abcdef01…6789" must match.
    const dbVal = document.querySelector(".export-int-detail code");
    expect(dbVal).toBeInTheDocument();
    expect(dbVal.textContent).toMatch(/abcdef01…6789/);
    expect(screen.getByText(/^Name$/)).toBeInTheDocument();
    expect(screen.getByText(/^7$/)).toBeInTheDocument();
    // Push CTA is enabled.
    expect(screen.getByRole("button", { name: /Push 2 pages to Notion/i })).toBeEnabled();
  });

  it("'Push N pages to Notion' calls pushToIntegration('notion', items) and closes on success", async () => {
    const user = userEvent.setup();
    mockStatusFor("notion", {
      connected: true,
      connection: { account_label: "Workspace", title_column: "Name", column_count: 7 },
    });
    pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    await user.click(screen.getByRole("button", { name: /Push 2 pages to Notion/i }));
    await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("notion", sampleItems));
    expect(onClose).toHaveBeenCalled();
  });

  it("not-connected Notion shows the setup link (no API-key form)", async () => {
    const user = userEvent.setup();
    mockStatusFor("notion", { connected: false });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Notion/i }));
    expect(await screen.findByText(/Notion isn.t connected yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up Notion in Account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Push 2 pages to Notion/i })).toBeDisabled();
  });
});

describe("ExportIntegrations (F18) — one-click HubSpot", () => {
  it("connected HubSpot shows 'Connected as [label]' + one-click push", async () => {
    const user = userEvent.setup();
    mockStatusFor("hubspot", { connected: true, connection: { account_label: "ACME CRM" } });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
    expect(await screen.findAllByText(/Connected as ACME CRM/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Push 2 records to HubSpot/i })).toBeEnabled();
  });

  it("not-connected HubSpot shows the setup link and disables the push", async () => {
    const user = userEvent.setup();
    mockStatusFor("hubspot", { connected: false });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
    expect(await screen.findByText(/HubSpot isn.t connected yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paste a Private App token in Account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Push 2 records to HubSpot/i })).toBeDisabled();
  });

  it("'Push N records to HubSpot' calls pushToIntegration('hubspot', items) and closes on success", async () => {
    const user = userEvent.setup();
    mockStatusFor("hubspot", { connected: true, connection: {} });
    pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /HubSpot/i }));
    await user.click(screen.getByRole("button", { name: /Push 2 records to HubSpot/i }));
    await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("hubspot", sampleItems));
    expect(onClose).toHaveBeenCalled();
  });

  it("HubSpot push surfaces per-row failedRecords in the error list", async () => {
    const user = userEvent.setup();
    mockStatusFor("hubspot", { connected: true, connection: {} });
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
    await waitFor(() => {
      expect(screen.getByText(/https:\/\/a\.com: HubSpot rejected the token/)).toBeInTheDocument();
    });
  });
});

describe("ExportIntegrations (F18) — one-click Slack", () => {
  it("connected Slack shows 'Connected as [label]' + one-click send", async () => {
    const user = userEvent.setup();
    mockStatusFor("slack", { connected: true, connection: { account_label: "Test channel" } });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Slack/i }));
    expect(await screen.findAllByText(/Connected as Test channel/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Post 2 messages to Slack/i })).toBeEnabled();
  });

  it("not-connected Slack shows the setup link and disables the send", async () => {
    const user = userEvent.setup();
    mockStatusFor("slack", { connected: false });
    renderModal();
    await user.click(screen.getByRole("tab", { name: /Slack/i }));
    expect(await screen.findByText(/Slack isn.t connected yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up a webhook in Account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Post 2 messages to Slack/i })).toBeDisabled();
  });

  it("'Post N messages to Slack' calls pushToIntegration('slack', items) and closes on success", async () => {
    const user = userEvent.setup();
    mockStatusFor("slack", { connected: true, connection: {} });
    pushToIntegration.mockResolvedValue({ ok: true, pushed: 2, total: 2, errors: [], failedRecords: [] });
    const { onClose } = renderModal();
    await user.click(screen.getByRole("tab", { name: /Slack/i }));
    await user.click(screen.getByRole("button", { name: /Post 2 messages to Slack/i }));
    await waitFor(() => expect(pushToIntegration).toHaveBeenCalledWith("slack", sampleItems));
    expect(onClose).toHaveBeenCalled();
  });

  it("Slack 412 (not_connected) on send surfaces a structured error and keeps the modal open", async () => {
    const user = userEvent.setup();
    mockStatusFor("slack", { connected: true, connection: {} });
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
      expect(screen.getByText(/Slack is not connected\. Set a webhook URL/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
