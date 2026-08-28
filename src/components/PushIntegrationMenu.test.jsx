// PushIntegrationMenu.test.jsx — one Push affordance, one destination list.
//
// Before: destinations were reachable two ways with two different lists —
// this menu (HubSpot / Notion / Airtable / Slack, server-side push) and
// Export ▾ → "Send to" → the ExportIntegrations modal (those four PLUS Google
// Sheets). Sheets is a client-side "download a CSV and open a blank sheet"
// flow, not a server push, which is why it had been left out here. The menu
// now carries it, so /batch, /dashboard and /preview all offer the same five.
//
// The button label is also always "Push" — it used to read "Push 3" when more
// than one row was selected, so the same control was named differently on
// different screens. The count lives in the menu header instead.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

const openInGoogleSheets = vi.hoisted(() => vi.fn());
const getPushProviderStatuses = vi.hoisted(() => vi.fn());
const pushToIntegration = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("../lib/utils.js", async () => {
  const actual = await vi.importActual("../lib/utils.js");
  return { ...actual, openInGoogleSheets };
});

vi.mock("../lib/integrationsClient.js", () => ({
  PUSH_PROVIDERS: [
    { slug: "hubspot", name: "HubSpot", icon: "trending-up", desc: "CRM" },
    { slug: "notion", name: "Notion", icon: "bookmark", desc: "Pages" },
    { slug: "airtable", name: "Airtable", icon: "layers", desc: "Records" },
    { slug: "slack", name: "Slack", icon: "message-square", desc: "Summary" },
  ],
  getPushProviderStatuses,
  pushToIntegration,
}));

vi.mock("./Toast.jsx", () => ({ useToast: () => toastSpy }));

const checkCanIntegrations = vi.hoisted(() => vi.fn(() => true));
vi.mock("./BillingProvider.jsx", () => ({
  useBilling: () => ({ checkCanIntegrations }),
  BillingProvider: ({ children }) => children,
}));

const { default: PushIntegrationMenu } = await import("./PushIntegrationMenu.jsx");

const ITEMS = [
  { id: "a", url: "https://a.com", page_title: "A" },
  { id: "b", url: "https://b.com", page_title: "B" },
];

function renderMenu(props = {}) {
  return render(
    <MemoryRouter>
      <PushIntegrationMenu items={ITEMS} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getPushProviderStatuses.mockResolvedValue({});
  checkCanIntegrations.mockReturnValue(true);
});

describe("PushIntegrationMenu — plan gating (Select and up)", () => {
  it("Google Sheets stays reachable even when the plan lacks integrations", async () => {
    checkCanIntegrations.mockReturnValue(false);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    await userEvent.click(screen.getByText("Google Sheets"));
    expect(openInGoogleSheets).toHaveBeenCalled();
  });

  it("a real provider is blocked with an upgrade toast when the plan lacks integrations", async () => {
    checkCanIntegrations.mockReturnValue(false);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    await userEvent.click(screen.getByText("HubSpot"));
    expect(pushToIntegration).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/Select plan/i), expect.anything());
  });

  it("shows a 'Select plan+' badge on real providers when the plan lacks integrations", async () => {
    checkCanIntegrations.mockReturnValue(false);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    expect(screen.getAllByText(/Select plan\+/i).length).toBeGreaterThan(0);
  });
});

describe("PushIntegrationMenu — one list, one label", () => {
  it('labels the button "Push" regardless of how many rows are selected', async () => {
    renderMenu();
    expect(screen.getByRole("button", { name: /^push$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /push 2/i })).toBeNull();
  });

  it("offers all five destinations including Google Sheets", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    for (const name of ["HubSpot", "Notion", "Airtable", "Slack", "Google Sheets"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("shows the selection count in the menu header, not on the button", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    expect(screen.getByText(/push to \(2\)/i)).toBeInTheDocument();
  });

  it("Google Sheets runs the client-side CSV flow — no server push", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    await userEvent.click(screen.getByText("Google Sheets"));
    expect(openInGoogleSheets).toHaveBeenCalledWith(ITEMS);
    expect(pushToIntegration).not.toHaveBeenCalled();
  });

  it("Google Sheets never asks the user to connect anything", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    const row = screen.getByText("Google Sheets").closest("button");
    expect(row.textContent).toMatch(/no setup needed/i);
    expect(row.textContent).not.toMatch(/not connected/i);
  });

  it("an unconnected server provider still prompts to set up", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    const row = screen.getByText("HubSpot").closest("button");
    expect(row.textContent).toMatch(/not connected/i);
  });

  it('shows "More destination options" only when a page provides it', async () => {
    const { unmount } = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    expect(screen.queryByText(/more destination options/i)).toBeNull();
    unmount();

    const onAdvanced = vi.fn();
    renderMenu({ onAdvanced });
    await userEvent.click(screen.getByRole("button", { name: /^push$/i }));
    await userEvent.click(screen.getByText(/more destination options/i));
    expect(onAdvanced).toHaveBeenCalled();
  });

  it("a caller-supplied buttonLabel still wins", () => {
    renderMenu({ buttonLabel: "Send" });
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });
});
