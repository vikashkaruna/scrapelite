// src/components/OnboardingTour.test.jsx — Q4 tour overlay tests.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import * as tourLib from "../lib/onboardingTour.js";
import OnboardingTour from "./OnboardingTour.jsx";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  tourLib.resetTour();
});

describe("Q4 — OnboardingTour: overlay UI", () => {
  it("does not render when no forceOpen + tour already completed", () => {
    tourLib.markCompleted();
    const { container } = render(<OnboardingTour />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the first step when forceOpen=true", () => {
    render(<OnboardingTour forceOpen />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Welcome to DatIQ/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument();
  });

  it("does not auto-start when the host route is not enabled", () => {
    render(<OnboardingTour enabled={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries a missing target until the page section is mounted", async () => {
    render(<OnboardingTour forceOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));

    // Simulate Home content arriving after the tour shell mounted.
    const target = document.createElement("div");
    target.className = "hero-composer";
    document.body.appendChild(target);
    await waitFor(() => expect(document.querySelector(".tour-spotlight")).toBeTruthy());
    target.remove();
  });

  it("Next advances to the next step", () => {
    render(<OnboardingTour forceOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    expect(screen.getByText(/Step 2 of/)).toBeInTheDocument();
  });

  it("Back is hidden on the first step and shown on later steps", () => {
    render(<OnboardingTour forceOpen />);
    expect(screen.queryByRole("button", { name: /^Back/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    expect(screen.getByRole("button", { name: /^Back/ })).toBeInTheDocument();
  });

  it("Skip tour closes the overlay and persists skipped=true", () => {
    render(<OnboardingTour forceOpen />);
    fireEvent.click(screen.getByRole("button", { name: /Skip tour/i }));
    expect(tourLib.isTourSkipped()).toBe(true);
  });

  it("the last step's button label is 'Finish'", () => {
    render(<OnboardingTour forceOpen />);
    // 7 steps now (added the 'modes' step)
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    }
    expect(screen.getByText(/Step 7 of/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finish/i })).toBeInTheDocument();
  });

  it("Finish marks the tour as completed", () => {
    render(<OnboardingTour forceOpen />);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
    expect(tourLib.isTourCompleted()).toBe(true);
  });

  it("the modes step enumerates the 5 quick actions and 6 outcome tiles", () => {
    render(<OnboardingTour forceOpen />);
    // Step 1 -> 2 -> 3 -> 4 (modes)
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    expect(screen.getByText(/12 extraction modes/i)).toBeInTheDocument();
    expect(screen.getByText(/Outcome tiles \(6\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Quick actions \(5\)/i)).toBeInTheDocument();
  });

  it("onClose is called when the tour is closed", () => {
    const onClose = vi.fn();
    render(<OnboardingTour forceOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Skip tour/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
