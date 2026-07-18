// src/components/WatchlistCard.test.jsx — FC1 (WatchlistCard component).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WatchlistCard from "./WatchlistCard.jsx";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();
const ONE_HOUR_AGO = new Date(NOW - 60 * 60 * 1000).toISOString();
const ONE_DAY_AGO = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  try { localStorage.setItem("datiq.workspaceLastVisitedAt", new Date(NOW - 12 * 60 * 60 * 1000).toISOString()); } catch {}
});

function renderWatchlist(schedules) {
  return render(
    <MemoryRouter>
      <WatchlistCard schedules={schedules} />
    </MemoryRouter>,
  );
}

describe("WatchlistCard (FC1)", () => {
  it("renders nothing when there are no schedules", () => {
    const { container } = renderWatchlist([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders the title and the changed count", () => {
    renderWatchlist([
      {
        id: "a",
        label: "Stripe pricing",
        target: "https://stripe.com/pricing",
        type: "single",
        lastRunAt: ONE_HOUR_AGO,
        lastChangeAt: ONE_HOUR_AGO,
        lastStatus: "changed",
      },
    ]);
    expect(screen.getByText(/Monitored URLs/i)).toBeInTheDocument();
    expect(screen.getByText(/1 changed since your last visit/i)).toBeInTheDocument();
  });

  it("shows 'no changes' copy when nothing changed", () => {
    renderWatchlist([
      {
        id: "a",
        label: "Quiet monitor",
        target: "https://quiet.example.com",
        type: "single",
        lastRunAt: ONE_HOUR_AGO,
        lastStatus: "unchanged",
      },
    ]);
    expect(screen.getByText(/No changes since your last visit/i)).toBeInTheDocument();
  });

  it("shows the next-run ETA in the subtitle", () => {
    const { container } = renderWatchlist([
      {
        id: "a",
        label: "Soon",
        target: "https://soon.example.com",
        type: "single",
        lastRunAt: ONE_DAY_AGO,
        lastStatus: "unchanged",
        // 30 min from real-now (WatchlistCard uses Date.now() for the
        // formatNextRun formatter, not the test's NOW constant).
        nextRunAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    ]);
    expect(container.textContent).toMatch(/next check in 30m/);
  });

  it("renders a row per schedule with the delta label", () => {
    const schedules = [
      {
        id: "a",
        label: "Stripe pricing",
        target: "https://stripe.com/pricing",
        type: "single",
        lastRunAt: ONE_HOUR_AGO,
        lastChangeAt: ONE_HOUR_AGO,
        lastStatus: "changed",
      },
      {
        id: "b",
        label: "Quiet monitor",
        target: "https://quiet.example.com",
        type: "single",
        lastRunAt: ONE_HOUR_AGO,
        lastStatus: "unchanged",
      },
    ];
    renderWatchlist(schedules);
    expect(screen.getByText("Stripe pricing")).toBeInTheDocument();
    expect(screen.getByText("Quiet monitor")).toBeInTheDocument();
    // Delta labels
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  it("shows the host for single-URL targets and the count for batch targets", () => {
    const schedules = [
      {
        id: "a",
        label: "Single",
        target: "https://stripe.com/pricing",
        type: "single",
        lastRunAt: ONE_HOUR_AGO,
        lastStatus: "unchanged",
      },
      {
        id: "b",
        label: "Batch",
        target: ["https://a.com", "https://b.com", "https://c.com"],
        type: "batch",
        lastRunAt: ONE_HOUR_AGO,
        lastStatus: "unchanged",
      },
    ];
    const { container } = renderWatchlist(schedules);
    expect(container.textContent).toMatch(/stripe\.com/);
    expect(container.textContent).toMatch(/3 URLs/);
  });

  it("limits the visible list to 6 rows (top of summary)", () => {
    const schedules = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      label: `Sched ${i}`,
      target: `https://x${i}.com`,
      type: "single",
      lastRunAt: ONE_HOUR_AGO,
      lastStatus: "unchanged",
    }));
    renderWatchlist(schedules);
    expect(screen.getByText(/10 total/)).toBeInTheDocument();
    // Only first 6 rendered
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").length).toBe(6);
  });

  it("renders the 'All schedules' link to /schedules", () => {
    renderWatchlist([
      { id: "a", label: "X", target: "https://x.com", type: "single", lastRunAt: ONE_HOUR_AGO, lastStatus: "unchanged" },
    ]);
    const link = screen.getByRole("link", { name: /All schedules/i });
    expect(link.getAttribute("href")).toBe("/schedules");
  });
});
