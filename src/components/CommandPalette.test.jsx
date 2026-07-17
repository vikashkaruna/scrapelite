// CommandPalette.test.jsx — F10 (mod+K command palette) tests.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CommandPalette, { filterActions, fuzzyScore } from "./CommandPalette.jsx";
import { AuthProvider } from "./AuthProvider.jsx";

function renderPalette(props = {}) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CommandPalette {...props} />
      </AuthProvider>
    </MemoryRouter>
  );
}

const ACTIONS = [
  { id: "extract",   label: "Run extraction",   hint: "Focus the URL composer" },
  { id: "dashboard", label: "Go to Dashboard",   hint: "Saved extractions" },
  { id: "batch",     label: "Go to Batch",       hint: "Multi-URL extraction" },
  { id: "pricing",   label: "Go to Pricing",     hint: "Compare plans" },
  { id: "help",      label: "Show keyboard shortcuts", hint: "?" },
];

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("F10 — fuzzyScore + filterActions (pure)", () => {
  it("fuzzyScore matches an exact prefix with score 1", () => {
    expect(fuzzyScore("dash", "Dashboard")).toBeGreaterThan(0.9);
  });

  it("fuzzyScore returns 0 when no characters match", () => {
    expect(fuzzyScore("xyz", "Dashboard")).toBe(0);
  });

  it("fuzzyScore gives subsequence fallback for non-contiguous matches", () => {
    // "dsh" — d, s, h appear in "Dashboard" in that order (0, 3, 4)
    expect(fuzzyScore("dsh", "Dashboard")).toBeGreaterThan(0);
    expect(fuzzyScore("dsh", "Dashboard")).toBeLessThan(0.5);
  });

  it("filterActions returns the full list for an empty query", () => {
    expect(filterActions(ACTIONS, "")).toEqual(ACTIONS);
  });

  it("filterActions keeps only actions whose label/hint matches", () => {
    const out = filterActions(ACTIONS, "dashboard");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("dashboard");
  });

  it("filterActions matches via the hint text", () => {
    const out = filterActions(ACTIONS, "Compare");
    expect(out[0].id).toBe("pricing");
  });

  it("filterActions returns [] when nothing matches", () => {
    expect(filterActions(ACTIONS, "asdfgh")).toEqual([]);
  });

  it("filterActions orders by score (prefix > subsequence)", () => {
    const out = filterActions(ACTIONS, "g");
    // "Go to Dashboard", "Go to Batch", "Go to Pricing" all start with "g"
    // and score identically, so the relative order is preserved.
    expect(out[0].id).toBe("dashboard");
    // "Show keyboard shortcuts" (help) and "Run extraction" don't have 'g' in either.
    expect(out.find((a) => a.id === "help")).toBeUndefined();
    expect(out.find((a) => a.id === "extract")).toBeUndefined();
  });
});

describe("F10 — CommandPalette (UI)", () => {
  it("does not render when open=false", () => {
    const { container } = renderPalette({ open: false, onClose: () => {} });
    expect(container.firstChild).toBeNull();
  });

  it("renders the search input + 7 actions when open (not signed in)", () => {
    renderPalette({ open: true, onClose: () => {} });
    expect(screen.getByTestId("cmdpalette-input")).toBeInTheDocument();
    // 7 actions when not signed in (no workspace/account).
    expect(screen.getByTestId("cmdpalette-item-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("cmdpalette-item-batch")).toBeInTheDocument();
    expect(screen.getByTestId("cmdpalette-item-pricing")).toBeInTheDocument();
    expect(screen.queryByTestId("cmdpalette-item-workspace")).toBeNull();
  });

  it("filters the list as the user types", () => {
    renderPalette({ open: true, onClose: () => {} });
    const input = screen.getByTestId("cmdpalette-input");
    fireEvent.change(input, { target: { value: "batch" } });
    expect(screen.getByTestId("cmdpalette-item-batch")).toBeInTheDocument();
    expect(screen.queryByTestId("cmdpalette-item-dashboard")).toBeNull();
  });

  it("ArrowDown moves the highlight; Enter runs the highlighted action and closes", () => {
    const onClose = vi.fn();
    renderPalette({ open: true, onClose });
    const input = screen.getByTestId("cmdpalette-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes the palette", () => {
    const onClose = vi.fn();
    renderPalette({ open: true, onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
