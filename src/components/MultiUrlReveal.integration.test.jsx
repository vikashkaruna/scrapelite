// MultiUrlReveal.integration.test.jsx — DeepSeq QW#4 integration test.
// Verifies the "Add multiple URLs" reveal-textarea on Home shows/hides
// correctly, counts URLs as the user types, and routes to /batch on submit.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
vi.mock("./ExtractionProvider.jsx", () => ({
  useExtraction: () => ({ view: vi.fn(), extract: vi.fn() }),
  ExtractionProvider: ({ children }) => children,
}));
vi.mock("./Icon.jsx", () => ({
  default: ({ name, size }) => <span data-icon={name} data-size={size} />,
}));
vi.mock("../lib/statsService.js", () => ({
  getStats: () => Promise.resolve(null),
  fmtStat: (n) => String(n),
}));

import Home from "../pages/Home.jsx";

describe("DeepSeq QW#4 — Multi-URL reveal on Home", () => {
  beforeEach(() => localStorage.clear());

  it("does not show the textarea by default", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.queryByLabelText(/urls to extract, one per line/i)).toBeNull();
  });

  it("reveals the textarea when 'Add multiple URLs' is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    const trigger = screen.getByRole("button", { name: /add multiple urls/i });
    await user.click(trigger);
    expect(screen.getByLabelText(/urls to extract, one per line/i)).toBeInTheDocument();
  });

  it("Extract all button is disabled with 0-1 URLs", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: /add multiple urls/i }));

    const ta = screen.getByLabelText(/urls to extract, one per line/i);
    await user.type(ta, "https://a.com"); // 1 URL
    const go = screen.getByRole("button", { name: /extract all/i });
    expect(go).toBeDisabled();

    await user.type(ta, "\nhttps://b.com"); // 2 URLs
    expect(go).toBeEnabled();
  });

  it("shows the live URL count", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: /add multiple urls/i }));
    const ta = screen.getByLabelText(/urls to extract, one per line/i);
    await user.type(ta, "https://a.com\nhttps://b.com\nhttps://c.com");
    expect(screen.getByText(/3 urls detected/i)).toBeInTheDocument();
  });

  it("routes to /batch on submit with multiple URLs", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/batch" element={<div data-testid="batch-marker">batch</div>} />
        </Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: /add multiple urls/i }));
    const ta = screen.getByLabelText(/urls to extract, one per line/i);
    await user.type(ta, "https://a.com\nhttps://b.com");
    await user.click(screen.getByRole("button", { name: /extract all/i }));
    expect(await screen.findByTestId("batch-marker")).toBeInTheDocument();
  });

  it("Close button collapses the reveal", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: /add multiple urls/i }));
    const ta = screen.getByLabelText(/urls to extract, one per line/i);
    await user.type(ta, "https://a.com\nhttps://b.com");
    await user.click(screen.getByRole("button", { name: /close multi-url input/i }));
    expect(screen.queryByLabelText(/urls to extract, one per line/i)).toBeNull();
    // Reopen → textarea is empty (state was cleared on close)
    await user.click(screen.getByRole("button", { name: /add multiple urls/i }));
    expect(screen.getByLabelText(/urls to extract, one per line/i).value).toBe("");
  });
});
