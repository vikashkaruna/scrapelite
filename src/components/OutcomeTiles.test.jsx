// src/components/OutcomeTiles.test.jsx — Q3 (outcome tiles, multi-select) component tests.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OutcomeTiles from "./OutcomeTiles.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

describe("Q3 (multi-select) — OutcomeTiles: above-hero grid", () => {
  it("renders one button per tile in the data file", () => {
    render(<OutcomeTiles onToggle={() => {}} />);
    for (const tile of OUTCOME_TILES) {
      expect(screen.getByText(tile.title)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem").length).toBe(OUTCOME_TILES.length);
  });

  it("calls onToggle with the tile object when a tile is clicked", () => {
    const onToggle = vi.fn();
    render(<OutcomeTiles onToggle={onToggle} />);
    const first = screen.getByText(OUTCOME_TILES[0].title).closest("button");
    fireEvent.click(first);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ key: OUTCOME_TILES[0].key }),
    );
  });

  it("marks active tiles with aria-pressed=true and the .outcome-tile-active class", () => {
    const activeKeys = [OUTCOME_TILES[0].key, OUTCOME_TILES[2].key];
    render(<OutcomeTiles activeKeys={activeKeys} onToggle={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-pressed", "true");
    expect(items[0]).toHaveClass("outcome-tile-active");
    expect(items[1]).toHaveAttribute("aria-pressed", "false");
    expect(items[2]).toHaveAttribute("aria-pressed", "true");
    expect(items[3]).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the 'Selected' check on every active tile", () => {
    const activeKeys = [OUTCOME_TILES[0].key];
    render(<OutcomeTiles activeKeys={activeKeys} onToggle={() => {}} />);
    const selectedLabels = screen.getAllByText(/selected/i);
    expect(selectedLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show a Clear button when no tiles are active", () => {
    render(<OutcomeTiles activeKeys={[]} onToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Clear \(\d+\)$/ })).toBeNull();
  });

  it("shows a Clear (N) button when at least one tile is active", () => {
    const activeKeys = [OUTCOME_TILES[0].key, OUTCOME_TILES[1].key, OUTCOME_TILES[2].key];
    render(<OutcomeTiles activeKeys={activeKeys} onToggle={() => {}} />);
    const clearBtn = screen.getByRole("button", { name: /^Clear \(3\)$/ });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    // Clear button emits the "__clear__" sentinel so the parent can clear all
    expect(clearBtn).toBeInTheDocument(); // still rendered
  });

  it("Clear button fires onToggle with the '__clear__' sentinel", () => {
    const onToggle = vi.fn();
    const activeKeys = [OUTCOME_TILES[0].key];
    render(<OutcomeTiles activeKeys={activeKeys} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^Clear \(1\)$/ }));
    expect(onToggle).toHaveBeenCalledWith("__clear__");
  });

  it("disables every tile when disabled=true", () => {
    render(<OutcomeTiles onToggle={() => {}} disabled />);
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(item).toBeDisabled();
    }
  });

  it("the section has an accessible name for screen readers", () => {
    render(<OutcomeTiles onToggle={() => {}} />);
    expect(
      screen.getByRole("list", { name: /Common jobs to be done/i }),
    ).toBeInTheDocument();
  });
});
