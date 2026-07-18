// src/components/OutcomeTiles.test.jsx — Q3 outcome tiles, single-select.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OutcomeTiles from "./OutcomeTiles.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

describe("Q3 (single-select) — OutcomeTiles: above-hero grid", () => {
  it("renders one button per tile in the data file", () => {
    render(<OutcomeTiles onToggle={() => {}} />);
    for (const tile of OUTCOME_TILES) {
      expect(screen.getByText(tile.title)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem").length).toBe(OUTCOME_TILES.length);
  });

  it("calls onToggle with the tile object when an inactive tile is clicked", () => {
    const onToggle = vi.fn();
    render(<OutcomeTiles onToggle={onToggle} />);
    const first = screen.getByText(OUTCOME_TILES[0].title).closest("button");
    fireEvent.click(first);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ key: OUTCOME_TILES[0].key }),
    );
  });

  it("calls onToggle with null when the active tile is clicked again (deselect)", () => {
    const onToggle = vi.fn();
    render(<OutcomeTiles activeKey={OUTCOME_TILES[0].key} onToggle={onToggle} />);
    const active = screen.getByText(OUTCOME_TILES[0].title).closest("button");
    fireEvent.click(active);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(null);
  });

  it("marks the active tile with aria-pressed=true and the .outcome-tile-active class", () => {
    render(<OutcomeTiles activeKey={OUTCOME_TILES[2].key} onToggle={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveAttribute("aria-pressed", "true");
    expect(items[2]).toHaveClass("outcome-tile-active");
    expect(items[0]).toHaveAttribute("aria-pressed", "false");
    expect(items[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("never shows a multi-select Clear (N) button", () => {
    render(<OutcomeTiles activeKey={OUTCOME_TILES[0].key} onToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Clear \(\d+\)$/ })).toBeNull();
  });

  it("does not show a 'Selected' badge (single-select uses the check icon, not text)", () => {
    render(<OutcomeTiles activeKey={OUTCOME_TILES[0].key} onToggle={() => {}} />);
    expect(screen.queryByText(/^Selected$/i)).toBeNull();
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

  it("the section header reads 'Common jobs' (not 'What do you want to extract?')", () => {
    render(<OutcomeTiles onToggle={() => {}} />);
    expect(screen.getByText(/^Common jobs$/i)).toBeInTheDocument();
    expect(screen.queryByText(/What do you want to extract/i)).toBeNull();
  });
});
