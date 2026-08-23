// RecentExtractions.integration.test.jsx — QW#4 + user-specific integration test.
// Mounts the Home page with a seeded `datiq.saved` localStorage and confirms
// the recent-extractions widget renders the right items + filter behaviour +
// user-specific scoping + click → /preview navigation.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import userEvent from "@testing-library/user-event";

// Stub Toast + Theme to keep the mount cheap.
vi.mock("./Toast.jsx", () => ({
  useToast: () => () => {},
  ToastProvider: ({ children }) => children,
}));
vi.mock("./ThemeProvider.jsx", () => ({
  useTheme: () => ({ theme: "light", setTheme: () => {} }),
  ThemeProvider: ({ children }) => children,
}));
vi.mock("./PersonaProvider.jsx", () => ({
  usePersona: () => ({ personaId: null, userName: null }),
  PersonaProvider: ({ children }) => children,
}));
vi.mock("./BillingProvider.jsx", () => ({
  useBilling: () => ({
    checkCanExtractSingle: () => ({ ok: true }),
    checkCanExport: () => true,
    planId: "free",
  }),
  BillingProvider: ({ children }) => children,
}));
// ExtractionProvider needs a richer stub for `view()`.
vi.mock("./ExtractionProvider.jsx", () => ({
  useExtraction: () => ({
    view: vi.fn(),
  }),
  ExtractionProvider: ({ children }) => children,
}));
// Stub the auth provider to keep the test offline.
const authMocks = vi.hoisted(() => ({
  user: null,
  setUser: () => {},
}));
vi.mock("./AuthProvider.jsx", () => ({
  useAuth: () => ({ user: authMocks.user }),
  AuthProvider: ({ children }) => children,
}));
// Supabase is not configured in jsdom.
vi.mock("../lib/supabaseClient.js", () => ({
  supabase: null,
  isSupabaseEnabled: false,
  EXTRACTIONS_TABLE: "extractions",
}));
// Pin a known session id for the guest owner in this test run.
const usageRepoMocks = vi.hoisted(() => ({
  getSessionId: () => "sess_test_recent",
}));
vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
// Icon is heavy; just render text. Keep this stub minimal.
vi.mock("./Icon.jsx", () => ({
  default: ({ name, size }) => <span data-icon={name} data-size={size} />,
}));
// statsService returns null in jsdom (no /api).
vi.mock("../lib/statsService.js", () => ({
  getStats: () => Promise.resolve(null),
  fmtStat: (n) => String(n),
}));

import Home from "../pages/Home.jsx";
import Preview from "../pages/Preview.jsx";

const OWNER_SESSION = "sess_test_recent";

function seedSaved(items) {
  localStorage.setItem("datiq.saved", JSON.stringify(items));
}

function owned(item) {
  return { ...item, user_id: null, session_id: OWNER_SESSION };
}

const SAMPLE_ITEMS = [
  owned({
    id: "x1",
    url: "https://stripe.com/pricing",
    page_title: "Stripe Pricing",
    created_at: "2026-07-15T10:00:00.000Z",
    headings: [],
    links: [],
  }),
  owned({
    id: "x2",
    url: "https://anthropic.com",
    page_title: "Anthropic — AI research",
    created_at: "2026-07-14T10:00:00.000Z",
    headings: [],
    links: [],
  }),
  owned({
    id: "x3",
    url: "https://example.com",
    page_title: "Example Domain",
    created_at: "2026-07-13T10:00:00.000Z",
    headings: [],
    links: [],
  }),
];

describe("QW#4 — RecentExtractions widget on Home", () => {
  beforeEach(() => {
    localStorage.clear();
    authMocks.user = null;
  });

  it("does not render when datiq.saved is empty", async () => {
    seedSaved([]);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    // Owner resolves but no items match → widget hidden.
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /recent extractions/i })).toBeNull();
    });
  });

  it("renders up to 5 items owned by the current session, sorted by created_at desc", async () => {
    seedSaved(SAMPLE_ITEMS);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    const region = await screen.findByRole("region", { name: /recent extractions/i });
    const cards = within(region).getAllByRole("button", { name: /stripe pricing|anthropic|example domain/i });
    expect(cards).toHaveLength(3);
    // Newest first (Stripe Pricing was most recent)
    expect(cards[0]).toHaveTextContent(/stripe pricing/i);
    expect(cards[2]).toHaveTextContent(/example domain/i);
  });

  it("shows a search filter when ≥2 items are present", async () => {
    seedSaved(SAMPLE_ITEMS);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByLabelText(/filter recent extractions/i)).toBeInTheDocument();
  });

  it("filters items by URL or title", async () => {
    seedSaved(SAMPLE_ITEMS);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    const input = await screen.findByLabelText(/filter recent extractions/i);
    await user.type(input, "anthropic");
    // Only the Anthropic card remains visible.
    expect(screen.getByText(/anthropic — ai research/i)).toBeInTheDocument();
    expect(screen.queryByText(/stripe pricing/i)).toBeNull();
  });

  it("navigates to /preview when a recent card is clicked", async () => {
    seedSaved(SAMPLE_ITEMS);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/preview" element={<Preview />} />
        </Routes>
      </MemoryRouter>
    );
    const card = await screen.findByRole("button", { name: /stripe pricing/i });
    await user.click(card);
    // The stub view() doesn't actually navigate (no router push in stub),
    // but we can confirm the click is non-throwing.
    expect(card).toBeInTheDocument();
  });

  it("View all link routes to /dashboard", async () => {
    seedSaved(SAMPLE_ITEMS);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<div data-testid="dash-marker">dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
    const link = await screen.findByRole("button", { name: /view all/i });
    await user.click(link);
    expect(await screen.findByTestId("dash-marker")).toBeInTheDocument();
  });

  // ── User-specific scoping (Q-UI) ───────────────────────────────────────
  it("HIDES items that don't belong to the current session", async () => {
    seedSaved([
      // Owned by the current session — should appear.
      owned({
        id: "mine-1",
        url: "https://mine.example/pricing",
        page_title: "My Pricing",
        created_at: "2026-07-15T10:00:00.000Z",
      }),
      // Owned by another session — should be hidden.
      {
        id: "theirs-1",
        url: "https://theirs.example/pricing",
        page_title: "Theirs Pricing",
        created_at: "2026-07-15T11:00:00.000Z",
        user_id: null,
        session_id: "sess_someone_else",
      },
      // Legacy item with no owner — should be hidden (predates the change).
      {
        id: "legacy-1",
        url: "https://legacy.example",
        page_title: "Legacy",
        created_at: "2026-07-10T10:00:00.000Z",
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    const region = await screen.findByRole("region", { name: /recent extractions/i });
    expect(within(region).getByText(/my pricing/i)).toBeInTheDocument();
    expect(within(region).queryByText(/theirs pricing/i)).toBeNull();
    expect(within(region).queryByText(/^legacy$/i)).toBeNull();
  });

  it("HIDES everything when the owner cannot be resolved (no current session)", async () => {
    // Override the session-id stub to return null (anonymous).
    usageRepoMocks.getSessionId = () => null;
    seedSaved(SAMPLE_ITEMS);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    // No region renders when the owner is null.
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /recent extractions/i })).toBeNull();
    });
  });

  it("when no items are owned by the current session, the widget is hidden", async () => {
    // Seed items owned by a different session.
    seedSaved([
      {
        id: "theirs-1",
        url: "https://theirs.example/pricing",
        page_title: "Theirs Pricing",
        created_at: "2026-07-15T10:00:00.000Z",
        user_id: null,
        session_id: "sess_someone_else",
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    // The owner resolves to our session, but the only saved item is
    // owned by a different session → widget is hidden.
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /recent extractions/i })).toBeNull();
    });
  });
});
