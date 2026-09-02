// Report.jsx — the properties a shared report page must never get wrong.
//
// The robots tests exist because of a real bug found in a browser during
// Phase 2: the component APPENDED a <meta name="robots"> instead of
// overriding the site-wide one from index.html, leaving TWO tags in the head
// with the permissive `index, follow` FIRST. A private-link report was
// therefore served with an indexable directive ahead of its noindex.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";

const readReport = vi.fn();
vi.mock("../lib/reports/reportsClient.js", () => ({
  readReport: (...a) => readReport(...a),
  reportUrl: (s) => `https://datiq.app/r/${s}`,
}));

import Report from "./Report.jsx";

function renderAt(slug = "abc12345") {
  return render(
    <MemoryRouter initialEntries={[`/r/${slug}`]}>
      <Routes><Route path="/r/:slug" element={<Report />} /></Routes>
    </MemoryRouter>,
  );
}

const robotsTags = () =>
  [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.content);

beforeEach(() => {
  readReport.mockReset();
  document.head.innerHTML = "";
  // Reproduce what index.html actually ships site-wide.
  const m = document.createElement("meta");
  m.setAttribute("name", "robots");
  m.setAttribute("content", "index, follow, max-snippet:-1");
  document.head.appendChild(m);
});
afterEach(() => { document.head.innerHTML = ""; });

const REPORT = {
  id: "r1", slug: "abc12345", title: "Stripe — Account Brief",
  template_key: "account_brief", created_at: "2026-09-02T08:00:00Z",
  data: {
    summary: "Stripe sells payment infrastructure.",
    output: { target: "https://stripe.com", fields: { pricing_model: "usage-based" } },
    sources: [{ url: "https://stripe.com", fetched_at: "2026-09-02T08:00:00Z" }],
  },
};

describe("Report — indexability", () => {
  it("leaves exactly ONE robots tag, and it is noindex, for a link report", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link" }, indexable: false });
    renderAt();
    await screen.findByText(/Stripe — Account Brief/);
    await waitFor(() => {
      const tags = robotsTags();
      // Both halves matter: two tags is the bug, and the survivor must be the
      // restrictive one.
      expect(tags).toHaveLength(1);
      expect(tags[0]).toMatch(/noindex/);
      // Must not START with a bare `index` directive — that is the site-wide
      // tag surviving. (`noindex` legitimately contains the substring.)
      expect(tags[0]).not.toMatch(/^index[,\s]/);
    });
  });

  it("marks a public report indexable", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "public" }, indexable: true });
    renderAt();
    await screen.findByText(/Stripe — Account Brief/);
    await waitFor(() => {
      const tags = robotsTags();
      expect(tags).toHaveLength(1);
      expect(tags[0]).toMatch(/^index, follow/);
    });
  });

  it("restores the site default when navigating away, so the SPA is not left noindexed", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link" }, indexable: false });
    const { unmount } = renderAt();
    await screen.findByText(/Stripe — Account Brief/);
    await waitFor(() => expect(robotsTags()[0]).toMatch(/noindex/));
    unmount();
    await waitFor(() => {
      expect(robotsTags()).toHaveLength(1);
      expect(robotsTags()[0]).toMatch(/^index, follow/);
    });
  });
});

describe("Report — content and provenance", () => {
  it("labels the AI summary as interpretation, not as a quotation", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link" }, indexable: false });
    renderAt();
    expect(await screen.findByText(/Written by AI from the extracted facts below/i)).toBeInTheDocument();
  });

  it("shows the source URL and when it was read", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link" }, indexable: false });
    renderAt();
    await screen.findByText(/Sources/);
    expect(screen.getAllByRole("link", { name: /stripe\.com/ }).length).toBeGreaterThan(0);
  });

  it("offers the duplicate CTA — that link IS the acquisition loop", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link" }, indexable: false });
    renderAt();
    const cta = await screen.findByText(/Run this on another company/i);
    expect(cta.closest("a")).toHaveAttribute("href", "/templates?key=account_brief");
  });

  it("shows DatIQ attribution when the report carries no paid branding", async () => {
    readReport.mockResolvedValue({ report: { ...REPORT, visibility: "link", branding: {} }, indexable: false });
    renderAt();
    expect(await screen.findByText(/Made with/i)).toBeInTheDocument();
  });

  it("drops the attribution when a paid brand kit is present", async () => {
    readReport.mockResolvedValue({
      report: { ...REPORT, visibility: "link", branding: { companyName: "Acme" } }, indexable: false });
    renderAt();
    await screen.findByText(/Stripe — Account Brief/);
    expect(screen.queryByText(/Made with/i)).toBeNull();
  });
});

describe("Report — denials read as the reason, not as a crash", () => {
  it.each([
    ["revoked", /revoked/i],
    ["expired", /expired/i],
    ["private", /private/i],
    ["not_granted", /has not been given access/i],
    ["not_found", /no longer exists/i],
  ])("explains a %s report in plain language", async (reason, copy) => {
    const err = new Error("Report not available");
    err.reason = reason;
    readReport.mockRejectedValue(err);
    renderAt();
    expect(await screen.findByText(/This report isn't available/i)).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it("never renders report content on a denial", async () => {
    const err = new Error("nope"); err.reason = "revoked";
    readReport.mockRejectedValue(err);
    renderAt();
    await screen.findByText(/This report isn't available/i);
    expect(screen.queryByText(/Extracted facts/)).toBeNull();
  });
});
