// src/components/CreditEstimator.test.jsx — Q2 (pre-flight estimator) component tests.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CreditEstimator from "./CreditEstimator.jsx";

describe("Q2 — CreditEstimator: tone + visibility", () => {
  it("renders nothing when no estimate is provided", () => {
    const { container } = render(<CreditEstimator />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when required=0 (no input yet)", () => {
    const { container } = render(
      <CreditEstimator estimate={{ required: 0, message: "n/a", tone: "ok" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the message in tone=ok", () => {
    render(
      <CreditEstimator
        estimate={{ required: 2, remaining: 8, afterRun: 6, message: "2 of 8 remaining will be used", tone: "ok" }}
      />,
    );
    expect(screen.getByText(/2 of 8 remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("tone-ok");
  });

  it("renders the message in tone=warn", () => {
    render(
      <CreditEstimator
        estimate={{ required: 8, remaining: 9, afterRun: 1, message: "8 of 9 remaining — 1 will be left after this run", tone: "warn" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveClass("tone-warn");
  });

  it("renders the message in tone=block and hides the after-run note", () => {
    render(
      <CreditEstimator
        estimate={{ required: 7, remaining: 5, afterRun: -2, message: "Blocked — 5 remaining, 7 needed", tone: "block" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveClass("tone-block");
    expect(screen.queryByText(/\(.*after this run\)/i)).toBeNull();
  });

  it("adds a 'compact' modifier when compact=true", () => {
    render(
      <CreditEstimator
        compact
        estimate={{ required: 1, remaining: 9, afterRun: 8, message: "1 of 9 remaining will be used", tone: "ok" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveClass("compact");
  });

  it("hides the banner entirely when unlimited + compact + tone=ok", () => {
    const { container } = render(
      <CreditEstimator
        compact
        estimate={{ required: 1, remaining: Infinity, afterRun: Infinity, message: "ok", tone: "ok", isUnlimited: true }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
