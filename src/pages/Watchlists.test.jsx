import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Watchlists from "./Watchlists.jsx";
import * as watchlistApi from "../lib/watchlist/watchlistClient.js";

vi.mock("../components/AuthProvider.jsx", () => ({
  useAuth: () => ({
    user: { id: "user_test_123", email: "tester@datiq.app" },
    authLoading: false,
  }),
}));

vi.mock("../components/Toast.jsx", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("../lib/watchlist/watchlistClient.js", () => ({
  listWatchlists: vi.fn(),
  getWatchlist: vi.fn(),
  createWatchlist: vi.fn(),
  updateWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  recordChange: vi.fn(),
  submitFeedback: vi.fn(),
  runNow: vi.fn(),
}));

describe("Watchlists Page", () => {
  const mockWatchlists = [
    {
      id: "wl_1",
      name: "Core Competitors",
      description: "Tracking main rival brands",
      cadence: "daily",
      status: "active",
      targets: [{ id: "t_1", domain: "rival-corp.com" }],
      target_count: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    watchlistApi.listWatchlists.mockResolvedValue({ ok: true, watchlists: mockWatchlists });
    watchlistApi.getWatchlist.mockResolvedValue({
      ok: true,
      watchlist: {
        ...mockWatchlists[0],
        changes: [],
      },
    });
  });

  it("renders the page and displays referenced workflows badge", async () => {
    render(
      <MemoryRouter>
        <Watchlists />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Core Competitors")).toBeInTheDocument();
    });

    expect(screen.getByText("Referenced in Workflows")).toBeInTheDocument();
  });

  it("opens edit modal and updates watchlist", async () => {
    watchlistApi.updateWatchlist.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <Watchlists />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Core Competitors")).toBeInTheDocument();
    });

    const editBtn = screen.getByTitle("Edit watchlist");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit Competitor Watchlist")).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue("Core Competitors");
    fireEvent.change(nameInput, { target: { value: "Updated Competitors" } });

    const saveBtn = screen.getByRole("button", { name: "Save Changes" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(watchlistApi.updateWatchlist).toHaveBeenCalledWith(
        expect.objectContaining({
          watchlistId: "wl_1",
          name: "Updated Competitors",
        })
      );
    });
  });

  it("opens delete modal with audit trail preservation notice", async () => {
    watchlistApi.deleteWatchlist.mockResolvedValue({ ok: true, archived: true });

    render(
      <MemoryRouter>
        <Watchlists />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Core Competitors")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle("Delete watchlist");
    fireEvent.click(deleteBtn);

    expect(screen.getByRole("heading", { name: "Delete Watchlist" })).toBeInTheDocument();
    expect(screen.getByText(/Audit Trail Preservation:/)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Delete Watchlist" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(watchlistApi.deleteWatchlist).toHaveBeenCalledWith("wl_1");
    });
  });
});
