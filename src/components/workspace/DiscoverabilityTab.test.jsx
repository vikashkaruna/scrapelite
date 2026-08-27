// DiscoverabilityTab.test.jsx — the workspace's portfolio view of its audits.
//
// /discoverability is a working surface: run one audit, read one report. This
// answers the portfolio questions — which pages are worst, what are we
// monitoring — which is what somebody opening a workspace is asking.
//
// It RUNS nothing. Every action is a link into a screen that owns the flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DiscoverabilityTab from "./DiscoverabilityTab.jsx";

const listAudits = vi.fn();
const listSchedules = vi.fn();
vi.mock("../../lib/discoverability/discoverabilityClient.js", () => ({
  discoverability: {
    listAudits: (...a) => listAudits(...a),
    listSchedules: (...a) => listSchedules(...a),
  },
}));

const audit = (id, url, score, extra = {}) => ({
  id, target_url: url, status: "completed", created_at: "2026-08-27T00:00:00Z",
  audit_results: { final_score: score, coverage: 90, critical_count: 0, ...extra },
});

const draw = () => render(<MemoryRouter><DiscoverabilityTab /></MemoryRouter>);

beforeEach(() => {
  listAudits.mockResolvedValue({ audits: [] });
  listSchedules.mockResolvedValue({ schedules: [] });
});

describe("DiscoverabilityTab — empty", () => {
  it("invites a first audit rather than showing empty tables", async () => {
    draw();
    expect(await screen.findByText(/No audits yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Run an audit/i })).toHaveAttribute("href", "/discoverability");
  });
});

describe("DiscoverabilityTab — portfolio", () => {
  it("lists the WORST pages first", async () => {
    // A portfolio view exists to surface what needs attention. Sorting by date
    // would bury the worst page under whatever was audited most recently.
    listAudits.mockResolvedValue({ audits: [
      audit("a1", "https://example.com/good", 91),
      audit("a2", "https://example.com/bad", 22),
      audit("a3", "https://example.com/mid", 58),
    ]});
    draw();
    await waitFor(() => expect(screen.getAllByRole("link", { name: /example\.com/ }).length).toBe(3));
    const rows = screen.getAllByRole("link", { name: /example\.com/ });
    expect(rows[0].textContent).toMatch(/\/bad/);
    expect(rows[2].textContent).toMatch(/\/good/);
  });

  it("links each row to that audit's own report", async () => {
    listAudits.mockResolvedValue({ audits: [audit("a1", "https://example.com/x", 40)] });
    draw();
    const link = await screen.findByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("href", "/discoverability?audit=a1");
  });

  it("shows coverage beside the score", async () => {
    // A 92 built on 40% of the intended evidence is not a 92, and a portfolio
    // table is exactly where that gets forgotten.
    listAudits.mockResolvedValue({ audits: [audit("a1", "https://example.com/x", 92, { coverage: 41 })] });
    draw();
    expect(await screen.findByText(/41% evidence/)).toBeInTheDocument();
  });

  it("omits an audit with no score rather than showing it as zero", async () => {
    // `unknown` is never `0`. A failed or running audit has no score, and
    // rendering one as 0 would put it top of a worst-first list.
    listAudits.mockResolvedValue({ audits: [
      audit("a1", "https://example.com/ok", 70),
      { id: "a2", target_url: "https://example.com/failed", status: "failed", created_at: "2026-08-27T00:00:00Z" },
    ]});
    draw();
    await waitFor(() => expect(screen.getAllByRole("link", { name: /example\.com/ }).length).toBe(1));
    expect(screen.queryByText(/\/failed/)).toBeNull();
  });

  it("reads a to-one embed returned as a 1-element array", async () => {
    // PostgREST returns an embedded to-one row either way.
    listAudits.mockResolvedValue({ audits: [
      { id: "a1", target_url: "https://example.com/x", status: "completed", created_at: "2026-08-27T00:00:00Z",
        audit_results: [{ final_score: 55, coverage: 80, critical_count: 2 }] },
    ]});
    draw();
    expect(await screen.findByText("55")).toBeInTheDocument();
    expect(screen.getByText(/2 critical/)).toBeInTheDocument();
  });
});

describe("DiscoverabilityTab — monitors", () => {
  it("offers a way to start monitoring when nothing is", async () => {
    listAudits.mockResolvedValue({ audits: [audit("a1", "https://example.com/x", 60)] });
    draw();
    expect(await screen.findByRole("link", { name: /Set up a monitor/i })).toHaveAttribute("href", "/schedules");
  });

  it("distinguishes a platform pause from the user's own", async () => {
    // "Paused" and "Paused by DatIQ" are different facts with different
    // remedies, and only one of them the user can lift.
    listSchedules.mockResolvedValue({ schedules: [
      { id: "m1", name: "Pricing watch", cadence: "weekly", audit_profile: "seo", device_profile: "mobile",
        status: "active", system_paused: true, audit_targets: { canonical_url: "https://example.com/pricing" } },
      { id: "m2", name: "Blog watch", cadence: "daily", audit_profile: "aeo", device_profile: "mobile",
        status: "paused", system_paused: false, audit_targets: { canonical_url: "https://example.com/blog" } },
    ]});
    draw();
    expect(await screen.findByText("Paused by DatIQ")).toBeInTheDocument();
    expect(screen.getByText(/^Paused$/)).toBeInTheDocument();
  });

  it("survives both requests failing", async () => {
    // A workspace tab must not be the thing that breaks because one module is
    // unavailable.
    listAudits.mockRejectedValue(new Error("503"));
    listSchedules.mockRejectedValue(new Error("503"));
    draw();
    expect(await screen.findByText(/No audits yet/i)).toBeInTheDocument();
  });
});
