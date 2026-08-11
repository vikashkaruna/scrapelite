// src/pages/static-pages.test.jsx
// F-11..F-17 — Static legal + marketing pages render in isolation.
// Each test mounts the page with the full provider tree.
//
//   - F-11: About renders founder block, no "powered by DatIQ" copy bug
//   - F-13: Privacy renders DPDP section + datiq.app URLs
//   - F-14: Terms renders Arbitration Act + Bengaluru
//   - F-15: UseCases hub renders 4 cards + subpage renders
//   - F-16: /vs/browse-ai + /vs/clay H1s render
//   - F-17: Integrations renders 12 cards

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import About from "./About.jsx";
import Privacy from "./Privacy.jsx";
import Terms from "./Terms.jsx";
import UseCases from "./UseCases.jsx";
import UseCaseLead from "./UseCaseLead.jsx";
import VsBrowseAI from "./VsBrowseAI.jsx";
import VsClay from "./VsClay.jsx";
import Integrations from "./Integrations.jsx";
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
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree({ path, children }) {
  return (
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>{children}</ExtractionProvider>
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("F-11 — About page", () => {
  it("renders the founder block (Axiom Minds Private Limited)", async () => {
    // The /about founder block was rebranded from 'Vikash Karuna' to
    // 'Axiom Minds Private Limited' on staging (commit 58d9b47,
    // 2026-07-27). The block now shows the company as the founder.
    const { container } = render(<Tree path="/about"><About /></Tree>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Axiom Minds Private Limited")).toBeInTheDocument();
    const role = container.querySelector(".about-founder-role");
    expect(role).not.toBeNull();
    expect(role.textContent).toMatch(/Founder/);
  });

  it("does NOT contain the 'powered by DatIQ' copy bug (R4)", async () => {
    render(<Tree path="/about"><About /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const text = (await screen.findAllByText(/.+/)).map((el) => el.textContent).join(" ");
    expect(text.toLowerCase()).not.toContain("powered by datiq");
  });
});

describe("F-13 — Privacy page", () => {
  it("renders the DPDP Act 2023 section", async () => {
    render(<Tree path="/privacy"><Privacy /></Tree>);
    await act(async () => { await Promise.resolve(); });
    expect(
      screen.getByRole("heading", { name: /Digital Personal Data Protection/i }),
    ).toBeInTheDocument();
  });

  it("uses datiq.app URLs (no scrapelite.netlify.app — R4 fix)", async () => {
    render(<Tree path="/privacy"><Privacy /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const text = document.body.textContent;
    expect(text).not.toContain("scrapelite.netlify.app");
    expect(text).toContain("datiq.app");
  });
});

describe("F-14 — Terms page", () => {
  it("renders the Arbitration and Conciliation Act 1996 + Bengaluru", async () => {
    render(<Tree path="/terms"><Terms /></Tree>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Arbitration and Conciliation Act, 1996/i)).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru/i)).toBeInTheDocument();
  });
});

describe("F-15 — UseCases hub", () => {
  it("renders 4 use-case cards (lead-gen, competitor, SEO, market)", async () => {
    const { container } = render(<Tree path="/use-cases"><UseCases /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll(".uc-hub-card");
    expect(cards.length).toBe(4);
    // Scope the text assertions to the hub-grid container.
    const grid = container.querySelector(".uc-hub-grid");
    expect(grid).not.toBeNull();
    const gridText = grid.textContent;
    for (const name of [/Lead generation/i, /Competitor research/i, /SEO audit/i, /Market research/i]) {
      expect(gridText).toMatch(name);
    }
  });

  it("/use-cases/lead-generation subpage renders an H1", async () => {
    render(<Tree path="/use-cases/lead-generation"><UseCaseLead /></Tree>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("F-16 — Comparison pages", () => {
  it("/vs/browse-ai H1 mentions both DatIQ and Browse.ai", async () => {
    render(<Tree path="/vs/browse-ai"><VsBrowseAI /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const text = document.body.textContent;
    expect(text).toMatch(/DatIQ/i);
    expect(text).toMatch(/Browse\.ai/i);
  });

  it("/vs/clay H1 mentions both DatIQ and Clay", async () => {
    render(<Tree path="/vs/clay"><VsClay /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const text = document.body.textContent;
    expect(text).toMatch(/DatIQ/i);
    expect(text).toMatch(/Clay/i);
  });
});

describe("F-17 — Integrations page", () => {
  it("renders 13 integration cards (12 original + 1 Airtable added in F18)", async () => {
    const { container } = render(<Tree path="/integrations"><Integrations /></Tree>);
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll(".int-card");
    expect(cards.length).toBe(13);
  });

  it("labels the 5 push providers as 'Available (Beta)' and Salesforce/Webhook with the right status (2026-08-11)", async () => {
    const { container } = render(<Tree path="/integrations"><Integrations /></Tree>);
    await act(async () => { await Promise.resolve(); });

    // Status badges — these are pinned so a future refactor that drops
    // or renames them gets caught here.
    const labels = Array.from(container.querySelectorAll(".int-status"))
      .map((el) => el.textContent.trim());
    // 5 push providers → "Available (Beta)"
    expect(labels.filter((l) => l === "Available (Beta)").length).toBe(5);
    // Webhook / n8n → "Coming Soon"
    expect(labels).toContain("Coming Soon");
    // Salesforce → "Roadmap"
    expect(labels).toContain("Roadmap");
    // Mature features → plain "Available"
    expect(labels.filter((l) => l === "Available").length).toBeGreaterThan(0);
  });
});
