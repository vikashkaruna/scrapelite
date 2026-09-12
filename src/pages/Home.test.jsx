// src/pages/Home.test.jsx
// F-01 / F-02 — Home page composer + intent chips + feature cards.
//
//   - F-01: Empty input → submit disabled; valid URL → extract → /preview
//   - F-02: Multi-URL → navigate to /batch; custom intent routes customPrompt
//           to extract (covered by HeroComposer.integration.test.jsx)
//
// These tests focus on the page-level structure. The wiring of the
// composer is covered by HeroComposer.integration.test.jsx.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import Home from "./Home.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider } from "../components/PersonaProvider.jsx";
import { BillingProvider } from "../components/BillingProvider.jsx";
import { ExtractionProvider } from "../components/ExtractionProvider.jsx";
import { GuestTrialProvider } from "../components/GuestTrialProvider.jsx";

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

const firecrawlMocks = vi.hoisted(() => ({
  extractStructure: vi.fn(),
}));

const aiMocks = vi.hoisted(() => ({
  summarize: vi.fn(),
  categorizeLinks: vi.fn(),
}));

vi.mock("../lib/firecrawlService.js", () => ({
  extractStructure: firecrawlMocks.extractStructure,
  mapDomain: vi.fn(),
}));

vi.mock("../lib/aiService.js", () => ({
  summarize: aiMocks.summarize,
  categorizeLinks: aiMocks.categorizeLinks,
  generateContent: vi.fn(),
}));

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  firecrawlMocks.extractStructure.mockImplementation(async (url) => ({
    url, html: "<html></html>", metadata: { title: "X" }, headings: [], links: [], domain_map: null,
  }));
  aiMocks.summarize.mockResolvedValue("Mock summary");
  aiMocks.categorizeLinks.mockResolvedValue([]);
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/preview" element={<div data-testid="preview-page">preview</div>} />
                      <Route path="/batch" element={<div data-testid="batch-page">batch</div>} />
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

describe("F-01 — Home composer", () => {
  it("renders the H1 + the URL textarea", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    const ta = document.querySelector("textarea");
    expect(ta).not.toBeNull();
  });

  it("renders 5 intent chips (summary / contacts / pricing / map / custom)", async () => {
    const { container } = render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Intent chips are inside the composer bar; check via the chip text.
    const text = container.textContent;
    for (const label of [/AI summary/i, /Find contacts/i, /Scrape pricing/i, /Map site/i, /Custom/i]) {
      expect(text).toMatch(label);
    }
  });

  it("renders 8 feature cards (clickable)", async () => {
    const { container } = render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll(".feature-cell");
    expect(cards.length).toBe(8);
  });

  it("renders the connected-intelligence hero and the truthful six-module catalog", async () => {
    const { container } = render(<Tree />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("heading", { level: 1, name: /Intelligence, Connected/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paste a URL and see it work/i })).toBeInTheDocument();
    expect(screen.queryByText(/No code · structured in seconds/i)).not.toBeInTheDocument();

    const modules = container.querySelectorAll(".home-module-card");
    expect(modules).toHaveLength(6);
    expect([...modules].map((module) => module.querySelector("h3")?.textContent)).toEqual([
      "DatIQ Extract", "DatIQ Enrich", "DatIQ Discover", "DatIQ Compete", "DatIQ Connect", "DatIQ Engage",
    ]);
    expect(screen.getByText("DatIQ Discover")).toBeInTheDocument();

    const upcoming = container.querySelector('[data-module-status="upcoming"]');
    expect(upcoming).toHaveTextContent("DatIQ Engage");
    expect(upcoming.querySelector("button")).toBeNull();
    expect(upcoming).toHaveTextContent("Upcoming");

    const discover = [...container.querySelectorAll('[data-module-status="beta"]')]
      .find((module) => module.textContent?.includes("DatIQ Discover"));
    expect(discover).toBeTruthy();
    expect(discover).toHaveTextContent("Run a visibility audit");
  });
});
