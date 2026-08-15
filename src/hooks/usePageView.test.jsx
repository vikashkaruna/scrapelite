// src/hooks/usePageView.test.jsx — SPA page-view tracking.
//
// Both behaviours asserted here were REAL bugs found by driving a browser, not
// by reading the code — each looked completely correct on the page.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { StrictMode, useEffect } from "react";
import { usePageView } from "./usePageView.js";

vi.mock("../lib/analyticsService.js", () => ({
  lifecycle: { pageView: vi.fn().mockResolvedValue({ ok: true }) },
}));

function pageViews() {
  return (window.dataLayer || [])
    .map((a) => Array.from(a))
    .filter((a) => a[0] === "event" && a[1] === "page_view")
    .map((a) => a[2]);
}

function Harness({ to }) {
  usePageView();
  const navigate = useNavigate();
  useEffect(() => {
    if (to) setTimeout(() => navigate(to), 0);
  }, [to, navigate]);
  return <div>page</div>;
}

beforeEach(() => {
  window.dataLayer = [];
  window.gtag = (...args) => window.dataLayer.push(args);
  document.title = "Test Page";
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("usePageView", () => {
  it("sends exactly one page_view for the initial route", async () => {
    render(
      <MemoryRouter initialEntries={["/pricing"]}>
        <Routes><Route path="/pricing" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0].page_path).toBe("/pricing");
  });

  it("still fires under StrictMode's double-invoked effects", async () => {
    // REGRESSION: the hook used to mark the path as sent when it SCHEDULED the
    // callback. StrictMode runs mount → cleanup → mount, so the cleanup
    // cancelled the pending send and the remount then saw the path as already
    // handled and returned early. Result: no page_view was ever sent in dev,
    // and any effect re-run within one tick reproduced it in production.
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/about"]}>
          <Routes><Route path="/about" element={<Harness />} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(pageViews()).toHaveLength(1);
  });

  it("does not depend on requestAnimationFrame", async () => {
    // REGRESSION: the hook scheduled via rAF, which is throttled to zero in a
    // backgrounded tab — so a page opened with middle-click recorded nothing
    // until focused. Verified in a headless browser, where it never fired at
    // all. Simulate by making rAF a no-op that never invokes its callback.
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 1;
    try {
      render(
        <MemoryRouter initialEntries={["/blog"]}>
          <Routes><Route path="/blog" element={<Harness />} /></Routes>
        </MemoryRouter>,
      );
      await act(async () => { vi.advanceTimersByTime(50); });
      expect(pageViews()).toHaveLength(1);
    } finally {
      window.requestAnimationFrame = realRaf;
    }
  });

  it("sends one page_view per navigation, not per render", async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/pricing"]}>
        <Routes><Route path="/pricing" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { vi.advanceTimersByTime(50); });
    // Re-render the same route repeatedly: provider churn must not re-count.
    for (let i = 0; i < 3; i++) {
      rerender(
        <MemoryRouter initialEntries={["/pricing"]}>
          <Routes><Route path="/pricing" element={<Harness />} /></Routes>
        </MemoryRouter>,
      );
      await act(async () => { vi.advanceTimersByTime(20); });
    }
    expect(pageViews()).toHaveLength(1);
  });

  it("never reports an /admin path to the third-party tag", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/revenue"]}>
        <Routes><Route path="/admin/*" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(pageViews()).toHaveLength(0);
  });

  it("does not throw when gtag is unavailable", async () => {
    delete window.gtag;
    expect(() =>
      render(
        <MemoryRouter initialEntries={["/contact"]}>
          <Routes><Route path="/contact" element={<Harness />} /></Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    await act(async () => { vi.advanceTimersByTime(50); });
  });

  it("records the title as it is at send time", async () => {
    document.title = "Pricing — DatIQ";
    render(
      <MemoryRouter initialEntries={["/pricing"]}>
        <Routes><Route path="/pricing" element={<Harness />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(pageViews()[0].page_title).toBe("Pricing — DatIQ");
  });
});
