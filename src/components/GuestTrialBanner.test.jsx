import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import GuestTrialBanner, { GUEST_TRIAL_AUTO_DISMISS_MS, GUEST_LIMIT_AUTO_DISMISS_MS } from "./GuestTrialBanner.jsx";

const state = vi.hoisted(() => ({
  user: null,
  trial: { count: 1, batchCount: 0, SINGLE_LIMIT: 10, BATCH_LIMIT: 5 },
}));

vi.mock("./AuthProvider.jsx", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("./GuestTrialProvider.jsx", () => ({ useGuestTrial: () => state.trial }));
vi.mock("./OffersBanner.jsx", () => ({ default: () => <div data-testid="home-offer">Offer</div> }));
vi.mock("../lib/offersService.js", () => ({ getHeadlineOffer: () => ({ code: "LAUNCH20" }) }));

function renderBanner() {
  return render(<MemoryRouter initialEntries={["/"]}><GuestTrialBanner /></MemoryRouter>);
}

beforeEach(() => {
  state.user = null;
  state.trial = { count: 1, batchCount: 0, SINGLE_LIMIT: 10, BATCH_LIMIT: 5 };
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("GuestTrialBanner", () => {
  it("auto-dismisses the complete home trial-and-offer panel after six seconds", () => {
    renderBanner();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByTestId("home-offer")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(GUEST_TRIAL_AUTO_DISMISS_MS - 1); });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-offer")).not.toBeInTheDocument();
  });

  it("keeps a limit warning up for twelve seconds, then lets it go", () => {
    state.trial = { count: 10, batchCount: 1, SINGLE_LIMIT: 10, BATCH_LIMIT: 5 };
    renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent("Single-URL extraction limit reached");

    act(() => { vi.advanceTimersByTime(GUEST_TRIAL_AUTO_DISMISS_MS + 1); });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(GUEST_LIMIT_AUTO_DISMISS_MS - GUEST_TRIAL_AUTO_DISMISS_MS); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("brings a dismissed warning back when usage changes", () => {
    state.trial = { count: 10, batchCount: 1, SINGLE_LIMIT: 10, BATCH_LIMIT: 5 };
    const { rerender } = renderBanner();
    act(() => { vi.advanceTimersByTime(GUEST_LIMIT_AUTO_DISMISS_MS); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    state.trial = { count: 10, batchCount: 2, SINGLE_LIMIT: 10, BATCH_LIMIT: 5 };
    rerender(<MemoryRouter initialEntries={["/"]}><GuestTrialBanner /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("3 batch runs remaining");
  });
});
