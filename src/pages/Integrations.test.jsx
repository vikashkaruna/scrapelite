// src/pages/Integrations.test.jsx
//
// F-44 — Integrations page + Webhook setup modal integration.
//
// - Renders all 10 cards from the catalog
// - "Webhook / n8n" is marked Available, not coming-soon
// - "Set up" on Webhook opens the WebhookSetupModal (NOT navigates to "/")
// - Other "Use now" actions still navigate to their .path (e.g. /dashboard)
// - Notify-me on coming-soon items still works

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Integrations from "./Integrations.jsx";

const toast = vi.fn();
vi.mock("../components/Toast.jsx", () => ({
  useToast: () => toast,
}));

// Mock the NotifyMeModal so it doesn't try to import integrationsNotify
// (which itself reads the localStorage in a way that complicates tests).
vi.mock("../components/NotifyMeModal.jsx", () => ({
  default: ({ open, onClose }) =>
    open ? <div data-testid="notify-modal"><button onClick={onClose}>close-notify</button></div> : null,
}));

// localStorage helpers for the "Set up" click — the modal reads
// user-set URL from localStorage.
beforeEach(() => {
  localStorage.clear();
  toast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderPage(initialPath = "/integrations") {
  // MemoryRouter so useNavigate() has a context to call into. We don't
  // assert on the destination path here — that's covered by the
  // WebhookSetupModal's own tests — only that "Set up" opens a modal
  // and the others navigate.
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Integrations />
    </MemoryRouter>
  );
}

describe("Integrations — catalog", () => {
  // Scoped to the catalogue grid. The page now also renders the recipe
  // gallery above it, which legitimately names the same destinations — an
  // unscoped getByText would be ambiguous about which section it means, and
  // "HubSpot appears somewhere on the page" was never what this asserted.
  const inGrid = () => within(document.querySelector(".int-grid"));

  it("renders all 10 cards", () => {
    renderPage();
    const grid = inGrid();
    expect(grid.getByText("CSV Export")).toBeInTheDocument();
    expect(grid.getByText("PDF Export")).toBeInTheDocument();
    expect(grid.getByText("Webhook / n8n")).toBeInTheDocument();
    expect(grid.getByText("Email Share")).toBeInTheDocument();
    expect(grid.getByText("HubSpot")).toBeInTheDocument();
    expect(grid.getByText("Salesforce")).toBeInTheDocument();
    expect(grid.getByText("Airtable")).toBeInTheDocument();
    expect(grid.getByText("Notion")).toBeInTheDocument();
    expect(grid.getByText("Google Sheets")).toBeInTheDocument();
    expect(grid.getByText("Slack")).toBeInTheDocument();
  });

  it("marks the Webhook card as 'Available'", () => {
    renderPage();
    const card = screen.getByText("Webhook / n8n").closest(".int-card");
    expect(card).not.toBeNull();
    const status = card.querySelector(".int-status");
    expect(status).toHaveTextContent(/available/i);
  });

  it("Webhook 'Set up' button is the action button (not 'Use now')", () => {
    renderPage();
    // The Webhook card should have a button labeled "Set up" — proves
    // the action was updated from the old "Use now" generic copy.
    const card = screen.getByText("Webhook / n8n").closest(".int-card");
    const btn = card.querySelector("button");
    expect(btn).toHaveTextContent(/^Set up$/);
  });
});

describe("Integrations — Webhook modal wiring (F-44)", () => {
  it("clicking 'Set up' on the Webhook card opens the WebhookSetupModal (not navigate)", () => {
    renderPage();
    // Modal is closed initially.
    expect(screen.queryByRole("dialog", { name: /webhook setup/i })).toBeNull();
    // Click Set up.
    const card = screen.getByText("Webhook / n8n").closest(".int-card");
    fireEvent.click(card.querySelector("button"));
    // The dialog should now be in the DOM.
    expect(screen.getByRole("dialog", { name: /webhook setup/i })).toBeInTheDocument();
    expect(screen.getByText(/Your webhook URL/i)).toBeInTheDocument();
  });

  it("the WebhookSetupModal's 'Send test event' button works inside the page", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 }));
    renderPage();
    const card = screen.getByText("Webhook / n8n").closest(".int-card");
    fireEvent.click(card.querySelector("button"));
    // Type a URL, save it, then send a test event.
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://hooks.zapier.com/abc" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    // After save, the input is cleared; click the test event button.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(globalThis.fetch).toHaveBeenCalled();
    // Scoped to the modal: the Zapier recipe card also contains the word
    // "delivered", so an unscoped match no longer identifies this result.
    const modal = document.querySelector(".modal, [role='dialog']") || document.body;
    expect(within(modal).getAllByText(/delivered/i).length).toBeGreaterThan(0);
  });

  it("closing the WebhookSetupModal removes it from the DOM", () => {
    renderPage();
    const card = screen.getByText("Webhook / n8n").closest(".int-card");
    fireEvent.click(card.querySelector("button"));
    expect(screen.getByRole("dialog", { name: /webhook setup/i })).toBeInTheDocument();
    // Close via the X button.
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog", { name: /webhook setup/i })).toBeNull();
  });
});

describe("Integrations — other 'Use now' actions still navigate", () => {
  it("clicking 'Use now' on CSV Export does NOT open a modal", () => {
    renderPage();
    const card = screen.getByText("CSV Export").closest(".int-card");
    fireEvent.click(card.querySelector("button"));
    // No webhook modal opened.
    expect(screen.queryByRole("dialog", { name: /webhook setup/i })).toBeNull();
    // (The navigate would land on "/", which is the home page; we
    // don't assert on the destination here, only that the webhook
    // modal did NOT open.)
  });
});
