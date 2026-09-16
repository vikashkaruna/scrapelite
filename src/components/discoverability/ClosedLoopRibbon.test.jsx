import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ClosedLoopRibbon, { CLOSED_LOOP_STEPS, stepNumber } from "./ClosedLoopRibbon.jsx";

describe("ClosedLoopRibbon numbering", () => {
  it("numbers the four audit sub-steps 1.1–1.4, then 2 Implement … 5 Expand", () => {
    expect(CLOSED_LOOP_STEPS.map((s) => `${s.number} ${s.label}`)).toEqual([
      "1.1 Discover", "1.2 Score", "1.3 Diagnose", "1.4 Recommend",
      "2 Implement", "3 Validate", "4 Benchmark", "5 Expand",
    ]);
    expect(stepNumber("validate")).toBe("3");
    expect(stepNumber("nope")).toBeNull();
  });

  it("renders the hierarchical number on every step and in the guide card", () => {
    const { container } = render(
      <MemoryRouter><ClosedLoopRibbon currentStep="diagnose" auditId="a-1" /></MemoryRouter>,
    );
    const nums = [...container.querySelectorAll(".closed-loop-step-num")].map((n) => n.textContent);
    expect(nums).toEqual(["1.1", "1.2", "1.3", "1.4", "2", "3", "4", "5"]);
    expect(screen.getByText(/Step 1\.3:/)).toBeTruthy();
    // Earlier steps read as complete; the active one is marked for assistive tech.
    const links = container.querySelectorAll(".closed-loop-step");
    expect(links[0].className).toMatch(/is-complete/);
    expect(links[2].getAttribute("aria-current")).toBe("step");
    expect(links[4].getAttribute("href")).toBe("/discoverability/truth?audit=a-1");
  });

  it("highlights entire 1.1 Discover to 1.4 Recommend in green when on the Audit tab", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/discoverability"]}>
        <ClosedLoopRibbon activeTab="audit" auditId="a-1" hasAudit={true} />
      </MemoryRouter>,
    );
    const steps = container.querySelectorAll(".closed-loop-step");
    // 1.1 to 1.4 are highlighted green
    for (let i = 0; i < 4; i++) {
      expect(steps[i].className).toContain("is-audit-highlight");
      expect(steps[i].className).toContain("is-complete");
    }
    // Steps 2 to 5 are not in green audit highlight
    for (let i = 4; i < 8; i++) {
      expect(steps[i].className).not.toContain("is-audit-highlight");
    }
    // Guide card displays audit complete summary
    expect(screen.getByText(/Step 1: Audit Complete/)).toBeTruthy();
  });

  it("progressively highlights 1.1 to 1.4 while auditing is in progress", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MemoryRouter initialEntries={["/discoverability"]}>
          <ClosedLoopRibbon isAuditing={true} activeTab="audit" />
        </MemoryRouter>,
      );
      // Initially 1.1 is in progress
      let steps = container.querySelectorAll(".closed-loop-step");
      expect(steps[0].className).toContain("is-auditing");
      expect(screen.getByText(/Crawl & Discover/)).toBeTruthy();

      // Advance to step 1.2
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      steps = container.querySelectorAll(".closed-loop-step");
      expect(steps[0].className).toContain("is-audit-highlight");
      expect(steps[1].className).toContain("is-auditing");

      // Advance to step 1.3
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      steps = container.querySelectorAll(".closed-loop-step");
      expect(steps[1].className).toContain("is-audit-highlight");
      expect(steps[2].className).toContain("is-auditing");

      // Advance to step 1.4
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2800);
      });
      steps = container.querySelectorAll(".closed-loop-step");
      expect(steps[2].className).toContain("is-audit-highlight");
      expect(steps[3].className).toContain("is-auditing");
    } finally {
      vi.useRealTimers();
    }
  });
});
