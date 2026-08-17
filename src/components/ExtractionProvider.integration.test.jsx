// src/components/ExtractionProvider.integration.test.jsx
// I-11 — ExtractionProvider pre-flight check integration.
//
//   - When guest is at the single-URL hard limit, extract() is a no-op:
//     checkCanExtractSingle().allowed === false → setShowHardBlock(true)
//     fires, extractStructure is NOT called, no /preview navigation.
//   - When the user is logged in, the pre-flight check is bypassed (logged-in
//     users don't consume trial credits).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ExtractionProvider, useExtraction } from "./ExtractionProvider.jsx";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { GuestTrialProvider, useGuestTrial } from "./GuestTrialProvider.jsx";

const firecrawlMocks = vi.hoisted(() => ({
  extractStructure: vi.fn(),
}));

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

vi.mock("../lib/firecrawlService.js", () => ({
  extractStructure: firecrawlMocks.extractStructure,
  mapDomain: vi.fn(),
}));

// aiService.summarize()'s no-key fallback (mockSummary) has a real 1.2s
// setTimeout delay — mock it out so tests resolve on microtasks, not
// wall-clock time.
vi.mock("../lib/aiService.js", () => ({
  summarize: vi.fn(async () => "Mock summary"),
  categorizeLinks: vi.fn(async (links) => links || []),
  generateContent: vi.fn(async () => ""),
  CONTENT_FORMATS: [],
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

const TRIAL_KEY = "datiq.guestTrial";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  firecrawlMocks.extractStructure.mockResolvedValue({
    url: "https://x.example.com",
    html: "<html></html>",
    metadata: { title: "X" },
    headings: [],
    links: [],
    domain_map: null,
  });
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Probe />
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

function Probe() {
  const { extract, enrich, loading, current } = useExtraction();
  const { showHardBlock, hardBlockReason, checkCanExtractSingle } = useGuestTrial();
  const { pathname } = useLocation();
  const [entry, setEntry] = useState(null);
  const extractEntry = current?.enrichments?.pricing;
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="showHardBlock">{String(showHardBlock)}</span>
      <span data-testid="hardBlockReason">{hardBlockReason}</span>
      <span data-testid="canSingle">{String(checkCanExtractSingle().allowed)}</span>
      <span data-testid="pathname">{pathname}</span>
      <span data-testid="entryReason">{entry?.reason ?? "(none)"}</span>
      <span data-testid="extractEntryReason">{extractEntry?.reason ?? "(none)"}</span>
      <span data-testid="extractEntryPresent">{String(Boolean(extractEntry))}</span>
      <button data-testid="extract" onClick={() => extract("https://x.example.com")}>
        extract
      </button>
      <button
        data-testid="extractWithEnrich"
        onClick={() =>
          extract("https://x.example.com", {
            customPrompt: "Extract every pricing tier.",
            enrichMeta: { key: "pricing", label: "Pricing & Plans", icon: "hash" },
          })
        }
      >
        extractWithEnrich
      </button>
      <button
        data-testid="enrich"
        onClick={async () =>
          setEntry(
            await enrich("https://x.example.com", {
              key: "pricing",
              label: "Pricing & Plans",
              icon: "hash",
              prompt: "Extract every pricing tier.",
            }),
          )
        }
      >
        enrich
      </button>
    </div>
  );
}

describe("I-11 — ExtractionProvider: pre-flight guest hard block", () => {
  it("guest at the single-URL hard limit → extract() is a no-op (no extractStructure call, no /preview navigation)", async () => {
    // Pre-seed the count at the hard limit.
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 10, batchCount: 0, sid: "s1" }));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });

    // Pre-flight reports not allowed.
    expect(screen.getByTestId("canSingle").textContent).toBe("false");
    // No interstitial before the user has done anything — the dialog is
    // raised by the attempt below, not by mounting over the limit.
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");

    // Click extract — should be a no-op.
    await act(async () => {
      screen.getByTestId("extract").click();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).not.toHaveBeenCalled();
    expect(screen.getByTestId("pathname").textContent).toBe("/");
    // ...and the attempt is what raises the dialog.
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("single");
  });

  it("guest below the hard limit → extract() proceeds", async () => {
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 0, batchCount: 0, sid: "s1" }));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("canSingle").textContent).toBe("true");
    await act(async () => {
      screen.getByTestId("extract").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).toHaveBeenCalled();
  });
});

// 2026-08-13. /api/extract now says WHY a customPrompt came back empty.
// enrich() has to carry that onto the saved entry, otherwise Preview is back
// to rendering one indistinguishable "No data returned" for every cause —
// which is what made "none of the Quick enrichment buttons work" so hard to
// pin down across several rounds of fixes.
describe("ExtractionProvider.enrich — carries the empty-extraction reason", () => {
  beforeEach(() => {
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 0, batchCount: 0, sid: "s1" }));
  });

  it("puts custom_extraction_reason onto the enrichment entry", async () => {
    firecrawlMocks.extractStructure.mockResolvedValueOnce({
      url: "https://x.example.com",
      page_title: "X",
      headings: [],
      links: [],
      custom_extraction: null,
      custom_extraction_reason: "ai_not_configured",
    });
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      screen.getByTestId("enrich").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("entryReason").textContent).toBe("ai_not_configured");
  });

  it("omits reason entirely when the extraction succeeded", async () => {
    firecrawlMocks.extractStructure.mockResolvedValueOnce({
      url: "https://x.example.com",
      page_title: "X",
      headings: [],
      links: [],
      custom_extraction: { plans: ["free", "pro"] },
    });
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      screen.getByTestId("enrich").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("entryReason").textContent).toBe("(none)");
  });
});

// Same bug, different call site: extract() (the Home path — and, by the same
// code shape, Batch's save path) used to gate the enrichment tab on
// `result.custom_extraction != null`, so an empty result created NO tab and NO
// reason at all — unlike enrich() above. A user who picked "Find contacts" on
// Home just saw nothing, indistinguishable from broken. extract() must now
// match enrich()'s behavior: always create the tab, carry `reason` when empty.
describe("ExtractionProvider.extract — carries the empty-extraction reason (Home/Batch parity with enrich)", () => {
  beforeEach(() => {
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 0, batchCount: 0, sid: "s1" }));
  });

  it("creates the enrichment tab with a reason even when custom_extraction is null", async () => {
    firecrawlMocks.extractStructure.mockResolvedValueOnce({
      url: "https://x.example.com",
      page_title: "X",
      headings: [],
      links: [],
      custom_extraction: null,
      custom_extraction_reason: "ai_not_configured",
    });
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      screen.getByTestId("extractWithEnrich").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("extractEntryPresent").textContent).toBe("true");
    expect(screen.getByTestId("extractEntryReason").textContent).toBe("ai_not_configured");
  });

  it("still creates the tab (with no reason) when the extraction returns real data", async () => {
    firecrawlMocks.extractStructure.mockResolvedValueOnce({
      url: "https://x.example.com",
      page_title: "X",
      headings: [],
      links: [],
      custom_extraction: { plans: ["free", "pro"] },
    });
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      screen.getByTestId("extractWithEnrich").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("extractEntryPresent").textContent).toBe("true");
    expect(screen.getByTestId("extractEntryReason").textContent).toBe("(none)");
  });
});
