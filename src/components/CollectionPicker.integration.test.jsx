// CollectionPicker.integration.test.jsx — Groke QW#3 integration test.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollectionPicker from "./CollectionPicker.jsx";

describe("Groke QW#3 — CollectionPicker component", () => {
  beforeEach(() => localStorage.clear());

  it("shows 'Collection' placeholder when no value is set", () => {
    render(<CollectionPicker value="" collections={[]} onSelect={() => {}} />);
    expect(screen.getByText(/^Collection$/i)).toBeInTheDocument();
  });

  it("shows the current collection name when value is set", () => {
    render(<CollectionPicker value="Q2 research" collections={[]} onSelect={() => {}} />);
    expect(screen.getByText("Q2 research")).toBeInTheDocument();
  });

  it("clicking trigger opens the menu with existing collections", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value=""
        collections={[{ name: "Stripe", count: 3 }, { name: "Q2", count: 1 }]}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByText(/^Collection$/i));
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(await screen.findByText("Q2")).toBeInTheDocument();
  });

  it("selecting a collection calls onSelect and closes the menu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value=""
        collections={[{ name: "Stripe", count: 3 }]}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByText(/^Collection$/i));
    await user.click(await screen.findByText("Stripe"));
    expect(onSelect).toHaveBeenCalledWith("Stripe");
    // Menu should close
    await waitFor(() => {
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });
  });

  it("'Remove from collection' option appears when value is set", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value="Stripe"
        collections={[{ name: "Stripe", count: 3 }, { name: "Q2", count: 1 }]}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByText("Stripe"));
    expect(await screen.findByText(/remove from collection/i)).toBeInTheDocument();
  });

  it("clicking 'Remove from collection' calls onSelect with empty string", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value="Stripe"
        collections={[{ name: "Stripe", count: 3 }]}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByText("Stripe"));
    await user.click(await screen.findByText(/remove from collection/i));
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("'New collection…' button reveals an inline create form", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value=""
        collections={[]}
        onSelect={onSelect}
        onCreate={onCreate}
      />
    );
    await user.click(screen.getByText(/^Collection$/i));
    await user.click(await screen.findByText(/new collection/i));
    expect(await screen.findByPlaceholderText(/new collection name/i)).toBeInTheDocument();
  });

  it("submitting the new-collection form fires onCreate + onSelect", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    render(
      <CollectionPicker
        value=""
        collections={[]}
        onSelect={onSelect}
        onCreate={onCreate}
      />
    );
    await user.click(screen.getByText(/^Collection$/i));
    await user.click(await screen.findByText(/new collection/i));
    const input = await screen.findByPlaceholderText(/new collection name/i);
    await user.type(input, "Q3 competitors");
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Q3 competitors");
    expect(onSelect).toHaveBeenCalledWith("Q3 competitors");
  });

  it("clicking outside closes the menu", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <CollectionPicker value="" collections={[{ name: "A", count: 1 }]} onSelect={() => {}} />
        <div data-testid="outside">outside</div>
      </div>
    );
    await user.click(screen.getByText(/^Collection$/i));
    expect(await screen.findByText("A")).toBeInTheDocument();
    await user.click(screen.getByTestId("outside"));
    await waitFor(() => {
      expect(screen.queryByText("A")).not.toBeInTheDocument();
    });
  });
});
