// src/pages/Gallery.test.jsx — Q6 public gallery listing page tests.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Gallery from "./Gallery.jsx";
import { shareExtraction, _resetShareForTests } from "../lib/shareService.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetShareForTests();
});

function renderGallery() {
  return render(
    <MemoryRouter initialEntries={["/gallery"]}>
      <Routes>
        <Route path="/gallery" element={<Gallery />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sample = (id, title, url) => ({
  id, title, url,
  ai_summary: "A test summary.",
  intent: "summary",
  created_at: new Date().toISOString(),
});

describe("Q6 — /gallery public sample gallery", () => {
  it("renders the empty state when no extractions are shared", () => {
    renderGallery();
    expect(screen.getByText(/No shared reports yet/i)).toBeInTheDocument();
  });

  it("renders a card for every shared extraction", () => {
    shareExtraction(sample("ext_a", "A", "https://a.com"));
    shareExtraction(sample("ext_b", "B", "https://b.com"));
    shareExtraction(sample("ext_c", "C", "https://c.com"));
    renderGallery();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("links each card to its public /p/:slug route", () => {
    shareExtraction(sample("ext_link", "Linked", "https://linked.com"));
    renderGallery();
    const link = screen.getByRole("link", { name: /Linked/i });
    expect(link.getAttribute("href")).toMatch(/\/p\/[a-z0-9]{8}$/);
  });

  it("shows the intent tag on each card", () => {
    shareExtraction({ ...sample("ext_p", "P", "https://p.com"), intent: "pricing" });
    renderGallery();
    // The intent tag is rendered in lowercase via text-transform: capitalize
    expect(screen.getByText("pricing")).toBeInTheDocument();
  });
});
