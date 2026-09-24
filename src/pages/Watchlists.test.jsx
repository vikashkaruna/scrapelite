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

// "Used by rules" reads the rules API; keep it quiet here.
vi.mock("../lib/rules/rulesClient.js", () => ({
  rulesForSource: vi.fn().mockResolvedValue([]),
  unlinkSource: vi.fn(),
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
      // Unlink is always explicit: a plain delete never silently unlinks rules.
      expect(watchlistApi.deleteWatchlist).toHaveBeenCalledWith("wl_1", { unlink: false });
    });
  });

  // 0085: a watchlist that rules still listen to is refused with 409 in_use.
  // The page must say which rules, and offer "Unlink and delete" — never a
  // bare error toast, and never an unlink the user did not ask for.
  it("explains a delete refused because rules use the watchlist, then unlinks on request", async () => {
    const inUse = Object.assign(new Error("in use"), { status: 409, code: "in_use", rules: [{ id: "r1", name: "Price alert" }] });
    watchlistApi.deleteWatchlist.mockRejectedValueOnce(inUse).mockResolvedValueOnce({ ok: true });

    render(
      <MemoryRouter>
        <Watchlists />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Core Competitors")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Delete watchlist"));
    fireEvent.click(screen.getByRole("button", { name: "Delete Watchlist" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Rules still use this watchlist");
    expect(dialog).toHaveTextContent("Price alert");
    expect(watchlistApi.deleteWatchlist).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Unlink and delete" }));
    await waitFor(() => {
      expect(watchlistApi.deleteWatchlist).toHaveBeenLastCalledWith("wl_1", { unlink: true });
    });
  });
});
