// AuditHeader.test.jsx — the report has to say what page it is about.
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────
// Opening a historical audit produced a wall of scores with no subject. The
// composer above shows the URL you are ABOUT to audit, not the one you are
// looking at, so a report reached from History was anonymous — comparing two of
// them meant reading the browser's address bar.
//
// ── AND THE SUMMARY IS OPTIONAL ────────────────────────────────────────────
// It comes from a model. If that fails, the identity block must still render:
// a report with no summary is a report; a report that failed to load is not.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AuditHeader from "./AuditHeader.jsx";

const summary = vi.fn();
vi.mock("../../lib/discoverability/discoverabilityClient.js", () => ({
  discoverability: { summary: (...a) => summary(...a) },
}));

const AUDIT = {
  auditId: "aud_1",
  target: {
    url: "https://example.com/pricing/enterprise",
    page_type: "pricing", page_type_label: "Pricing page",
    device_profile: "desktop", audit_profile: "balanced",
  },
  audit: { created_at: "2026-08-27T09:30:00.000Z" },
  finalScore: 61.2,
};

beforeEach(() => { summary.mockResolvedValue({ summary: null, unavailable: true }); });

describe("AuditHeader — identity", () => {
  it("renders nothing without an audit", () => {
    const { container } = render(<AuditHeader audit={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the FULL url, not just the host", async () => {
    // Two audits of the same site are the commonest pair to compare, and the
    // path is the only thing that tells them apart.
    render(<AuditHeader audit={AUDIT} />);
    const link = await screen.findByRole("link", { name: /example\.com\/pricing\/enterprise/ });
    expect(link).toHaveAttribute("href", AUDIT.target.url);
  });

  it("does not pass link equity to an audited page", () => {
    // We audit pages we do not necessarily endorse, including competitors'.
    render(<AuditHeader audit={AUDIT} />);
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link.getAttribute("rel")).toMatch(/nofollow/);
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("states when it ran, and under what settings", () => {
    render(<AuditHeader audit={AUDIT} />);
    const facts = document.querySelector(".dsc-audit-header-facts").textContent;
    expect(facts).toMatch(/balanced profile/i);
    expect(facts).toMatch(/desktop/i);
    expect(facts).toMatch(/Pricing page/i);
    expect(facts).toMatch(/2026/);
  });
});

describe("AuditHeader — the summary", () => {
  it("renders a summary the audit already carries, without asking again", async () => {
    // A stored summary means two readers of the same audit see the same words,
    // and a refresh does not spend another model call.
    render(<AuditHeader audit={{ ...AUDIT, summary: "This pricing page scores 61." }} />);
    expect(screen.getByText(/This pricing page scores 61\./)).toBeInTheDocument();
    await waitFor(() => expect(summary).not.toHaveBeenCalled());
  });

  it("fetches one when the audit has none", async () => {
    summary.mockResolvedValue({ summary: "Generated summary of the audit." });
    render(<AuditHeader audit={AUDIT} />);
    expect(await screen.findByText(/Generated summary of the audit\./)).toBeInTheDocument();
    expect(summary).toHaveBeenCalledWith("aud_1");
  });

  it("says the summary is unavailable AND that the findings are not", async () => {
    render(<AuditHeader audit={AUDIT} />);
    expect(await screen.findByText(/not available for this audit/i)).toBeInTheDocument();
    expect(screen.getByText(/findings below are complete/i)).toBeInTheDocument();
  });

  it("survives the request throwing", async () => {
    // A failed summary is not a failed report.
    summary.mockRejectedValue(new Error("502"));
    render(<AuditHeader audit={AUDIT} />);
    expect(await screen.findByText(/not available for this audit/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example\.com/ })).toBeInTheDocument();
  });

  it("re-asks when a different audit is opened", async () => {
    const { rerender } = render(<AuditHeader audit={AUDIT} />);
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    rerender(<AuditHeader audit={{ ...AUDIT, auditId: "aud_2" }} />);
    await waitFor(() => expect(summary).toHaveBeenCalledWith("aud_2"));
  });
});
