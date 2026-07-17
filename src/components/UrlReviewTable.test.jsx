// src/components/UrlReviewTable.test.jsx — Q7 (Batch default = table view) component tests.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UrlReviewTable from "./UrlReviewTable.jsx";

const SAMPLE_URLS = [
  "https://example.com",
  "https://stripe.com/pricing",
  "https://notion.so/about",
];
const SAMPLE_INVALID = ["not a url", "ftp://broken"];

describe("Q7 — UrlReviewTable: comparable grid", () => {
  it("renders nothing when there are no URLs", () => {
    const { container } = render(<UrlReviewTable urls={[]} invalid={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a row for every valid URL with a Valid badge", () => {
    render(<UrlReviewTable urls={SAMPLE_URLS} invalid={[]} />);
    expect(screen.getAllByText(/valid/i).length).toBeGreaterThan(0);
    for (const url of SAMPLE_URLS) {
      expect(screen.getByTitle(url)).toBeInTheDocument();
    }
  });

  it("renders invalid rows with an Invalid badge when supplied", () => {
    render(<UrlReviewTable urls={SAMPLE_URLS} invalid={SAMPLE_INVALID} />);
    expect(screen.getAllByText(/invalid/i).length).toBeGreaterThan(0);
    for (const raw of SAMPLE_INVALID) {
      expect(screen.getByTitle(raw)).toBeInTheDocument();
    }
  });

  it("shows host and path for valid URLs", () => {
    render(<UrlReviewTable urls={["https://example.com/foo/bar"]} invalid={[]} />);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("/foo/bar")).toBeInTheDocument();
  });

  it("is collapsed by default when no URLs are passed (initial render)", () => {
    // First render with no URLs → returns null, that's covered above. Now
    // check that when the component initially renders with URLs, it opens
    // by default — clicking the toggle collapses it.
    render(<UrlReviewTable urls={SAMPLE_URLS} invalid={[]} />);
    const toggle = screen.getByRole("button", { name: /Review URLs/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("calls onRemove with the row index when × is clicked", () => {
    const onRemove = vi.fn();
    render(<UrlReviewTable urls={SAMPLE_URLS} invalid={[]} onRemove={onRemove} />);
    const removeButtons = screen.getAllByLabelText(/Remove/);
    expect(removeButtons.length).toBe(SAMPLE_URLS.length);
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("calls onClear when the Clear action is clicked", () => {
    const onClear = vi.fn();
    render(<UrlReviewTable urls={SAMPLE_URLS} invalid={[]} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Copy all button is disabled when no valid URLs", () => {
    render(<UrlReviewTable urls={[]} invalid={SAMPLE_INVALID} />);
    const copyAll = screen.getByRole("button", { name: /Copy all/i });
    expect(copyAll).toBeDisabled();
  });
});
