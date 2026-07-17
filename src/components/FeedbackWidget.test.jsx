// src/components/FeedbackWidget.test.jsx — Q5 component tests.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitMock = vi.hoisted(() => vi.fn(async (input) => ({
  persistedTo: "local",
  feedback: { extractionId: input.extractionId, rating: input.rating, comment: input.comment || "", updatedAt: "2026-07-17T00:00:00Z" },
})));
const getLocalMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../lib/feedbackService.js", () => ({
  submitFeedback: submitMock,
  getLocalFeedback: getLocalMock,
}));

import FeedbackWidget from "./FeedbackWidget.jsx";

beforeEach(() => {
  submitMock.mockClear();
  getLocalMock.mockClear();
  try { localStorage.clear(); } catch {}
});

describe("Q5 — FeedbackWidget: UI", () => {
  it("renders nothing when no extractionId is provided", () => {
    const { container } = render(<FeedbackWidget extractionId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the prompt and the two buttons", () => {
    render(<FeedbackWidget extractionId="ext_1" />);
    expect(screen.getByText(/Was this summary helpful/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thumbs up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thumbs down" })).toBeInTheDocument();
  });

  it("clicking thumbs-up calls submitFeedback with rating=1", async () => {
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [input] = submitMock.mock.calls[0];
    expect(input.rating).toBe(1);
    expect(input.extractionId).toBe("ext_1");
  });

  it("clicking thumbs-down calls submitFeedback with rating=-1", async () => {
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }));
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    expect(submitMock.mock.calls[0][0].rating).toBe(-1);
  });

  it("clicking the active thumbs-up again clears the vote (rating=0)", async () => {
    getLocalMock.mockReturnValueOnce({ extractionId: "ext_1", rating: 1, comment: "" });
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    expect(submitMock.mock.calls[0][0].rating).toBe(0);
  });

  it("opens the comment box after a rating is submitted", async () => {
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tell us what was off/i)).toBeInTheDocument();
    });
  });

  it("typing in the comment + clicking Save calls submitFeedback with the comment", async () => {
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    await waitFor(() => screen.getByPlaceholderText(/Tell us what was off/i));
    fireEvent.change(screen.getByPlaceholderText(/Tell us what was off/i), { target: { value: "Great summary!" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    await waitFor(() => {
      const last = submitMock.mock.calls[submitMock.mock.calls.length - 1];
      expect(last[0].comment).toBe("Great summary!");
    });
  });

  it("Clear button submits rating=0", async () => {
    getLocalMock.mockReturnValueOnce({ extractionId: "ext_1", rating: -1, comment: "" });
    render(<FeedbackWidget extractionId="ext_1" />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    expect(submitMock.mock.calls[0][0].rating).toBe(0);
  });

  it("does nothing when disabled=true", () => {
    render(<FeedbackWidget extractionId="ext_1" disabled />);
    const up = screen.getByRole("button", { name: "Thumbs up" });
    const down = screen.getByRole("button", { name: "Thumbs down" });
    expect(up).toBeDisabled();
    expect(down).toBeDisabled();
  });
});
