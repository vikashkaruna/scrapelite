// src/components/OutcomeTiles.test.jsx — Q3 (outcome tiles) component tests.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OutcomeTiles from "./OutcomeTiles.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

describe("Q3 — OutcomeTiles: above-hero grid", () => {
  it("renders one button per tile in the data file", () => {
    render(<OutcomeTiles onSelect={() => {}} />);
    for (const tile of OUTCOME_TILES) {
      expect(screen.getByText(tile.title)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem").length).toBe(OUTCOME_TILES.length);
  });

  it("calls onSelect with the tile object when a tile is clicked", () => {
    const onSelect = vi.fn();
    render(<OutcomeTiles onSelect={onSelect} />);
    const first = screen.getByText(OUTCOME_TILES[0].title).closest("button");
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ key: OUTCOME_TILES[0].key }),
    );
  });

  it("disables every tile when disabled=true", () => {
    render(<OutcomeTiles onSelect={() => {}} disabled />);
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(item).toBeDisabled();
    }
  });

  it("the section has an accessible name for screen readers", () => {
    render(<OutcomeTiles onSelect={() => {}} />);
    expect(
      screen.getByRole("list", { name: /Common jobs to be done/i }),
    ).toBeInTheDocument();
  });
});
