// src/components/engagement/KanbanBoard.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import KanbanBoard, { CARD_LIMIT } from "./KanbanBoard.jsx";

const P = (i, status) => ({ id: `p${i}`, first_name: `N${i}`, last_name: "X", email: `n${i}@x.test`, status, engagement_score: 0 });

describe("KanbanBoard — fits the page", () => {
  it("collapses empty stages until 'Show empty stages' is ticked", () => {
    const { container } = render(<KanbanBoard prospects={[P(1, "new")]} />);
    const cols = () => [...container.querySelectorAll(".engx-col")];
    expect(cols()).toHaveLength(9); // every stage is present — nothing hidden off-screen
    expect(cols().filter((c) => c.classList.contains("is-empty"))).toHaveLength(8);
    fireEvent.click(screen.getByLabelText("Show empty stages"));
    expect(cols().filter((c) => c.classList.contains("is-empty"))).toHaveLength(0);
  });

  it("shows the first cards of a busy stage and links the rest to the Prospects tab", () => {
    const onShowStage = vi.fn();
    const many = Array.from({ length: CARD_LIMIT + 3 }, (_, i) => P(i, i % 2 ? "opened" : "clicked"));
    const { container } = render(<KanbanBoard prospects={many} onShowStage={onShowStage} />);
    expect(container.querySelectorAll(".engx-card")).toHaveLength(CARD_LIMIT);
    fireEvent.click(screen.getByRole("button", { name: "+ 3 more in opened / clicked" }));
    expect(onShowStage).toHaveBeenCalledWith(["opened", "clicked"]);
  });
});
