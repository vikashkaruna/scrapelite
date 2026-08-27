// DiscoverabilityStats.test.jsx — the discoverability half of Plan & usage.
//
// Audits have their OWN monthly budget rather than debiting extraction credits,
// so the number shown here has to agree with the gate that actually refuses
// people. The two rules that make it agree:
//   * a FAILED audit is not charged, so it must not be counted
//   * only THIS month counts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DiscoverabilityStats from "./DiscoverabilityStats.jsx";

const listAudits = vi.fn();
const listSchedules = vi.fn();
vi.mock("../lib/discoverability/discoverabilityClient.js", () => ({
  discoverability: {
    listAudits: (...a) => listAudits(...a),
    listSchedules: (...a) => listSchedules(...a),
  },
}));

const thisMonth = new Date().toISOString().slice(0, 7);
const lastMonth = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

const audit = (id, url, score, status = "completed", month = thisMonth) => ({
  id, target_url: url, status, created_at: `${month}-15T00:00:00Z`,
  audit_results: score === null ? null : { final_score: score, coverage: 90 },
});

beforeEach(() => {
  listAudits.mockResolvedValue({ audits: [] });
  listSchedules.mockResolvedValue({ schedules: [] });
});

describe("DiscoverabilityStats — the quota number", () => {
  it("counts only this month", async () => {
    listAudits.mockResolvedValue({ audits: [
      audit("a1", "https://a.com", 50),
      audit("a2", "https://b.com", 60, "completed", lastMonth),
    ]});
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Audits this month")).toBeInTheDocument());
    const row = screen.getByText("Audits this month").closest(".astat-row");
    expect(row.textContent).toMatch(/1$/);
  });

  it("excludes FAILED audits — they are not charged", async () => {
    // Must match the server's own rule, or the page tells somebody they have
    // less quota than the gate will actually give them.
    listAudits.mockResolvedValue({ audits: [
      audit("a1", "https://a.com", 50),
      audit("a2", "https://b.com", null, "failed"),
    ]});
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Audits this month")).toBeInTheDocument());
    expect(screen.getByText("Audits this month").closest(".astat-row").textContent).toMatch(/1$/);
  });

  it("shows what is left", async () => {
    listAudits.mockResolvedValue({ audits: [audit("a1", "https://a.com", 50)] });
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Remaining this month")).toBeInTheDocument());
    expect(screen.getByText("Remaining this month").closest(".astat-row").textContent).toMatch(/9$/);
  });

  it("offers an upgrade when the plan has no audit allowance", async () => {
    render(<DiscoverabilityStats auditLimit={0} />);
    expect(await screen.findByRole("link", { name: /Upgrade to unlock/i })).toHaveAttribute("href", "/pricing");
  });
});

describe("DiscoverabilityStats — the rest", () => {
  it("counts DISTINCT pages, not audits", async () => {
    // Re-auditing one page four times is one page, and conflating the two
    // would make the number grow every time somebody checked their work.
    listAudits.mockResolvedValue({ audits: [
      audit("a1", "https://a.com/x", 50),
      audit("a2", "https://a.com/x", 55),
      audit("a3", "https://b.com/y", 60),
    ]});
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Pages audited")).toBeInTheDocument());
    expect(screen.getByText("Pages audited").closest(".astat-row").textContent).toMatch(/2$/);
  });

  it("says 'not measured yet' rather than 0 with no scores", async () => {
    // `unknown` is never `0`. A 0 here reads as a very bad average score.
    render(<DiscoverabilityStats auditLimit={10} />);
    expect(await screen.findByText(/not measured yet/i)).toBeInTheDocument();
  });

  it("counts only monitors that are actually running", async () => {
    listSchedules.mockResolvedValue({ schedules: [
      { id: "m1", status: "active", system_paused: false },
      { id: "m2", status: "paused", system_paused: false },
      { id: "m3", status: "active", system_paused: true },
    ]});
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Active monitors")).toBeInTheDocument());
    expect(screen.getByText("Active monitors").closest(".astat-row").textContent).toMatch(/1$/);
  });

  it("renders even when both requests fail", async () => {
    listAudits.mockRejectedValue(new Error("503"));
    listSchedules.mockRejectedValue(new Error("503"));
    render(<DiscoverabilityStats auditLimit={10} />);
    await waitFor(() => expect(screen.getByText("Audits this month")).toBeInTheDocument());
  });
});
