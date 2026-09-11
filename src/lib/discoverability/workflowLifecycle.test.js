import { describe, it, expect } from "vitest";
import {
  WORKFLOW_STATES, WORKFLOW_STATE_IDS, ACTIVE_STATE_IDS, TERMINAL_STATES,
  workflowState, isWorkflowState, canonicalState, canTransition,
  requirementsFor, groupByState, overdue,
} from "./workflowLifecycle.js";

describe("the lifecycle", () => {
  it("carries the PRD's seven states", () => {
    for (const id of ["open", "accepted", "assigned", "in_progress",
                      "implemented", "validation_scheduled", "validated"]) {
      expect(isWorkflowState(id), id).toBe(true);
    }
  });

  it("🔴 keeps `dismissed`, which the PRD does not name", () => {
    // A queue you cannot decline an item from forces the user to do work they
    // judged unnecessary or leave it open for ever.
    expect(isWorkflowState("dismissed")).toBe(true);
    expect(WORKFLOW_STATES.dismissed.describes).toMatch(/reason/i);
  });

  it("🔴 treats `done` and `implemented` as ONE state under two names", () => {
    // Every stored row, export and webhook payload says `done`. Renaming it
    // would rewrite history for no gain.
    expect(canonicalState("done")).toBe("implemented");
    expect(canonicalState("implemented")).toBe("implemented");
    expect(WORKFLOW_STATES.done.label).toBe(WORKFLOW_STATES.implemented.label);
  });

  it("knows which states still need somebody to act", () => {
    expect(ACTIVE_STATE_IDS).toContain("open");
    expect(ACTIVE_STATE_IDS).toContain("in_progress");
    expect(ACTIVE_STATE_IDS).not.toContain("validated");
    expect(ACTIVE_STATE_IDS).not.toContain("dismissed");
    expect(TERMINAL_STATES).toEqual(["validated", "dismissed"]);
  });

  it("returns null for an unknown state rather than throwing", () => {
    expect(workflowState("invented")).toBeNull();
    expect(canonicalState("invented")).toBeNull();
  });
});

describe("canTransition", () => {
  it("⚠️ ALLOWS an unusual jump, and only marks it unsuggested", () => {
    // A state machine that refuses a legitimate jump teaches people to work
    // around the tool. The person moving the item knows more about their week
    // than this table does.
    const t = canTransition("open", "validated");
    expect(t.allowed).toBe(true);
    expect(t.suggested).toBe(false);
  });

  it("marks the common path as suggested", () => {
    expect(canTransition("accepted", "in_progress").suggested).toBe(true);
    expect(canTransition("in_progress", "implemented").suggested).toBe(true);
  });

  it("refuses a state that does not exist", () => {
    expect(canTransition("open", "invented").allowed).toBe(false);
  });

  it("allows anything from an unknown current state, rather than trapping the row", () => {
    expect(canTransition("legacy_value", "open").allowed).toBe(true);
  });
});

describe("requirementsFor", () => {
  it("keeps the mandatory dismissal reason", () => {
    expect(requirementsFor("dismissed", {}).ok).toBe(false);
    expect(requirementsFor("dismissed", { reason: "Not applicable" }).ok).toBe(true);
  });

  it("🔴 validation needs the audit that re-measured it", () => {
    // Without it, `validated` is a second word for `implemented`: a claim by
    // the person who did the work rather than a measurement.
    const r = requirementsFor("validated", {});
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatch(/re-measured/i);
    expect(requirementsFor("validated", { validatedByAuditId: "aud-1" }).ok).toBe(true);
  });

  it("assigning needs somebody to assign to", () => {
    expect(requirementsFor("assigned", {}).ok).toBe(false);
    expect(requirementsFor("assigned", { assignee: "u1" }).ok).toBe(true);
  });

  it("applies the `done` alias's requirements, not a separate set", () => {
    expect(requirementsFor("done", {}).ok).toBe(true);
    expect(requirementsFor("implemented", {}).ok).toBe(true);
  });

  it("asks nothing of the ordinary states", () => {
    for (const id of ["open", "accepted", "in_progress", "validation_scheduled"]) {
      expect(requirementsFor(id, {}).ok, id).toBe(true);
    }
  });
});

describe("groupByState", () => {
  it("folds the alias into one column rather than two", () => {
    const g = groupByState([{ status: "done" }, { status: "implemented" }]);
    expect(g.implemented).toHaveLength(2);
    expect(g.done).toBeUndefined();
  });

  it("puts an unrecognised status in `open` rather than losing the row", () => {
    const g = groupByState([{ status: "legacy" }]);
    expect(g.open).toHaveLength(1);
  });
});

describe("overdue", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const past = "2026-09-01T00:00:00Z";

  it("finds work past its date that still needs doing", () => {
    expect(overdue([{ due_at: past, status: "in_progress" }], now)).toHaveLength(1);
  });

  it("🔴 does not nag about work that is finished or declined", () => {
    // An overdue list that keeps shouting about done items is one people stop
    // reading.
    expect(overdue([
      { due_at: past, status: "validated" },
      { due_at: past, status: "dismissed" },
      { due_at: past, status: "done" },
    ], now)).toHaveLength(0);
  });

  it("ignores items with no date, which is the default", () => {
    expect(overdue([{ status: "open" }], now)).toHaveLength(0);
  });
});
