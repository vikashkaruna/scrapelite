// HomeInlineProgress.test.jsx — inline progress card shown on the Home page
// while an extraction is in flight, replacing the full-screen LoadingScreen.
//
// Behaviour under test:
//   - Renders nothing when progress is null
//   - Shows the URL + four-step indicator while extracting
//   - Auto-advances the active step on a timer (so the user sees motion
//     even during a long network round-trip)
//   - Marks all steps as done + shows a Preview button on completion
//   - Shows an error state with a "Try again" CTA when extraction fails
//   - Preview button click fires the onPreview callback (and falls back to
//     navigating to /preview if no callback is provided)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeInlineProgress from "./HomeInlineProgress.jsx";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  vi.useRealTimers();
});

function renderWithRouter(ui) {
  return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
}

describe("HomeInlineProgress", () => {
  it("renders nothing when progress is null", () => {
    const { container } = renderWithRouter(<HomeInlineProgress progress={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the URL and all four steps while extracting", () => {
    const progress = { url: "https://example.com", step: 0, completed: false, error: null };
    renderWithRouter(<HomeInlineProgress progress={progress} />);
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("Fetching webpage")).toBeInTheDocument();
    expect(screen.getByText("Parsing structure")).toBeInTheDocument();
    expect(screen.getByText("Extracting links")).toBeInTheDocument();
    expect(screen.getByText("Summarizing with AI")).toBeInTheDocument();
    // The completed-state Preview button is NOT shown while extracting.
    expect(screen.queryByRole("button", { name: /^preview$/i })).toBeNull();
  });

  it("marks all steps as done and shows the Preview button on completion", () => {
    const progress = { url: "https://example.com", step: 3, completed: true, error: null };
    renderWithRouter(<HomeInlineProgress progress={progress} />);
    const previewBtn = screen.getByRole("button", { name: /preview/i });
    expect(previewBtn).toBeInTheDocument();
    // All four step labels are still in the document, now in the done state.
    expect(screen.getByText("Fetching webpage")).toBeInTheDocument();
    expect(screen.getByText(/Ready to preview/i)).toBeInTheDocument();
  });

  it("Preview button click fires the onPreview callback when provided", () => {
    const onPreview = vi.fn();
    const progress = { url: "https://example.com", step: 3, completed: true, error: null };
    renderWithRouter(<HomeInlineProgress progress={progress} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("shows an error state with a Try again button when extraction fails", () => {
    const progress = {
      url: "https://example.com",
      step: 2,
      completed: false,
      error: "Network unreachable",
    };
    const onRetry = vi.fn();
    renderWithRouter(<HomeInlineProgress progress={progress} onRetry={onRetry} />);
    expect(screen.getByText(/couldn't extract this page/i)).toBeInTheDocument();
    expect(screen.getByText("Network unreachable")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("auto-advances the active step on a timer during extraction", () => {
    vi.useFakeTimers();
    const progress = { url: "https://example.com", step: 0, completed: false, error: null };
    const { container } = renderWithRouter(<HomeInlineProgress progress={progress} />);

    // Initially only step 0 is "active".
    let activeSteps = container.querySelectorAll(".home-inline-progress-step.is-active");
    expect(activeSteps.length).toBe(1);
    expect(activeSteps[0].textContent).toMatch(/Fetching webpage/);

    // After 700ms the auto-stepper advances to step 1.
    act(() => { vi.advanceTimersByTime(750); });
    activeSteps = container.querySelectorAll(".home-inline-progress-step.is-active");
    expect(activeSteps.length).toBe(1);
    expect(activeSteps[0].textContent).toMatch(/Parsing structure/);

    // After 1400ms total it advances to step 2.
    act(() => { vi.advanceTimersByTime(700); });
    activeSteps = container.querySelectorAll(".home-inline-progress-step.is-active");
    expect(activeSteps.length).toBe(1);
    expect(activeSteps[0].textContent).toMatch(/Extracting links/);
  });
});
