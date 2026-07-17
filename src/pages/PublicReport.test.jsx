// src/pages/PublicReport.test.jsx — Q6 public report route tests.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PublicReport from "./PublicReport.jsx";
import { shareExtraction, _resetShareForTests } from "../lib/shareService.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetShareForTests();
});

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

describe("Q6 — /p/:slug public report", () => {
  it("renders a not-found state when the slug doesn't exist", () => {
    renderAt("nope-nope");
    expect(screen.getByText(/Report not found/i)).toBeInTheDocument();
    // Offers a link back to the gallery
    expect(screen.getByRole("link", { name: /public gallery/i })).toBeInTheDocument();
  });

  it("renders the shared extraction with title, summary, and extracted data", () => {
    const slug = shareExtraction(sample());
    renderAt(slug);
    // Title appears as the h1
    expect(screen.getByRole("heading", { name: "Stripe — Pricing" })).toBeInTheDocument();
    // Summary section
    expect(screen.getByText(/4 pricing tiers/)).toBeInTheDocument();
    // Extracted JSON section (look for the plan key)
    expect(screen.getByText(/"Starter"/)).toBeInTheDocument();
  });

  it("renders headings and links when present", () => {
    const slug = shareExtraction(sample());
    renderAt(slug);
    // H1 heading text appears
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    // Link text appears
    expect(screen.getByText("Sign up")).toBeInTheDocument();
  });

  it("shows a CTA back to DatIQ in the footer", () => {
    const slug = shareExtraction(sample());
    renderAt(slug);
    expect(screen.getByText(/Extract any page in seconds/i)).toBeInTheDocument();
  });
});
