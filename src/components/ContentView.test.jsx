// ContentView.test.jsx — pins the markdown-rendering shape of the "content"
// kind enrichment tab. Renders the body in a <pre>, exposes a Copy button,
// and updates the button label after a successful copy.
//
// We mock the shared copyToClipboard util so the test doesn't need a real
// clipboard (jsdom doesn't expose navigator.clipboard.writeText reliably).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/utils.js", async () => {
  const actual = await vi.importActual("../lib/utils.js");
  return {
    ...actual,
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  };
});

import ContentView from "./ContentView.jsx";
import { copyToClipboard } from "../lib/utils.js";

beforeEach(() => {
  vi.clearAllMocks();
  copyToClipboard.mockResolvedValue(undefined);
});

describe("ContentView", () => {
  it("renders the markdown body in a <pre> and the Copy button", () => {
    render(<ContentView text="# Hello\n\nWorld" />);
    expect(screen.getByText(/# Hello/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy content/i })).toBeInTheDocument();
  });

  it("calls copyToClipboard with the body and flips the label to 'Copied' on success", async () => {
    const user = userEvent.setup();
    // Use \n as actual newlines (not the JSX-literal "\n") so the
    // mock's call argument matches the expectation string. JSX string
    // attributes treat \n as a literal backslash-n, while JS string
    // literals interpret \n as a newline — the comparison would fail
    // silently otherwise.
    const body = "# Plan\n\n- step 1\n- step 2";
    render(<ContentView text={body} />);
    const btn = screen.getByRole("button", { name: /Copy content/i });
    await user.click(btn);
    expect(copyToClipboard).toHaveBeenCalledWith(body);
    // The button has a static aria-label ("Copy content") and a dynamic
    // visible label that flips to "Copied" after success. The visible
    // text is what the user sees; query on that, not on the aria-label.
    await waitFor(() => {
      expect(btn.textContent).toMatch(/Copied/i);
    });
  });

  it("swallows a clipboard failure and keeps the button as 'Copy' (no throw)", async () => {
    copyToClipboard.mockRejectedValueOnce(new Error("NotAllowedError"));
    const user = userEvent.setup();
    render(<ContentView text="body" />);
    // The click must not throw into the test runner.
    await user.click(screen.getByRole("button", { name: /Copy content/i }));
    // After the rejected promise resolves, the label is still 'Copy'
    // (we never flipped to 'Copied' because the catch didn't toggle state).
    expect(screen.getByRole("button", { name: /Copy content/i })).toBeInTheDocument();
  });

  it("renders an empty body without crashing", () => {
    render(<ContentView text="" />);
    // The <pre> is present (with empty text), and the Copy button still
    // appears. copyToClipboard should not be called until the user clicks.
    expect(screen.getByRole("button", { name: /Copy content/i })).toBeInTheDocument();
  });

  it("falls back to empty string when copyToClipboard receives undefined", async () => {
    // Regression: an old revision passed `text` directly without
    // guarding against null/undefined. The Copy call would then receive
    // a non-string and some browsers reject it.
    const user = userEvent.setup();
    render(<ContentView text={undefined} />);
    await user.click(screen.getByRole("button", { name: /Copy content/i }));
    expect(copyToClipboard).toHaveBeenCalledWith("");
  });
});
