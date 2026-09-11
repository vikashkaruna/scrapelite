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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// ── W2: the commission, and why this lens ──────────────────────────────────

describe("AuditHeader — what this audit was commissioned for", () => {
  const facts = () => document.querySelector(".dsc-audit-header-facts").textContent;

  it("names the goal the audit was run for", () => {
    render(<AuditHeader audit={{
      ...AUDIT,
      intake: { audit_type: "url", primary_goal: "local_discovery", target_geography: null, competitor_urls: [] },
    }} />);
    expect(facts()).toMatch(/for Local discovery/i);
  });

  it("says a lens was READ FROM THE PAGE rather than presenting it as a choice", () => {
    // A reader who disagrees with the lens needs to know whether they chose it
    // or whether we guessed it from their markup. Those are different claims,
    // and only one of them is ours to defend.
    render(<AuditHeader audit={{
      ...AUDIT,
      target: { ...AUDIT.target, audit_profile: "ecommerce", audit_profile_source: "inferred" },
    }} />);
    expect(facts()).toMatch(/E-commerce profile \(read from the page\)/i);
  });

  it("says a lens came from the goal", () => {
    render(<AuditHeader audit={{
      ...AUDIT,
      target: { ...AUDIT.target, audit_profile: "local", audit_profile_source: "goal" },
    }} />);
    expect(facts()).toMatch(/Local profile \(from your goal\)/i);
  });

  it("adds no gloss to a lens the reader chose", () => {
    render(<AuditHeader audit={{
      ...AUDIT,
      target: { ...AUDIT.target, audit_profile: "seo", audit_profile_source: "explicit" },
    }} />);
    expect(facts()).toMatch(/SEO-heavy profile/i);
    expect(facts()).not.toMatch(/\(/);
  });

  it("shows nothing for an audit that predates the goal question", () => {
    // Migration 0049 leaves primary_goal NULL on every historical row, and a
    // placeholder here would claim an intent nobody stated.
    render(<AuditHeader audit={AUDIT} />);
    expect(facts()).not.toMatch(/\bfor\b/i);
  });
});


// ── §7.12 · the two header gaps the PRD wireframe names ────────────────────

describe("the baseline delta", () => {
  const base = { target: { canonical_url: "https://x.com/a" }, intake: {} };

  it("shows the movement against the baseline", () => {
    render(<AuditHeader audit={base} diff={{ frameworks: { overall: { change: 4.2, comparable: true } } }} />);
    expect(screen.getByText(/\+4\.2 vs baseline/)).toBeTruthy();
  });

  it("calls a sub-noise move no change rather than dressing it as progress", () => {
    render(<AuditHeader audit={base} diff={{ frameworks: { overall: { change: 0.2, comparable: true } } }} />);
    expect(screen.getByText(/no change/)).toBeTruthy();
  });

  it("🔴 says 'not comparable' rather than going blank", () => {
    // A missing delta with no explanation reads as "nothing changed", and a
    // headline that quietly mixed two scoring models would be the single
    // most-screenshotted wrong number in the product.
    render(<AuditHeader audit={base} diff={{ comparable: false, reason: "baseline was scored on v2" }} />);
    expect(screen.getByText(/not comparable to the baseline/i)).toBeTruthy();
  });

  it("shows nothing at all when there is no baseline", () => {
    render(<AuditHeader audit={base} />);
    expect(screen.queryByText(/vs baseline/)).toBeNull();
  });
});

describe("the framework lens", () => {
  const base = { target: { canonical_url: "https://x.com/a" }, intake: {} };

  it("is absent when the page cannot act on it", () => {
    render(<AuditHeader audit={base} />);
    expect(screen.queryByLabelText(/Read as/i)).toBeNull();
  });

  it("⚠️ says plainly that switching does not re-run anything", () => {
    // All four framework views are always computed; the profile only decides
    // which leads. Switching re-frames a finished report and costs no audit.
    render(<AuditHeader audit={base} onFrameworkChange={() => {}} />);
    expect(screen.getByText(/does not re-run the audit/i)).toBeTruthy();
  });

  it("hands the chosen lens back to the page", () => {
    const onFrameworkChange = vi.fn();
    render(<AuditHeader audit={base} framework="overall" onFrameworkChange={onFrameworkChange} />);
    fireEvent.change(screen.getByLabelText(/Read as/i), { target: { value: "aeo" } });
    expect(onFrameworkChange).toHaveBeenCalledWith("aeo");
  });
});
