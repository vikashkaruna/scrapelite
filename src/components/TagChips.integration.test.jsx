// TagChips.integration.test.jsx — Groke QW#2 integration test.
// Mounts the TagChips component and exercises the add/remove/backspace/enter
// flow + the host-suggestion + auto-suggest behaviour.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagChips from "./TagChips.jsx";

describe("Groke QW#2 — TagChips component", () => {
  beforeEach(() => localStorage.clear());

  it("renders existing tags", () => {
    render(<TagChips tags={["stripe", "pricing"]} onChange={() => {}} />);
    expect(screen.getByText("stripe")).toBeInTheDocument();
    expect(screen.getByText("pricing")).toBeInTheDocument();
  });

  it("Enter adds a new tag and clears the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagChips tags={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.type(input, "Research{Enter}");
    expect(onChange).toHaveBeenCalledWith(["research"]);
  });

  it("Comma adds a new tag (allows paste-style input)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagChips tags={["stripe"]} onChange={onChange} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.type(input, "pricing,");
    expect(onChange).toHaveBeenLastCalledWith(["stripe", "pricing"]);
  });

  it("Remove (×) button deletes that tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagChips tags={["stripe", "pricing"]} onChange={onChange} />);
    const removeBtn = screen.getByLabelText("Remove tag stripe");
    await user.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(["pricing"]);
  });

  it("Backspace on empty input removes the last tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagChips tags={["stripe", "pricing"]} onChange={onChange} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["stripe"]);
  });

  it("shows the host suggestion when input is empty + URL provided", async () => {
    const user = userEvent.setup();
    render(<TagChips tags={[]} url="https://stripe.com/pricing" onChange={() => {}} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.click(input);
    // Host suggestion "stripe" should be visible in the dropdown
    expect(await screen.findByText("from URL host")).toBeInTheDocument();
  });

  it("shows known-tag suggestions when typing", async () => {
    const user = userEvent.setup();
    const known = new Set(["stripe", "stripe-checkout", "pricing"]);
    render(<TagChips tags={[]} knownTags={known} onChange={() => {}} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.type(input, "str");
    // The suggestions dropdown should now show matching tags
    expect(await screen.findByText("stripe")).toBeInTheDocument();
    expect(await screen.findByText("stripe-checkout")).toBeInTheDocument();
  });

  it("clicking a suggestion commits it as a tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const known = new Set(["stripe", "pricing"]);
    render(<TagChips tags={[]} knownTags={known} onChange={onChange} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.type(input, "str");
    const sugBtn = await screen.findByRole("button", { name: /^stripe$/i });
    await user.click(sugBtn);
    expect(onChange).toHaveBeenLastCalledWith(["stripe"]);
  });

  it("dedupes when adding a tag that already exists", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagChips tags={["stripe"]} onChange={onChange} />);
    const input = screen.getByLabelText(/add a tag/i);
    await user.type(input, "STRIPE{Enter}");
    // Case-insensitive dedupe → onChange should NOT be called (no new tag)
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the input when at MAX_TAGS_PER_ITEM", async () => {
    const tags = Array.from({ length: 24 }, (_, i) => `t${i}`);
    render(<TagChips tags={tags} onChange={() => {}} />);
    expect(screen.queryByLabelText(/add a tag/i)).toBeNull();
    expect(screen.getByText(/max 24 tags/i)).toBeInTheDocument();
  });
});
