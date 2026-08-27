// src/components/ExtractionProvider.autosave-race.integration.test.jsx
//
// 2026-08-28. "Quick enrichment says success but nothing is displayed."
//
// extract() fires saveExtraction() as fire-and-forget and, when it resolved,
// committed `{ ...result, _saved: true }` — the snapshot captured BEFORE the
// user reached /preview. The auto-save is a real network round trip (owner
// lookup + POST /api/extractions + Supabase insert), so it is routinely still
// in flight while the user is already clicking a Quick enrichment button. The
// enrichment committed its tab, the toast said "ready", and then the stale
// snapshot landed and replaced `current` — deleting the tab a second later.
//
// Both directions are pinned here: a late auto-save must not drop an
// enrichment, and a late enrichment must not drop the `_saved` flag (losing
// it silently stops every later tab syncing to Supabase).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ExtractionProvider, useExtraction } from "./ExtractionProvider.jsx";
import { AuthProvider } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const URL_UNDER_TEST = "https://race.example.com";

const firecrawlMocks = vi.hoisted(() => ({ extractStructure: vi.fn() }));
const repoMocks = vi.hoisted(() => ({
  saveExtraction: vi.fn(),
  updateEnrichments: vi.fn(() => Promise.resolve()),
  listExtractions: vi.fn(() => Promise.resolve([])),
  deleteExtraction: vi.fn(() => Promise.resolve()),
  claimLocalExtractions: vi.fn(() => Promise.resolve()),
}));
const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
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
vi.mock("../lib/extractionsRepo.js", () => repoMocks);
vi.mock("../lib/aiService.js", () => ({
  summarize: vi.fn(async () => "Mock summary"),
  categorizeLinks: vi.fn(async (links) => links || []),
  generateContent: vi.fn(async () => ""),
  CONTENT_FORMATS: [],
}));
vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));
vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return { ...actual, getSession: authMocks.getSession, onAuthStateChange: authMocks.onAuthStateChange };
});
vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);
vi.mock("../lib/globalSettingsService.js", () => ({
  getSettings: () => ({
    guest_trial_soft_limit: 3, guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10, guest_batch_hard_limit: 5,
  }),
  loadSettings: () => Promise.resolve({
    guest_trial_soft_limit: 3, guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10, guest_batch_hard_limit: 5,
  }),
}));

// A saveExtraction whose resolution this test controls, so the window between
// "extraction done" and "auto-save landed" can be held open on purpose.
function deferredSave(value) {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  repoMocks.saveExtraction.mockImplementation((row) =>
    promise.then(() => ({ ...row, ...(value || {}), _saved: value?._saved ?? true })),
  );
  return () => resolve();
}

const PRESET = { key: "pricing", label: "Pricing & Plans", icon: "hash", prompt: "Extract every pricing tier." };
const PRESET_2 = { key: "contacts", label: "Find Contact Info", icon: "mail", prompt: "Extract key contacts." };

function Probe() {
  const { extract, enrich, current, view } = useExtraction();
  return (
    <div>
      <button
        data-testid="view"
        onClick={() => view({
          id: "srv-row", url: URL_UNDER_TEST, page_title: "Race", headings: [], links: [],
          enrichments: { pricing: { key: "pricing", label: "Pricing & Plans", icon: "hash", data: { plans: [] }, created_at: "2026-08-28T00:00:00.000Z" } },
        })}
      >view</button>
      <span data-testid="tabs">{Object.keys(current?.enrichments || {}).join(",") || "(none)"}</span>
      <span data-testid="saved">{String(Boolean(current?._saved))}</span>
      <span data-testid="summary">{current?.ai_summary || "(none)"}</span>
      <button data-testid="extract" onClick={() => extract(URL_UNDER_TEST)}>extract</button>
      <button data-testid="enrich" onClick={() => enrich(URL_UNDER_TEST, PRESET)}>enrich</button>
      <button data-testid="enrich2" onClick={() => enrich(URL_UNDER_TEST, PRESET_2)}>enrich2</button>
    </div>
  );
}

function Tree() {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider><ErrorModalProvider><AuthProvider><GuestTrialProvider>
        <PersonaProvider><BillingProvider><ExtractionProvider>
          <Probe />
        </ExtractionProvider></BillingProvider></PersonaProvider>
      </GuestTrialProvider></AuthProvider></ErrorModalProvider></ToastProvider>
    </MemoryRouter>
  );
}

const settle = async () => {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("datiq.guestTrial", JSON.stringify({ count: 0, batchCount: 0, sid: "s1" }));
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  firecrawlMocks.extractStructure.mockImplementation(async (url, options = {}) =>
    options.customPrompt
      ? { url, custom_extraction: { plans: [{ name: "Pro", price: "$29" }] } }
      : { url, page_title: "Race", headings: [], links: [], domain_map: null },
  );
});

describe("ExtractionProvider — a late auto-save must not delete a Quick enrichment tab", () => {
  it("keeps the enrichment committed while POST /extractions was still in flight", async () => {
    const finishSave = deferredSave();
    render(<Tree />);
    await settle();

    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    // The user is on /preview; the auto-save has NOT come back yet.
    expect(repoMocks.saveExtraction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("saved").textContent).toBe("false");

    // They run a Quick enrichment inside that window — the tab appears.
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    expect(screen.getByTestId("tabs").textContent).toBe("pricing");

    // Now the auto-save lands. It must merge, not overwrite.
    await act(async () => { finishSave(); });
    await settle();
    expect(screen.getByTestId("tabs").textContent).toBe("pricing");
    expect(screen.getByTestId("saved").textContent).toBe("true");
  });

  it("a late enrichment does not revert the _saved flag set by the auto-save", async () => {
    // Hold the ENRICHMENT open instead, and let the auto-save land mid-flight.
    let releaseEnrich;
    const enrichGate = new Promise((r) => { releaseEnrich = r; });
    const finishSave = deferredSave();
    firecrawlMocks.extractStructure.mockImplementation(async (url, options = {}) => {
      if (!options.customPrompt) return { url, page_title: "Race", headings: [], links: [], domain_map: null };
      await enrichGate;
      return { url, custom_extraction: { plans: [{ name: "Pro", price: "$29" }] } };
    });

    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();

    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    // Auto-save lands while the enrichment is still awaiting the network.
    await act(async () => { finishSave(); });
    await settle();
    expect(screen.getByTestId("saved").textContent).toBe("true");

    await act(async () => { releaseEnrich(); });
    await settle();
    expect(screen.getByTestId("tabs").textContent).toBe("pricing");
    // _saved is what gates the Supabase sync of every later tab. Losing it
    // here is invisible until tabs stop appearing on another device.
    expect(screen.getByTestId("saved").textContent).toBe("true");
  });

  it("does not claim _saved for a row the saved-searches cap refused", async () => {
    const finishSave = deferredSave({ _saved: false, _capHit: true, _cap: 10 });
    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { finishSave(); });
    await settle();
    expect(screen.getByTestId("saved").textContent).toBe("false");
  });
});

describe("ExtractionProvider — enrichments queued during the save flush once the row exists", () => {
  it("PATCHes the tab that was created while POST /extractions was in flight", async () => {
    const finishSave = deferredSave();
    render(<Tree />);
    await settle();

    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();

    // No row yet, so nothing may be PATCHed at it.
    expect(repoMocks.updateEnrichments).not.toHaveBeenCalled();

    await act(async () => { finishSave(); });
    await settle();

    // Row exists → the parked map is sent, complete, exactly once.
    expect(repoMocks.updateEnrichments).toHaveBeenCalledTimes(1);
    const [, map] = repoMocks.updateEnrichments.mock.calls[0];
    expect(Object.keys(map)).toEqual(["pricing"]);
    expect(map.pricing.data).toEqual({ plans: [{ name: "Pro", price: "$29" }] });
  });

  it("sends one complete map, not one PATCH per capability, when two run in the window", async () => {
    const finishSave = deferredSave();
    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich2").click(); });
    await settle();

    await act(async () => { finishSave(); });
    await settle();
    expect(repoMocks.updateEnrichments).toHaveBeenCalledTimes(1);
    expect(Object.keys(repoMocks.updateEnrichments.mock.calls[0][1]).sort()).toEqual(["contacts", "pricing"]);
  });

  it("does not PATCH when the save wrote no row (saved-searches cap refused it)", async () => {
    const finishSave = deferredSave({ _saved: false, _capHit: true });
    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    await act(async () => { finishSave(); });
    await settle();
    expect(repoMocks.updateEnrichments).not.toHaveBeenCalled();
  });

  it("does not PATCH — or leak the parked entry — when the save rejects", async () => {
    let rejectSave;
    repoMocks.saveExtraction.mockImplementation(() => new Promise((_, rej) => { rejectSave = rej; }));
    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    await act(async () => { rejectSave(new Error("offline")); });
    await settle();
    expect(repoMocks.updateEnrichments).not.toHaveBeenCalled();
    // The tab is still on screen — a failed save must not cost the user the
    // capability they just paid a credit for.
    expect(screen.getByTestId("tabs").textContent).toBe("pricing");
  });

  it("still syncs immediately when the row was already saved (unchanged path)", async () => {
    const finishSave = deferredSave();
    render(<Tree />);
    await settle();
    await act(async () => { screen.getByTestId("extract").click(); });
    await settle();
    await act(async () => { finishSave(); });
    await settle();
    await act(async () => { screen.getByTestId("enrich").click(); });
    await settle();
    expect(repoMocks.updateEnrichments).toHaveBeenCalledTimes(1);
  });
});

// The point of the flush: the tab has to come BACK. Opening the row from the
// Dashboard on a machine with no local cache must show the capability, which
// only works if the enrichments map actually reached the server row.
describe("ExtractionProvider.view — a synced tab reloads from the server row", () => {
  it("renders the enrichment from the row alone, with an empty local cache", async () => {
    render(<Tree />);
    await settle();
    localStorage.removeItem("datiq.enrichments");
    await act(async () => { screen.getByTestId("view").click(); });
    await settle();
    expect(screen.getByTestId("tabs").textContent).toBe("pricing");
  });
});
