// src/components/TryExampleDemo.test.jsx — Q1 (alt) animated demo tests.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TryExampleDemo from "./TryExampleDemo.jsx";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Q1 (alt) — TryExampleDemo: animated walkthrough", () => {
  it("renders the 5 demo steps as chips", () => {
    render(<TryExampleDemo />);
    expect(screen.getByText("Type a URL")).toBeInTheDocument();
    expect(screen.getByText("Pick what to extract")).toBeInTheDocument();
    expect(screen.getByText("AI runs the extraction")).toBeInTheDocument();
    expect(screen.getByText("Read the AI summary")).toBeInTheDocument();
    expect(screen.getByText("Browse headings + links")).toBeInTheDocument();
  });

  it("starts with step 1 active (Type a URL)", () => {
    render(<TryExampleDemo />);
    const chips = document.querySelectorAll(".try-demo-chip");
    expect(chips[0]).toHaveClass("active");
  });

  it("the Pause button toggles between 'Pause' and 'Resume'", () => {
    render(<TryExampleDemo />);
    const btn = screen.getByRole("button", { name: /Pause/i });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Resume/i })).toBeInTheDocument();
  });

  it("the Replay button resets all step state", () => {
    render(<TryExampleDemo />);
    // Advance through all steps
    act(() => { vi.advanceTimersByTime(20000); });
    fireEvent.click(screen.getByRole("button", { name: /Replay/i }));
    const chips = document.querySelectorAll(".try-demo-chip");
    expect(chips[0]).toHaveClass("active");
  });

  it("uses real timer cadence when not in reduced-motion mode", () => {
    // Match the default branch: reduced motion off, 28ms per char.
    render(<TryExampleDemo />);
    act(() => { vi.advanceTimersByTime(100); });
    // No assertion on a specific DOM state — just that no errors fire.
    expect(screen.getByText("Type a URL")).toBeInTheDocument();
  });

  it("marks itself seen once the sequence completes", () => {
    render(<TryExampleDemo />);
    // Advance in small increments — each step schedules its next timer only
    // after the previous one's callback runs, so a single large jump can
    // outrun timers that haven't been scheduled yet.
    for (let i = 0; i < 60; i++) {
      act(() => { vi.advanceTimersByTime(500); });
    }
    expect(screen.getByText(/that's it — your turn/i)).toBeInTheDocument();
    expect(localStorage.getItem("datiq.tryDemoSeen")).toBe("1");
  });
});

describe("first-visit-only auto-play gating", () => {
  it("does not re-animate on a repeat visit — renders the finished state immediately", () => {
    localStorage.setItem("datiq.tryDemoSeen", "1");
    render(<TryExampleDemo />);
    // Every step chip should already read "done", with none "active" —
    // the opposite of a fresh, animating first visit.
    const chips = document.querySelectorAll(".try-demo-chip");
    expect(chips.length).toBe(5);
    chips.forEach((chip) => {
      expect(chip).toHaveClass("done");
      expect(chip).not.toHaveClass("active");
    });
    expect(screen.getByText(/that's it — your turn/i)).toBeInTheDocument();
  });

  it("Replay still plays the animation again on a repeat visit", () => {
    localStorage.setItem("datiq.tryDemoSeen", "1");
    render(<TryExampleDemo />);
    fireEvent.click(screen.getByRole("button", { name: /Replay/i }));
    const chips = document.querySelectorAll(".try-demo-chip");
    expect(chips[0]).toHaveClass("active");
    expect(chips[0]).not.toHaveClass("done");
  });

  it("animates normally on a genuine first visit (nothing marked seen yet)", () => {
    render(<TryExampleDemo />);
    const chips = document.querySelectorAll(".try-demo-chip");
    expect(chips[0]).toHaveClass("active");
    expect(chips[0]).not.toHaveClass("done");
  });
});
