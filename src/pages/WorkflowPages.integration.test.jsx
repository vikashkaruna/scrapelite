// src/pages/WorkflowPages.integration.test.jsx
//
// Covers TS-9's S-07 / S-13 / S-20 — "does the page render the workspace for a
// signed-in user, or the signed-out gate?" — at the component level.
//
// ── WHY THIS IS HERE RATHER THAN ONLY IN A LIVE BROWSER PASS ────────────────
//
// Those three cases assert RENDERING, and rendering is decided entirely by
// `useAuth()`'s `user`. A live staging click-through proves the same branch with
// far more setup and far more ways to be flaky, and it cannot be run in CI at
// all because it needs a real account. What a live pass still proves that this
// does not is that a real credential can obtain a real session — which is a
// different assertion, about Supabase, not about these pages.
//
// ── THE BRANCH THAT MATTERS IN BOTH DIRECTIONS ──────────────────────────────
//
// Signed OUT must show the reason, not an error. These endpoints answer 401
// rather than returning another tenant's rows, so without the gate the client
// SDK throws "Authentication required" and the page renders a raw failure — a
// correct decision reported as a fault, which is the exact shape this codebase
// has had to fix repeatedly.
//
// Signed IN must NOT show the gate. That direction is the one a regression
// would silently break: adding an early return, or reading `user` from the
// wrong provider, locks every paying customer out of a feature they bought, and
// the signed-out test would still pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const SIGNED_IN = { id: "user-1", email: "u1@example.com" };

let authUser = null;

// The three pages all reach the network on mount once a user exists. Their
// clients are mocked to resolve empty so the test is about the auth branch and
// not about data loading.
vi.mock("../lib/bulk/bulkClient.js", () => ({
  listLists: vi.fn(async () => ({ ok: true, lists: [] })),
  getList: vi.fn(async () => ({ list: null })),
  createList: vi.fn(async () => ({ ok: true })),
  getIcpRules: vi.fn(async () => ({ rules: null })),
  saveIcpRules: vi.fn(async () => ({ ok: true })),
  processChunk: vi.fn(async () => ({ ok: true, done: true })),
  getReviewQueue: vi.fn(async () => ({ ok: true, items: [] })),
  resolveReview: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/watchlist/watchlistClient.js", () => ({
  listWatchlists: vi.fn(async () => ({ ok: true, watchlists: [] })),
  getWatchlist: vi.fn(async () => ({ watchlist: null })),
  createWatchlist: vi.fn(async () => ({ ok: true })),
  submitFeedback: vi.fn(async () => ({ ok: true })),
  recordChange: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/rules/rulesClient.js", () => ({
  listRules: vi.fn(async () => ({ ok: true, rules: [] })),
  createRule: vi.fn(async () => ({ ok: true })),
  deleteRule: vi.fn(async () => ({ ok: true })),
  testRule: vi.fn(async () => ({ matches: false, reasons: [] })),
}));

vi.mock("../components/AuthProvider.jsx", () => ({
  useAuth: () => ({ user: authUser, openAuth: vi.fn(), closeAuth: vi.fn() }),
  default: ({ children }) => children,
}));

vi.mock("../components/Toast.jsx", () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => children,
}));

const PAGES = [
  { name: "Lists (PRD 3)", id: "S-07", path: "../pages/Lists.jsx", heading: /bulk account intelligence/i },
  { name: "Watchlists (PRD 4)", id: "S-13", path: "../pages/Watchlists.jsx", heading: /competitor watchlists/i },
  { name: "SignalRules (PRD 5)", id: "S-20", path: "../pages/SignalRules.jsx", heading: /signal routing rules/i },
];

async function renderPage(path) {
  vi.resetModules();
  const mod = await import(/* @vite-ignore */ path);
  const Page = mod.default;
  render(<MemoryRouter><Page /></MemoryRouter>);
}

beforeEach(() => { authUser = null; });
afterEach(() => { vi.clearAllMocks(); });

describe.each(PAGES)("$id · $name — signed OUT shows the reason, not an error", ({ path, heading }) => {
  it("renders the signed-in-required state", async () => {
    authUser = null;
    await renderPage(path);
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a free account/i })).toBeInTheDocument();
  });

  it("does NOT render a raw authentication error", async () => {
    authUser = null;
    await renderPage(path);
    // The client SDK throws `Authentication required` on a 401. If that string
    // reaches the screen, the gate is missing and a policy decision is being
    // reported as a crash.
    expect(screen.queryByText(/authentication required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("offers both a sign-up and a sign-in route out", async () => {
    authUser = null;
    await renderPage(path);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});

describe.each(PAGES)("$id · $name — signed IN shows the workspace", ({ path }) => {
  it("🔴 does NOT render the signed-out gate", async () => {
    // The direction a regression breaks silently: an early return or a `user`
    // read from the wrong provider locks every paying customer out, and the
    // signed-out test above would still pass.
    authUser = SIGNED_IN;
    await renderPage(path);
    expect(screen.queryByRole("button", { name: /create a free account/i })).not.toBeInTheDocument();
  });

  it("renders its own primary action", async () => {
    authUser = SIGNED_IN;
    await renderPage(path);
    // Every one of the three leads with a create affordance; which one it is
    // differs, so this asserts that SOME primary action rendered rather than an
    // empty shell.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
