import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecommendationQueue from "./RecommendationQueue.jsx";
import { ToastProvider } from "../Toast.jsx";

// W5.5 — the assign verb. §7.6 lists copy, export, accept, dismiss and mark
// implemented as shipped, and assign as missing. A queue nobody can be given
// work from is a personal to-do list.

const rec = (over = {}) => ({
  id: "r1", code: "TA-03", title: "Remove the noindex",
  pillar: "technical_accessibility", priority: "high",
  status: "open", frameworks: ["seo"], ...over,
});

const mount = (props = {}) =>
  render(
    <ToastProvider>
      <RecommendationQueue recommendations={[rec(props.rec)]} {...props} />
    </ToastProvider>,
  );

describe("the assign control", () => {
  it("is absent until the page supplies a handler", () => {
    // The queue renders in contexts with no session and no way to assign.
    // Showing a dead control there would be worse than showing none.
    mount({});
    expect(screen.queryByLabelText(/Assign Remove the noindex/i)).toBeNull();
  });

  it("shows an open recommendation as unassigned", () => {
    mount({ onAssign: vi.fn(), currentUserId: "u1" });
    const select = screen.getByLabelText(/Assign Remove the noindex/i);
    expect(select.value).toBe("");
    expect(screen.getByLabelText(/Currently Unassigned/i)).toBeTruthy();
  });

  it("always offers 'Me', even with no workspace members loaded", () => {
    // A solo operator has no workspace rows at all. Refusing them their own
    // queue because a member list came back empty would be absurd.
    mount({ onAssign: vi.fn(), currentUserId: "u1", members: [] });
    expect(screen.getByRole("option", { name: "Me" })).toBeTruthy();
  });

  it("lists workspace members without duplicating you", () => {
    mount({
      onAssign: vi.fn(), currentUserId: "u1",
      members: [{ userId: "u1", name: "Me Myself" }, { userId: "u2", name: "Priya" }],
    });
    expect(screen.getByRole("option", { name: "Priya" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Me Myself" })).toBeNull();
  });

  it("hands the chosen person to the page", () => {
    const onAssign = vi.fn();
    mount({ onAssign, currentUserId: "u1", members: [{ userId: "u2", name: "Priya" }] });
    fireEvent.change(screen.getByLabelText(/Assign Remove the noindex/i), { target: { value: "u2" } });
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "u2");
  });

  it("sends null when the work is put down, not an empty string", () => {
    // The endpoint treats null as "unassign"; "" would be an invalid uuid.
    const onAssign = vi.fn();
    mount({
      onAssign, currentUserId: "u1",
      rec: { assigned_to: "u2" },
      members: [{ userId: "u2", name: "Priya" }],
    });
    fireEvent.change(screen.getByLabelText(/Assign Remove the noindex/i), { target: { value: "" } });
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), null);
  });

  it("names the current holder in the accessible label", () => {
    mount({
      onAssign: vi.fn(), currentUserId: "u1",
      rec: { assigned_to: "u2" },
      members: [{ userId: "u2", name: "Priya" }],
    });
    expect(screen.getByLabelText(/Currently Priya/i)).toBeTruthy();
  });

  it("says 'You' rather than your own name when you hold it", () => {
    mount({
      onAssign: vi.fn(), currentUserId: "u1",
      rec: { assigned_to: "u1" },
      members: [{ userId: "u1", name: "Vikash" }],
    });
    expect(screen.getByLabelText(/Currently You/i)).toBeTruthy();
  });

  it("does not offer assignment on a resolved recommendation", () => {
    // Handing somebody work that is already done is noise.
    mount({ onAssign: vi.fn(), currentUserId: "u1", rec: { status: "done" } });
    expect(screen.queryByLabelText(/Assign Remove the noindex/i)).toBeNull();
  });
});
