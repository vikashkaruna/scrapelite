// Collections.integration.test.jsx — Groke QW#3 integration test.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../components/Toast.jsx", () => ({
  useToast: () => () => {},
  ToastProvider: ({ children }) => children,
}));
vi.mock("../components/ThemeProvider.jsx", () => ({
  useTheme: () => ({ theme: "light", setTheme: () => {} }),
  ThemeProvider: ({ children }) => children,
}));
vi.mock("../components/ExtractionProvider.jsx", () => ({
  useExtraction: () => ({ view: vi.fn() }),
  ExtractionProvider: ({ children }) => children,
}));
vi.mock("../components/Icon.jsx", () => ({
  default: ({ name, size }) => <span data-icon={name} data-size={size} />,
}));

import Collections from "./Collections.jsx";

const SEED_ITEMS = [
  { id: "x1", url: "https://stripe.com/pricing", page_title: "Stripe Pricing", collection: "Stripe", created_at: "2026-07-15" },
  { id: "x2", url: "https://stripe.com/docs",     page_title: "Stripe Docs",    collection: "Stripe", created_at: "2026-07-14" },
  { id: "x3", url: "https://linear.app",          page_title: "Linear",        collection: "Q2",      created_at: "2026-07-13" },
  { id: "x4", url: "https://example.com",         page_title: "Example",       created_at: "2026-07-12" },
];

describe("Groke QW#3 — /collections page", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("datiq.saved", JSON.stringify(SEED_ITEMS));
  });

  it("renders the page title and a sidebar with all collections + Untagged", async () => {
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes><Route path="/collections" element={<Collections />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: /your research, organized/i })).toBeInTheDocument();
    // Sidebar has both collections + Untagged
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(await screen.findByText("Q2")).toBeInTheDocument();
    expect(await screen.findByText("Untagged")).toBeInTheDocument();
  });

  it("shows the empty main state when no collection is selected", async () => {
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes><Route path="/collections" element={<Collections />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/pick a collection to view its extractions/i)).toBeInTheDocument();
  });

  it("clicking a sidebar collection lists its items in the main pane", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes><Route path="/collections" element={<Collections />} /></Routes>
      </MemoryRouter>
    );
    const stripeBtn = await screen.findByRole("button", { name: /stripe/i });
    await user.click(stripeBtn);
    expect(await screen.findByText("Stripe Pricing")).toBeInTheDocument();
    expect(await screen.findByText("Stripe Docs")).toBeInTheDocument();
    // Q2 item should NOT be in the list
    expect(screen.queryByText("Linear")).toBeNull();
  });

  it("clicking 'Untagged' lists items without a collection", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes><Route path="/collections" element={<Collections />} /></Routes>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole("button", { name: /untagged/i }));
    expect(await screen.findByText("Example")).toBeInTheDocument();
    expect(screen.queryByText("Stripe Pricing")).toBeNull();
  });

  it("collection counts match the seeded items", async () => {
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes><Route path="/collections" element={<Collections />} /></Routes>
      </MemoryRouter>
    );
    await screen.findByText("Stripe");
    // Stripe: 2, Q2: 1, Untagged: 1
    const stripeBtn = screen.getByRole("button", { name: /stripe/i });
    expect(stripeBtn).toHaveTextContent(/2/);
    const q2Btn = screen.getByRole("button", { name: /q2/i });
    expect(q2Btn).toHaveTextContent(/1/);
  });
});
