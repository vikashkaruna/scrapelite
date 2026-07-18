// src/lib/watchlistDeltas.test.js — FC1 (Watchlist deltas pure logic).

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyDelta,
  summariseWatchlist,
  readLastVisitedAt,
  writeLastVisitedAt,
} from "./watchlistDeltas.js";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();
const ONE_DAY_AGO = NOW - 24 * 60 * 60 * 1000;
const ONE_HOUR_AGO = NOW - 60 * 60 * 1000;

// `NO` sentinel means "use undefined / null in the resulting schedule".
// Without this we can't override optional fields to nullish in a helper.
const NO = Symbol("no-default");
function sch(overrides = {}) {
  const lastRunAt = overrides.lastRunAt === NO
    ? undefined
    : (overrides.lastRunAt ?? new Date(ONE_HOUR_AGO).toISOString());
  const lastChangeAt = overrides.lastChangeAt === NO
    ? undefined
    : overrides.lastChangeAt;
  return {
    id: overrides.id ?? "sch-1",
    label: overrides.label ?? "Stripe pricing",
    target: overrides.target ?? "https://stripe.com/pricing",
    type: overrides.type ?? "single",
    lastRunAt,
    lastChangeAt,
    lastStatus: overrides.lastStatus ?? "unchanged",
    nextRunAt: overrides.nextRunAt,
  };
}

describe("classifyDelta (FC1)", () => {
  it("returns 'never_run' for schedules with no lastRunAt", () => {
    const r = classifyDelta(sch({ lastRunAt: NO }), new Date(ONE_DAY_AGO).toISOString());
    expect(r.kind).toBe("never_run");
  });

  it("returns 'changed_since_visit' when lastChangeAt is after the visit", () => {
    const r = classifyDelta(
      sch({ lastChangeAt: new Date(ONE_HOUR_AGO).toISOString(), lastStatus: "changed" }),
      new Date(ONE_DAY_AGO).toISOString(),
    );
    expect(r.kind).toBe("changed_since_visit");
  });

  it("returns 'ran_since_visit' when lastRunAt is after the visit but nothing changed", () => {
    const r = classifyDelta(
      sch({ lastRunAt: new Date(ONE_HOUR_AGO).toISOString(), lastStatus: "unchanged", lastChangeAt: null }),
      new Date(ONE_DAY_AGO).toISOString(),
    );
    expect(r.kind).toBe("ran_since_visit");
  });

  it("returns 'stale' when nothing has run since the visit", () => {
    const r = classifyDelta(
      sch({ lastRunAt: new Date(ONE_DAY_AGO).toISOString(), lastChangeAt: new Date(ONE_DAY_AGO).toISOString() }),
      new Date(ONE_HOUR_AGO).toISOString(),
    );
    expect(r.kind).toBe("stale");
  });

  it("returns 'unknown' for null schedule", () => {
    expect(classifyDelta(null).kind).toBe("unknown");
  });
});

describe("summariseWatchlist (FC1)", () => {
  it("returns zeros for empty input", () => {
    const s = summariseWatchlist([], null, NOW);
    expect(s.total).toBe(0);
    expect(s.changed).toBe(0);
    expect(s.rows).toEqual([]);
  });

  it("counts changed, unchanged, stale, neverRun", () => {
    const schedules = [
      sch({ id: "a", lastChangeAt: new Date(ONE_HOUR_AGO).toISOString(), lastStatus: "changed" }),
      sch({ id: "b", lastRunAt: new Date(ONE_HOUR_AGO).toISOString(), lastStatus: "unchanged", lastChangeAt: NO }),
      sch({ id: "c", lastRunAt: new Date(ONE_DAY_AGO).toISOString(), lastStatus: "unchanged" }),
      sch({ id: "d", lastRunAt: NO }),
    ];
    const s = summariseWatchlist(schedules, new Date(ONE_DAY_AGO).toISOString(), NOW);
    expect(s.total).toBe(4);
    expect(s.changed).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.neverRun).toBe(1);
  });

  it("sorts rows: changed first, then ran-since-visit, then stale, then never-run", () => {
    const schedules = [
      sch({ id: "never",   lastRunAt: NO }),
      sch({ id: "stale",    lastRunAt: new Date(ONE_DAY_AGO).toISOString() }),
      sch({ id: "ok",       lastRunAt: new Date(ONE_HOUR_AGO).toISOString(), lastChangeAt: NO }),
      sch({ id: "changed",  lastChangeAt: new Date(ONE_HOUR_AGO).toISOString(), lastStatus: "changed" }),
    ];
    const s = summariseWatchlist(schedules, new Date(ONE_DAY_AGO).toISOString(), NOW);
    expect(s.rows.map((r) => r.schedule.id)).toEqual(["changed", "ok", "stale", "never"]);
  });

  it("returns the earliest nextRunAt in the future as nextRunAt", () => {
    const schedules = [
      sch({ id: "a", nextRunAt: new Date(NOW + 60_000).toISOString() }),
      sch({ id: "b", nextRunAt: new Date(NOW + 30_000).toISOString() }),
      sch({ id: "c", nextRunAt: null }),
    ];
    const s = summariseWatchlist(schedules, null, NOW);
    expect(s.nextRunAt).toBe(new Date(NOW + 30_000).toISOString());
  });

  it("ignores past nextRunAt values", () => {
    const schedules = [
      sch({ id: "a", nextRunAt: new Date(NOW - 1000).toISOString() }),
    ];
    const s = summariseWatchlist(schedules, null, NOW);
    expect(s.nextRunAt).toBeNull();
  });
});

describe("readLastVisitedAt / writeLastVisitedAt (FC1)", () => {
  beforeEach(() => {
    try { localStorage.removeItem("datiq.workspaceLastVisitedAt"); } catch {}
  });

  it("writeLastVisitedAt persists the ISO string", () => {
    const iso = "2026-07-18T11:00:00Z";
    writeLastVisitedAt(iso);
    expect(readLastVisitedAt()).toBe(iso);
  });

  it("readLastVisitedAt returns null when nothing is stored", () => {
    expect(readLastVisitedAt()).toBeNull();
  });

  it("writeLastVisitedAt uses the current ISO when called with no arg", () => {
    const before = new Date().toISOString();
    const saved = writeLastVisitedAt();
    const after = new Date().toISOString();
    expect(saved >= before).toBe(true);
    expect(saved <= after).toBe(true);
  });
});
