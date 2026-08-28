// src/pages/PublicReport.test.jsx — Q8 public report route tests.
// Verifies the cross-browser fix: a slug from a "different browser" (empty
// localStorage) is still found via the Supabase path (mocked here).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";

// Mock supabase so getPublicBySlug can resolve cross-browser.
const supabaseMock = {
  enabled: true,
  from: vi.fn(),
  auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
};
vi.mock("../lib/supabaseClient.js", () => ({
  get supabase() { return supabaseMock.enabled ? supabaseMock : null; },
  // Real export is a plain boolean — see shareService.test.js's own note on
  // this same mock shape.
  get isSupabaseEnabled() { return supabaseMock.enabled; },
}));

import PublicReport from "./PublicReport.jsx";
import { shareExtraction, _resetShareForTests } from "../lib/shareService.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetShareForTests();
  supabaseMock.from.mockReset();
  supabaseMock.from.mockImplementation(() => defaultSupabaseChain());
  // shareExtraction's write path now POSTs to public-reports.js — see
  // shareService.test.js's mockPublishFetch for the reasoning.
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true, slug: body.slug, refreshed: true }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Build a Supabase chain that returns the row we want for the requested slug.
function defaultSupabaseChain({ rowForSlug } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq:    vi.fn(() => chain),
    maybeSingle: vi.fn(async () => {
      if (!rowForSlug) return { data: null, error: null };
      return { data: rowForSlug, error: null };
    }),
    upsert: vi.fn(async (row) => ({ data: { slug: row.slug }, error: null })),
    delete: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
  };
  return chain;
}

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/p/${slug}`]}>
      <Routes>
        <Route path="/p/:slug" element={<PublicReport />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sample = () => ({
  id: "ext_pub_1",
  title: "Stripe — Pricing",
  url: "https://stripe.com/pricing",
  ai_summary: "Stripe offers 4 pricing tiers including a free Starter plan.",
  custom_extraction: { plans: [{ name: "Starter", price: "$0" }] },
  headings: [{ level: 1, text: "Pricing" }, { level: 2, text: "Starter" }],
  links: [{ text: "Sign up", href: "https://stripe.com/signup" }],
  intent: "pricing",
  created_at: new Date().toISOString(),
});

describe("Q8 — /p/:slug public report (async lookup)", () => {
  it("renders a loading state while the report is being fetched", () => {
    renderAt("k7m2p4qx");
    expect(screen.getByText(/Loading shared report/i)).toBeInTheDocument();
  });

  it("renders the not-found state when the slug doesn't exist anywhere", async () => {
    renderAt("nopenope");
    await waitFor(() => {
      expect(screen.getByText(/Report not found/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /public gallery/i })).toBeInTheDocument();
  });

  it("renders a shared extraction from localStorage", async () => {
    const { slug } = await shareExtraction(sample());
    renderAt(slug);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Stripe — Pricing" })).toBeInTheDocument();
    });
  });

  it("renders a shared extraction from Supabase (the cross-browser fix)", async () => {
    const pub = {
      id: "ext_remote",
      slug: "remote01",
      title: "Remote report",
      url: "https://remote.example.com",
      ai_summary: "Hello from a different browser.",
      headings: [{ level: 1, text: "Hello" }],
      links: [],
      intent: "summary",
      created_at: new Date().toISOString(),
      is_public: true,
    };
    // Simulate: the originator's localStorage is empty in this browser.
    try { localStorage.clear(); } catch {}
    supabaseMock.from.mockImplementation(() => defaultSupabaseChain({
      rowForSlug: { slug: "remote01", data: pub },
    }));
    renderAt("remote01");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Remote report" })).toBeInTheDocument();
    });
    // The remote AI summary renders
    expect(screen.getByText(/Hello from a different browser/)).toBeInTheDocument();
  });

  it("renders headings and links when present", async () => {
    const { slug } = await shareExtraction(sample());
    renderAt(slug);
    await waitFor(() => {
      expect(screen.getByText("Pricing")).toBeInTheDocument();
    });
    expect(screen.getByText("Sign up")).toBeInTheDocument();
  });

  it("shows a CTA back to DatIQ in the footer", async () => {
    const { slug } = await shareExtraction(sample());
    renderAt(slug);
    await waitFor(() => {
      expect(screen.getByText(/Extract any page in seconds/i)).toBeInTheDocument();
    });
  });

  it("renders a Copy button on the AI summary section", async () => {
    const { slug } = await shareExtraction(sample());
    renderAt(slug);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Stripe — Pricing" })).toBeInTheDocument();
    });
    // The Summary section has a copy button (in addition to the footer's
    // "Copy this page's link" button)
    const copyButtons = screen.getAllByRole("button", { name: /Copy/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });
});
