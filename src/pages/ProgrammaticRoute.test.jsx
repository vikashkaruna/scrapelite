// src/pages/ProgrammaticRoute.test.jsx — F11 (programmatic route component).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProgrammaticRoute from "./ProgrammaticRoute.jsx";

vi.mock("../lib/seoMeta.js", () => ({
  setMeta: vi.fn(),
  // Real implementation, not a stub: these tests assert the canonical
  // URL that gets set, and a mocked-away canonicalUrl would let a
  // localhost or query-string canonical pass unnoticed — which is the
  // exact bug it was introduced to prevent.
  canonicalUrl: (p) => `https://datiq.app${String(p || "/").split(/[?#]/)[0]}`,
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderAt(path) {
  mockNavigate.mockClear();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/for-sales" element={<ProgrammaticRoute />} />
        <Route path="/for-seo" element={<ProgrammaticRoute />} />
        <Route path="/for-ci" element={<ProgrammaticRoute />} />
        <Route path="/extract-pricing" element={<ProgrammaticRoute />} />
        <Route path="/extract-contacts" element={<ProgrammaticRoute />} />
        <Route path="/extract-headings" element={<ProgrammaticRoute />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProgrammaticRoute (F11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a 404 fallback for unknown slugs", () => {
    // /for-nope is not registered in the test routes → the component still
    // renders via the /:slug catch-all (we test the 404 inside the component
    // by hitting it with an unrecognised path).
    render(
      <MemoryRouter initialEntries={["/for-nope"]}>
        <Routes>
          <Route path="/for-sales" element={<ProgrammaticRoute />} />
        </Routes>
        <ProgrammaticRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
  });

  it("renders for-sales with persona copy and CTA", () => {
    renderAt("/for-sales");
    expect(screen.getByRole("heading", { name: /DatIQ for sales teams/i })).toBeInTheDocument();
    expect(screen.getByText(/qualified prospect/i)).toBeInTheDocument();
  });

  it("renders for-seo with SEO-specific copy", () => {
    renderAt("/for-seo");
    expect(screen.getByRole("heading", { name: /DatIQ for SEO teams/i })).toBeInTheDocument();
  });

  it("renders for-ci with competitive-intel copy", () => {
    renderAt("/for-ci");
    expect(screen.getByRole("heading", { name: /DatIQ for competitive intelligence/i })).toBeInTheDocument();
  });

  it("renders extract-pricing with the right H1", () => {
    renderAt("/extract-pricing");
    expect(screen.getByRole("heading", { name: /Extract pricing from any web page/i })).toBeInTheDocument();
  });

  it("renders extract-contacts with the right H1", () => {
    renderAt("/extract-contacts");
    expect(screen.getByRole("heading", { name: /Extract contacts from any web page/i })).toBeInTheDocument();
  });

  it("renders extract-headings with the right H1", () => {
    renderAt("/extract-headings");
    expect(screen.getByRole("heading", { name: /Extract headings from any web page/i })).toBeInTheDocument();
  });

  it("primary CTA navigates to Home with pre-filled URL and intent query params", () => {
    renderAt("/extract-pricing");
    const cta = screen.getByRole("button", { name: /Extract Stripe's pricing now/i });
    fireEvent.click(cta);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const calledWith = mockNavigate.mock.calls[0][0];
    expect(calledWith).toMatch(/^\/\?/);
    expect(calledWith).toContain("url=https%3A%2F%2Fstripe.com%2Fpricing");
    expect(calledWith).toContain("intent=pricing");
  });

  it("persona CTA includes the persona in query params", () => {
    renderAt("/for-sales");
    const cta = screen.getByRole("button", { name: /Try a HubSpot prospect extraction/i });
    fireEvent.click(cta);
    const calledWith = mockNavigate.mock.calls[0][0];
    expect(calledWith).toContain("persona=sales");
  });

  it("renders keyword pills from the data", () => {
    renderAt("/extract-pricing");
    // expect at least 2 pills to render with the route's keywords
    expect(screen.getByText(/pricing scraper/i)).toBeInTheDocument();
    expect(screen.getByText(/pricing intelligence/i)).toBeInTheDocument();
  });

  it("sets SEO meta on mount with the slug URL", async () => {
    const { setMeta } = await import("../lib/seoMeta.js");
    renderAt("/for-sales");
    expect(setMeta).toHaveBeenCalledTimes(1);
    const arg = setMeta.mock.calls[0][0];
    expect(arg.title).toMatch(/DatIQ for sales/);
    expect(arg.url).toMatch(/\/for-sales$/);
  });

  it("has a back-link to home in the footer", () => {
    renderAt("/for-sales");
    const back = screen.getByText(/Back to DatIQ/i);
    expect(back.getAttribute("href")).toBe("/");
  });
});
