// src/pages/Gallery.test.jsx — Q8 (public sample gallery) listing page tests.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("Q8 — /gallery public sample gallery", () => {
  it("renders the empty state when no extractions are shared", async () => {
    renderGallery();
    expect(await screen.findByText(/No shared reports yet/i)).toBeInTheDocument();
  });

  it("renders a card for every shared extraction", async () => {
    await shareExtraction(sample("ext_a", "A", "https://a.com"));
    await shareExtraction(sample("ext_b", "B", "https://b.com"));
    await shareExtraction(sample("ext_c", "C", "https://c.com"));
    renderGallery();
    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("links each card to its public /p/:slug route", async () => {
    await shareExtraction(sample("ext_link", "Linked", "https://linked.com"));
    renderGallery();
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Linked/i });
      expect(link.getAttribute("href")).toMatch(/\/p\/[a-z0-9]{8}$/);
    });
  });

  it("shows the intent tag on each card", async () => {
    await shareExtraction({ ...sample("ext_p", "P", "https://p.com"), intent: "pricing" });
    renderGallery();
    await waitFor(() => {
      // The intent tag is rendered in lowercase via text-transform: capitalize
      expect(screen.getByText("pricing")).toBeInTheDocument();
    });
  });
});
