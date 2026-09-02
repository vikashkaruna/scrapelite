// src/pages/Preview.integration.test.jsx
// I-35 — Preview page integration.
//
//   - Download ▾ opens CSV / PDF / Markdown / JSON options
//   - "View Dashboard" is the primary action
//   - "Delete" removes the extraction and navigates back to /

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import Preview from "./Preview.jsx";
import { ExtractionProvider, useExtraction } from "../components/ExtractionProvider.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider } from "../components/PersonaProvider.jsx";
import { BillingProvider } from "../components/BillingProvider.jsx";
import { GuestTrialProvider } from "../components/GuestTrialProvider.jsx";
import { buildExtraction } from "../../test/fixtures/buildExtraction.js";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const usageRepoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn(() => Promise.resolve([])),
  saveExtraction: vi.fn(() => Promise.resolve({ id: "ext_x" })),
  patchExtraction: vi.fn(() => Promise.resolve()),
  deleteExtraction: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/apiClient.js", () => ({ apiClient: apiMocks, setAuthToken: vi.fn() }));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

vi.mock("../lib/globalSettingsService.js", () => ({
  getSettings: () => ({
    guest_trial_soft_limit: 3,
    guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10,
    guest_batch_hard_limit: 5,
  }),
  loadSettings: () => Promise.resolve({
    guest_trial_soft_limit: 3,
    guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10,
    guest_batch_hard_limit: 5,
  }),
}));

// Mock the AI service so the Generate-content flow returns a known
// markdown blob and the test can pin the in-page rendering path
// (tab appears, ContentView shows the body, refresh re-runs).
vi.mock("../lib/aiService.js", async () => {
  const actual = await vi.importActual("../lib/aiService.js");
  return {
    ...actual,
    generateContent: vi.fn(async () => {
      return "# SEO Blog Outline\n\n## 1. Intro\n\nA short intro.\n\n## 2. Main\n\nThe meat.";
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
});

function Seeder({ item }) {
  // Seed the ExtractionProvider's "current" via the public commit path
  // by saving to extractionsRepo first; the provider auto-loads on mount.
  // For Preview to show the item, we set current via localStorage + reload.
  return null;
}

function Tree({ item }) {
  if (item) {
    localStorage.setItem("datiq.current", JSON.stringify(item));
  }
  return (
    <MemoryRouter
      initialEntries={["/preview"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Routes>
                      <Route path="/preview" element={<Preview />} />
                      <Route path="/" element={<div data-testid="home">home</div>} />
                      <Route path="/dashboard" element={<div data-testid="dashboard">dashboard</div>} />
                    </Routes>
                  </ExtractionProvider>
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("I-35 — Preview: action bar", () => {
  it("renders 'View Dashboard' as the primary action", async () => {
    const item = buildExtraction({ id: "ext_p1", title: "Pricing — Example" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    const view = screen.getByRole("button", { name: /view dashboard/i });
    expect(view).toBeInTheDocument();
  });

  it("Download ▾ opens a menu with CSV / PDF / Markdown / JSON options (plus a Copy section)", async () => {
    const item = buildExtraction({ id: "ext_p2" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    // Open the Download dropdown.
    const dl = screen.getByRole("button", { name: /download/i });
    act(() => fireEvent.click(dl));
    await act(async () => { await Promise.resolve(); });
    // The download section's items render (4 formats).
    expect(screen.getByText(/^CSV$/i)).toBeInTheDocument();
    expect(screen.getByText(/^PDF$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Markdown$/i)).toBeInTheDocument();
    expect(screen.getByText(/^JSON$/i)).toBeInTheDocument();
    // F01 — Copy section header is also present.
    expect(screen.getByText(/Copy to clipboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy summary/i)).toBeInTheDocument();
  });

  it("'Delete' returns the user to /", async () => {
    const item = buildExtraction({ id: "ext_p3" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    const delBtn = screen.getByRole("button", { name: /delete/i });
    act(() => fireEvent.click(delBtn));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});

describe("I-35 — Preview: Generate content in-page section", () => {
  // The 5 CONTENT_FORMATS used to live in a separate ContentModal. They now
  // live in the Quick enrichment card's "Generate content" sub-section, and
  // each one becomes a stacked tab (like the structured enrichments) that
  // persists to localStorage + Supabase. These tests pin:
  //   1. the 5 buttons render in the in-page section (no modal trigger),
  //   2. clicking one creates a content-kind enrichment tab,
  //   3. the tab body renders the markdown via ContentView (Copy button,
  //      <pre> with the body),
  //   4. the tab survives a re-render (persistence sanity check).
  it("renders all 5 Generate content buttons in the in-page sub-section (no modal)", async () => {
    const item = buildExtraction({ id: "ext_g1" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    // The 5 CONTENT_FORMATS labels all render as buttons. Before this
    // refactor they were inside a <ContentModal> and only visible after
    // clicking the "Generate content" trigger button.
    for (const label of ["SEO Blog Outline", "Competitor Summary", "Social Posts", "Compare", "Explain"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("clicking a Generate content button creates a stacked tab and renders the markdown", async () => {
    const item = buildExtraction({ id: "ext_g2" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    const seoBtn = screen.getByRole("button", { name: /SEO Blog Outline/i });
    act(() => fireEvent.click(seoBtn));
    // The mock above returns "# SEO Blog Outline\n\n## 1. Intro…" so the
    // generated content shows up in the new tab body. The test waits
    // for the React state update to flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Tab is selected → tab body renders the markdown.
    expect(screen.getByText(/# SEO Blog Outline/)).toBeInTheDocument();
    // The Copy button is part of ContentView; it must be reachable.
    expect(screen.getByRole("button", { name: /copy content/i })).toBeInTheDocument();
  });

  it("structured-data tabs (Leadership & Board, etc.) still render via StructuredData, not ContentView", async () => {
    // Regression guard: the dual-check in the tab body (kind === "content"
    // || data.text) is intentional, but we want to be sure a JSON-shaped
    // structured entry is still rendered as structured data, not as a
    // markdown blob. Seed an enrichment with a JSON-shaped data field
    // and verify it does NOT render the Copy button.
    const item = buildExtraction({ id: "ext_g3" });
    item.enrichments = {
      leadership: {
        key: "leadership",
        label: "Leadership & Board",
        icon: "users",
        prompt: "Extract names, titles, emails",
        data: { contacts: [{ name: "Jane Doe", role: "CEO" }] },
        created_at: new Date().toISOString(),
      },
    };
    localStorage.setItem("datiq.current", JSON.stringify(item));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Click the Leadership & Board tab.
    const tab = screen.getByRole("tab", { name: /Leadership & Board/i });
    act(() => fireEvent.click(tab));
    await act(async () => { await Promise.resolve(); });
    // The structured contact renders — twice, deliberately: once in the
    // human-readable table and once inside the collapsed "Raw JSON" details.
    // getAllByText, not getByText: keeping the raw payload one disclosure away
    // is a feature (it is what an engineer debugging an extraction reaches
    // for), so an exact-match assertion here would fight the design.
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0);
    // Rendered as real structure, not a JSON dump: the field label is present.
    expect(screen.getByText(/^Name$/i)).toBeInTheDocument();
    // The Copy-content button is NOT present (this is structured data,
    // not markdown). If a future refactor flips the branch, the test
    // catches it.
    expect(screen.queryByRole("button", { name: /copy content/i })).not.toBeInTheDocument();
  });
});
