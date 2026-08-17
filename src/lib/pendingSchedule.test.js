// pendingSchedule.test.js — the stash that survives an OAuth round-trip.
//
// A signed-out user who builds a schedule can't have it saved (see
// schedulerService's shouldFallback comment: a local-only schedule never runs).
// So the schedule is stashed, the user is sent to sign in, and
// PendingScheduleFlush saves it for real on the way back. sessionStorage rather
// than a module variable specifically because OAuth navigates the document away
// and back, which would discard anything held in memory.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setPendingSchedule,
  peekPendingSchedule,
  takePendingSchedule,
  clearPendingSchedule,
} from "./pendingSchedule.js";

const schedule = { id: "sch_1", type: "track", target: "https://example.com", label: "Track it" };

beforeEach(() => {
  sessionStorage.clear();
});

describe("pendingSchedule", () => {
  it("round-trips a schedule", () => {
    expect(setPendingSchedule(schedule)).toBe(true);
    expect(peekPendingSchedule()).toEqual(schedule);
  });

  it("survives a simulated document navigation (sessionStorage, not memory)", () => {
    setPendingSchedule(schedule);
    // A module reload is what an OAuth redirect effectively does to in-memory state.
    vi.resetModules();
    expect(JSON.parse(sessionStorage.getItem("datiq.pendingSchedule")).schedule).toEqual(schedule);
  });

  it("peek leaves it in place; take consumes it", () => {
    setPendingSchedule(schedule);
    expect(peekPendingSchedule()).toEqual(schedule);
    expect(peekPendingSchedule()).toEqual(schedule);
    expect(takePendingSchedule()).toEqual(schedule);
    expect(peekPendingSchedule()).toBeNull();
  });

  it("take is safe to call when nothing is stashed", () => {
    expect(takePendingSchedule()).toBeNull();
  });

  it("clear removes it", () => {
    setPendingSchedule(schedule);
    clearPendingSchedule();
    expect(peekPendingSchedule()).toBeNull();
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    sessionStorage.setItem("datiq.pendingSchedule", "{not json");
    expect(peekPendingSchedule()).toBeNull();
  });

  it("reports failure when storage is unavailable, so the caller can degrade", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(setPendingSchedule(schedule)).toBe(false);
    spy.mockRestore();
  });
});
