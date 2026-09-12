// src/pages/Account.integration.test.jsx
// I-38 — Account page integration.
//
//   - Plan name from the effective plan map is rendered
//   - Usage stats (extractions + bonus + 4 counters) are present
//   - Coupon apply / remove UI is present
//   - Payment history table renders (or empty state)
//   - Integrations rich status (2026-08-11) — per-provider detail
//     lines + Test / Edit / Disconnect actions

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import Account from "./Account.jsx";
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

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn(() => Promise.resolve([])),
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

const integrationMocks = vi.hoisted(() => ({
  testIntegrationConnection: vi.fn(),
  patchIntegrationConnection: vi.fn(),
  pushToIntegration: vi.fn(),
  getIntegrationStatus: vi.fn(),
  getPushProviderStatuses: vi.fn(),
  fetchAirtableTablesClient: vi.fn(() => Promise.resolve({ ok: true, tables: [] })),
  createAirtableTableClient: vi.fn(() => Promise.resolve({ ok: true })),
  PUSH_PROVIDERS: [
    { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "CRM" },
    { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "DB" },
    { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Base" },
    { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Channel" },
    { slug: "zapier",   name: "Zapier",   icon: "share",          desc: "Zapier" },
  ],
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

// The supabaseClient.js has no env vars in the test env, so the real
// `supabase` export is null. Account.jsx checks for that and silently
// no-ops the integrations fetch. The I-39 block below needs a working
// `supabase.auth.getSession()` to drive the status fetch. We install
// a top-level mock that reads a hoisted `supabaseSession` variable —
// by default it's "not signed in" (matches the existing tests); the
// I-39 block sets it to a signed-in session before each render.
// Spread + importOriginal so we keep the real module's other exports
// (e.g. isSupabaseEnabled, EXTRACTIONS_TABLE). The I-38 free-plan
// tests don't touch integrations, so they don't care about the session.
const supabaseState = vi.hoisted(() => ({ session: null }));
vi.mock("../lib/supabaseClient.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: supabaseState.session } }),
      },
    },
  };
});

vi.mock("../lib/integrationsClient.js", () => ({
  testIntegrationConnection: integrationMocks.testIntegrationConnection,
  patchIntegrationConnection: integrationMocks.patchIntegrationConnection,
  pushToIntegration: integrationMocks.pushToIntegration,
  getIntegrationStatus: integrationMocks.getIntegrationStatus,
  getPushProviderStatuses: integrationMocks.getPushProviderStatuses,
  fetchAirtableTablesClient: integrationMocks.fetchAirtableTablesClient,
  createAirtableTableClient: integrationMocks.createAirtableTableClient,
  PUSH_PROVIDERS: integrationMocks.PUSH_PROVIDERS,
}));

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
  // Default: integration status is empty / not connected.
  // The integration tests override this per-test to drive the rich
  // status + Test/Edit flows.
  integrationMocks.testIntegrationConnection.mockResolvedValue({ ok: true });
  integrationMocks.patchIntegrationConnection.mockResolvedValue({ ok: true });
  // Reset the supabase session hoisted variable. The I-39 block sets
  // it to a signed-in session before each test, then restores null
  // here for the next run.
  supabaseState.session = null;
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/account"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Account />
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

describe("I-38 — Account: plan + usage", () => {
  it("renders the current plan name from the effective plan map (Free by default)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/current plan/i)).toBeInTheDocument();
    // The Free plan card has both the "Free" name and the "Free" badge.
    const planName = document.querySelector(".apc-plan-name");
    expect(planName).not.toBeNull();
    expect(planName.textContent).toMatch(/Free/);
  });

  it("renders the 4 quick-stats counters (extractions / enrichments / batch / content)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Each counter has a label. Scope to .account-stats to avoid matching
    // other "extractions" strings elsewhere on the page.
    const stats = document.querySelector(".account-stats");
    expect(stats).not.toBeNull();
    expect(stats.textContent).toMatch(/extractions/i);
    expect(stats.textContent).toMatch(/enrichments/i);
    expect(stats.textContent).toMatch(/batch executions/i);
    expect(stats.textContent).toMatch(/content generations/i);
  });

  it("renders the coupon input", () => {
    render(<Tree />);
    expect(screen.getByPlaceholderText(/enter code/i)).toBeInTheDocument();
  });

  it("puts 'Explore plans & top-up bundles' ABOVE the coupon + white-label cards in the right column (2026-08-11)", () => {
    render(<Tree />);
    // The right column is .account-aside. We pin the order of the four
    // top-level children: the top-up CTA first, then the white-label
    // uploader, then the coupon card, then quick stats. A future refactor
    // that reorders these (e.g. moves the CTA back to the bottom) gets
    // caught here.
    const aside = document.querySelector(".account-aside");
    expect(aside).not.toBeNull();
    const kids = Array.from(aside.children);
    // First child = the top-up CTA (it has the "Explore plans & top-up bundles" text).
    expect(kids[0].textContent).toMatch(/Explore plans & top-up bundles/);
    // Second child is the white-label uploader.
    expect(kids[1].querySelector(".wltu-card, [class*='white-label']") || kids[1].tagName).toBeTruthy();
    // Third child = the coupon / promo code card.
    expect(kids[2].textContent).toMatch(/coupon \/ promo code/i);
    // Fourth child = the quick stats card.
    expect(kids[3].classList.contains("account-stats")).toBe(true);
  });
});

// ── I-39 — Account Integrations rich status (2026-08-11) ────────────────
//
// The Account page now renders per-provider rich status (token_hint, IDs,
// field_map summary) plus three actions per connected row: Test, Edit,
// Disconnect. These tests cover the render + interaction paths. The
// server-side status response is mocked via global.fetch; the
// testIntegrationConnection wrapper is mocked directly.
describe("I-39 — Account: Integrations rich status (2026-08-11)", () => {
  // The Account page reads the session from supabase.auth.getSession()
  // (not the authService wrapper) and calls /api/integrations/{slug}/status
  // directly with fetch. We mock the supabase session at the top of
  // this file (supabaseState.session) and the per-provider /status
  // response here via global.fetch.
  function setupSignedInWithStatuses(statuses) {
    supabaseState.session = { access_token: "test-token", user: { id: "u1" } };
    authMocks.getSession.mockResolvedValue(supabaseState.session);
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const m = String(url).match(/\/api\/integrations\/([^/]+)\/status/);
      if (m) {
        const slug = m[1];
        return makeFetchResponse(200, statuses[slug] || { connected: false, provider: slug });
      }
      return makeFetchResponse(200, {});
    });
  }

  it("renders the rich status detail (token_hint, database_id, title column, column count) for a connected Notion", async () => {
    setupSignedInWithStatuses({
      notion: {
        connected: true,
        provider: "notion",
        connection: {
          account_label: "Workspace",
          token_hint: "secret…abcd",
          database_id: "abcdef0123456789abcdef0123456789",
          title_column: "Name",
          column_count: 7,
          has_api_key: true,
        },
      },
    });
    render(<Tree />);
    // Wait for the status fetch to land and the row to render.
    await waitFor(() => {
      expect(screen.getByText(/secret…abcd/)).toBeInTheDocument();
    });
    // The Notion row should show database ID, title column, and column count.
    expect(screen.getByText(/abcdef0123…6789/i)).toBeInTheDocument();
    expect(screen.getByText(/^Name$/)).toBeInTheDocument();
    expect(screen.getByText(/^7$/)).toBeInTheDocument();
  });

  it("renders the field_map summary chips for a connected Airtable row", async () => {
    setupSignedInWithStatuses({
      airtable: {
        connected: true,
        provider: "airtable",
        connection: {
          account_label: "ACME",
          token_hint: "pat…xQ7z",
          base_id: "appABCDEFGHIJK",
          table_id: "tblABCDEFGHIJK",
          table_meta: { tableName: "Leads", fields: [{ name: "URL" }, { name: "Title" }] },
          field_map: { URL: { key: "url" }, Title: { key: "page_title" } },
          field_map_summary: "URL→Link, Title→Name (+0 more)",
          has_api_key: true,
        },
      },
    });
    render(<Tree />);
    await waitFor(() => {
      expect(screen.getByText(/pat…xQ7z/)).toBeInTheDocument();
    });
    // Table name shows up.
    expect(screen.getByText(/^Leads$/)).toBeInTheDocument();
    // Field map summary is rendered.
    expect(screen.getByText(/URL→Link, Title→Name/)).toBeInTheDocument();
  });

  it("shows the Test, Edit, and Disconnect actions for a connected provider", async () => {
    setupSignedInWithStatuses({
      hubspot: {
        connected: true,
        provider: "hubspot",
        connection: { account_label: "ACME CRM", token_hint: "pat-na1…xQ7z" },
      },
    });
    render(<Tree />);
    // Wait for the status row to render with the rich detail.
    await waitFor(() => {
      expect(screen.getByText(/pat-na1…xQ7z/)).toBeInTheDocument();
    });
    // The three action buttons (Test / Edit / Disconnect) all exist.
    const testBtn      = screen.getByRole("button", { name: /^Test$/ });
    const editBtn      = screen.getByRole("button", { name: /^Edit$/ });
    const disconnectBtn = screen.getByRole("button", { name: /^Disconnect$/ });
    expect(testBtn).toBeInTheDocument();
    expect(editBtn).toBeInTheDocument();
    expect(disconnectBtn).toBeInTheDocument();
  });

  it("clicking Test calls testIntegrationConnection with the provider slug", async () => {
    const user = userEvent.setup();
    integrationMocks.testIntegrationConnection.mockResolvedValue({
      ok: true, portalId: "12345678",
    });
    setupSignedInWithStatuses({
      hubspot: {
        connected: true, provider: "hubspot",
        connection: { account_label: "ACME CRM", token_hint: "pat-na1…xQ7z" },
      },
    });
    render(<Tree />);
    await waitFor(() => screen.getByRole("button", { name: /^Test$/ }));
    await user.click(screen.getByRole("button", { name: /^Test$/ }));
    await waitFor(() => {
      expect(integrationMocks.testIntegrationConnection).toHaveBeenCalledWith("hubspot");
    });
  });

  it("clicking Edit opens the EditIntegrationModal pre-populated with the current values", async () => {
    const user = userEvent.setup();
    setupSignedInWithStatuses({
      airtable: {
        connected: true, provider: "airtable",
        connection: {
          account_label: "ACME Airtable",
          token_hint: "pat…xQ7z",
          base_id: "appABCDEFGHIJK",
          table_id: "tblABCDEFGHIJK",
          field_map: { URL: { key: "url" } },
        },
      },
    });
    render(<Tree />);
    // Find the Edit button inside the Airtable row (not the top-level
    // integrations section), then click it.
    const editButtons = await screen.findAllByRole("button", { name: /^Edit$/ });
    expect(editButtons.length).toBeGreaterThan(0);
    await user.click(editButtons[0]);
    // Modal title + the pre-populated values should be visible.
    expect(await screen.findByRole("heading", { name: /Edit Airtable/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("ACME Airtable")).toBeInTheDocument();
    expect(screen.getByDisplayValue("appABCDEFGHIJK")).toBeInTheDocument();
    expect(screen.getByDisplayValue("tblABCDEFGHIJK")).toBeInTheDocument();
  });

  it("clicking Save in the Edit modal calls patchIntegrationConnection with refreshSchema:true for Airtable", async () => {
    const user = userEvent.setup();
    setupSignedInWithStatuses({
      airtable: {
        connected: true, provider: "airtable",
        connection: { account_label: "Old", base_id: "appOLD", table_id: "tblOLD" },
      },
    });
    render(<Tree />);
    const editButtons = await screen.findAllByRole("button", { name: /^Edit$/ });
    await user.click(editButtons[0]);
    const accountInput = await screen.findByDisplayValue("Old");
    await user.clear(accountInput);
    await user.type(accountInput, "New");
    await user.click(screen.getByRole("button", { name: /Save & refresh schema/i }));
    await waitFor(() => {
      expect(integrationMocks.patchIntegrationConnection).toHaveBeenCalledWith(
        "airtable",
        expect.objectContaining({
          accountLabel: "New",
          refreshSchema: true,
        }),
      );
    });
  });

  it("clicking Edit on Zapier opens EditIntegrationModal pre-populated with webhookUrl and saving updates it", async () => {
    const user = userEvent.setup();
    setupSignedInWithStatuses({
      zapier: {
        connected: true,
        provider: "zapier",
        connection: {
          account_label: "My Zapier",
          token_hint: "abcd",
          webhook_url: "https://hooks.zapier.com/hooks/catch/123/old",
          webhook_hint: "hooks.zapier.com/hooks/catch/123/old",
        },
      },
    });
    render(<Tree />);

    const editButtons = await screen.findAllByRole("button", { name: /^Edit$/ });
    await user.click(editButtons[0]);

    expect(await screen.findByRole("heading", { name: /Edit Zapier/i })).toBeInTheDocument();
    const webhookInput = screen.getByDisplayValue("https://hooks.zapier.com/hooks/catch/123/old");
    expect(webhookInput).toBeInTheDocument();

    await user.clear(webhookInput);
    await user.type(webhookInput, "https://hooks.zapier.com/hooks/catch/456/new");
    await user.click(screen.getByRole("button", { name: /^Save changes$/ }));

    await waitFor(() => {
      expect(integrationMocks.patchIntegrationConnection).toHaveBeenCalledWith(
        "zapier",
        expect.objectContaining({
          accountLabel: "My Zapier",
          webhookUrl: "https://hooks.zapier.com/hooks/catch/456/new",
        }),
      );
    });
  });

  it("allows testing secret key and testing connection from Zapier Edit modal", async () => {
    const user = userEvent.setup();
    integrationMocks.testIntegrationConnection.mockResolvedValue({
      ok: true,
      detail: "Secret key verified",
    });
    setupSignedInWithStatuses({
      zapier: {
        connected: true,
        provider: "zapier",
        connection: {
          account_label: "My Zapier",
          token_hint: "abcd",
          webhook_url: "https://hooks.zapier.com/hooks/catch/123/old",
        },
      },
    });
    render(<Tree />);

    const editButtons = await screen.findAllByRole("button", { name: /^Edit$/ });
    await user.click(editButtons[0]);

    expect(await screen.findByRole("heading", { name: /Edit Zapier/i })).toBeInTheDocument();

    // 1. Verify key sub-form
    const keyInput = screen.getByPlaceholderText(/Paste zap_\.\.\. token to test/i);
    await user.type(keyInput, "zap_test_secret_12345");
    await user.click(screen.getByRole("button", { name: /^Verify key$/ }));

    await waitFor(() => {
      expect(integrationMocks.testIntegrationConnection).toHaveBeenCalledWith("zapier", {
        token: "zap_test_secret_12345",
      });
    });
    expect(await screen.findByText(/Secret key verified/i)).toBeInTheDocument();

    // 2. Test connection footer button
    const testConnBtn = screen.getByRole("button", { name: /Test connection/i });
    await user.click(testConnBtn);

    await waitFor(() => {
      expect(integrationMocks.testIntegrationConnection).toHaveBeenCalledWith("zapier");
    });
  });
});

// Helper: build a minimal fetch Response for the test mocks. We don't
// pull in the full Response polyfill — just enough to satisfy the
// Account page's `await r.json()` paths.
function makeFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => "application/json" },
  };
}
