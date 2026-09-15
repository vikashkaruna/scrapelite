import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
