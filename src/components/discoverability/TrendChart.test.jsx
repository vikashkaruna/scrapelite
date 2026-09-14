// TrendChart.test.jsx — gaps are drawn as gaps.
//
// A validation chart's whole job is to show whether a change worked. Joining
// two measured points through an unmeasured one draws a continuity that was
// never observed, so these assert the break is real in the rendered SVG.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TrendChart from "./TrendChart.jsx";

const at = (d) => `2026-09-${String(d).padStart(2, "0")}T10:00:00Z`;
const point = (d, over = {}) => ({
  auditId: `a${d}`, at: at(d), overall: 60, seo: 55, aeo: 65, geo: 50, coverage: 100, ...over,
});

describe("TrendChart", () => {
  it("asks for a second run instead of drawing a single point as a trend", () => {
    const { container } = render(<TrendChart trend={{ points: [point(1)] }} />);
    expect(screen.getByText(/One audit is a reading; two are a direction/)).toBeTruthy();
    // The empty state carries an icon <svg>; what must be absent is the CHART.
    expect(container.querySelector(".dsc-trend-svg")).toBeNull();
  });

  it("draws one continuous path when every point was measured", () => {
    const { container } = render(<TrendChart trend={{ points: [point(1), point(2), point(3)] }} />);
    expect(container.querySelectorAll("path.dsc-trend-line.dsc-line-overall")).toHaveLength(1);
    expect(container.querySelectorAll("circle.dsc-line-overall")).toHaveLength(3);
  });

  it("🔴 breaks the line at an unmeasured point rather than interpolating across it", () => {
    const { container } = render(<TrendChart trend={{
      points: [point(1, { overall: 50 }), point(2, { overall: 55 }), point(3, { overall: null }), point(4, { overall: 70 })],
    }} />);
    const paths = container.querySelectorAll("path.dsc-trend-line.dsc-line-overall");
    expect(paths).toHaveLength(2);
    // The unmeasured audit gets no dot — a dot at 0 would be the lie in another form.
    expect(container.querySelectorAll("circle.dsc-line-overall")).toHaveLength(3);
    // A lone measured point after the gap still renders as a visible mark.
    expect(paths[1].getAttribute("d")).toMatch(/l 0\.01 0/);
  });

  it("only draws the series that are switched on", () => {
    const { container } = render(
      <TrendChart trend={{ points: [point(1), point(2)] }} active={["seo", "geo"]} />,
    );
    expect(container.querySelectorAll("path.dsc-line-overall")).toHaveLength(0);
    expect(container.querySelectorAll("path.dsc-line-seo")).toHaveLength(1);
    expect(container.querySelectorAll("path.dsc-line-geo")).toHaveLength(1);
  });

  it("reports legend toggles and reflects them with aria-pressed", () => {
    const onToggleSeries = vi.fn();
    render(<TrendChart trend={{ points: [point(1), point(2)] }} active={["overall"]} onToggleSeries={onToggleSeries} />);
    const seo = screen.getByRole("button", { name: "SEO" });
    expect(seo.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Overall" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(seo);
    expect(onToggleSeries).toHaveBeenCalledWith("seo");
  });

  it("states the audit count and the comparable change, with a sign", () => {
    render(<TrendChart trend={{
      points: [point(1), point(2), point(3)],
      change: { comparable: true, change: 12 },
    }} />);
    expect(screen.getByText(/3 audits/)).toBeTruthy();
    expect(screen.getByText(/\+12 overall since the first measured run/)).toBeTruthy();
  });

  it("says nothing about change when the runs are not comparable", () => {
    render(<TrendChart trend={{ points: [point(1), point(2)], change: { comparable: false, change: 30 } }} />);
    expect(screen.queryByText(/since the first measured run/)).toBeNull();
  });

  it("labels the chart for assistive technology", () => {
    render(<TrendChart trend={{ points: [point(1), point(2)] }} />);
    expect(screen.getByRole("img", { name: "Score trend across 2 audits" })).toBeTruthy();
  });
});
