// The dry trace renders the REASONS, which are the whole product — "did not
// match" is not something a user can act on. Covered here because /workflows is
// signed-in only, so a browser check cannot reach this view.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TracePanel from "./TracePanel.jsx";

const rules = [
  {
    id: "r1", label: "Pricing alerts", status: "active",
    trigger_source: "watchlist", action_type: "slack",
    conditions: [{ field: "category", operator: "equals", value: "pricing" }],
  },
  {
    id: "r2", label: "Everything", status: "active",
    trigger_source: "watchlist", action_type: "email", conditions: [],
  },
];

describe("TracePanel", () => {
  it("says plainly that nothing is sent", () => {
    // A preview a user is afraid to click is a preview nobody uses.
    render(<TracePanel rules={rules} />);
    expect(screen.getByText(/nothing is sent/i)).toBeInTheDocument();
  });

  it("reports how many rules would fire for the default sample", () => {
    render(<TracePanel rules={rules} />);
    expect(screen.getByText(/2 rules would fire/i)).toBeInTheDocument();
  });

  it("shows the condition that turned a rule away when the sample changes", () => {
    render(<TracePanel rules={rules} />);
    fireEvent.click(screen.getByText(/reworded a page/i));
    // The actionable reason, not a bare verdict.
    expect(screen.getByText(/category is 'positioning', expected 'pricing'/i)).toBeInTheDocument();
    expect(screen.getByText(/1 rule would fire/i)).toBeInTheDocument();
  });

  it("tells a user with no rules that nothing would fire, and why", () => {
    render(<TracePanel rules={[]} />);
    expect(screen.getByText(/no rules yet/i)).toBeInTheDocument();
  });

  it("reports a paused rule as skipped rather than hiding it", () => {
    render(<TracePanel rules={[{ ...rules[1], status: "paused" }]} />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("exposes the exact payload, so a condition can be written against real keys", () => {
    render(<TracePanel rules={rules} />);
    expect(screen.getByText(/see the exact event/i)).toBeInTheDocument();
  });
});
