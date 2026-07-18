// netlify/functions/reengagement.test.js — F49 (re-engagement emails).
//
// We test the pure helpers and email-template rendering; the HTTP
// handler is exercised via fetch-mock in the surrounding integration
// tests. The handler is intentionally small.

import { describe, it, expect } from "vitest";
import {
  buildDigest,
  _internal,
} from "../functions/reengagement.js";
const { digestHtml, reengagementHtml, isMonday, isOlderThan, getISOWeek, escapeHtml } = _internal;

describe("buildDigest (F49)", () => {
  it("returns zeros for empty rows", () => {
    const d = buildDigest([]);
    expect(d.runCount).toBe(0);
    expect(d.changeCount).toBe(0);
    expect(d.errorCount).toBe(0);
    expect(d.topSchedule).toBeNull();
  });

  it("aggregates runCount across all rows", () => {
    const d = buildDigest([
      { id: "a", data: { label: "X", runCount: 3, lastStatus: "unchanged" } },
      { id: "b", data: { label: "Y", runCount: 5, lastStatus: "unchanged" } },
    ]);
    expect(d.runCount).toBe(8);
  });

  it("counts changed and error statuses", () => {
    const d = buildDigest([
      { id: "a", data: { runCount: 1, lastStatus: "changed" } },
      { id: "b", data: { runCount: 1, lastStatus: "error" } },
      { id: "c", data: { runCount: 1, lastStatus: "unchanged" } },
    ]);
    expect(d.changeCount).toBe(1);
    expect(d.errorCount).toBe(1);
  });

  it("picks the most-active schedule as topSchedule", () => {
    const d = buildDigest([
      { id: "a", data: { label: "Quiet", runCount: 1 } },
      { id: "b", data: { label: "Busy", runCount: 12 } },
    ]);
    expect(d.topSchedule.label).toBe("Busy");
    expect(d.topSchedule.runs).toBe(12);
  });
});

describe("digestHtml (F49)", () => {
  it("escapes HTML in the top schedule label", () => {
    const html = digestHtml({
      userName: "Alice",
      runCount: 5,
      changeCount: 1,
      errorCount: 0,
      topSchedule: { label: "<script>alert(1)</script>", runs: 5 },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes all the metrics in the rendered HTML", () => {
    const html = digestHtml({
      userName: "Bob",
      runCount: 3,
      changeCount: 1,
      errorCount: 0,
      topSchedule: { label: "Stripe", runs: 3 },
    });
    expect(html).toMatch(/3/);
    expect(html).toMatch(/Stripe/);
  });
});

describe("reengagementHtml (F49)", () => {
  it("escapes the user name", () => {
    const html = reengagementHtml({ userName: "<b>you</b>", lastSeen: "2026-07-10" });
    expect(html).not.toContain("<b>you</b>");
    expect(html).toContain("&lt;b&gt;you&lt;/b&gt;");
  });

  it("links to the workspace deep link", () => {
    const html = reengagementHtml({ userName: "Alice", lastSeen: "2026-07-10" });
    expect(html).toMatch(/\/workspace/);
  });
});

describe("isMonday (F49)", () => {
  it("returns true for 2026-07-13 (a Monday)", () => {
    expect(isMonday("2026-07-13T12:00:00Z")).toBe(true);
  });

  it("returns false for 2026-07-14 (a Tuesday)", () => {
    expect(isMonday("2026-07-14T12:00:00Z")).toBe(false);
  });
});

describe("isOlderThan (F49)", () => {
  it("returns true for an ISO 8 days old", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isOlderThan(old, 7)).toBe(true);
  });

  it("returns false for an ISO 5 days old", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(isOlderThan(recent, 7)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isOlderThan(null, 7)).toBe(false);
  });
});

describe("getISOWeek (F49)", () => {
  it("returns the right week for 2026-07-13 (Monday, week 29)", () => {
    const d = new Date("2026-07-13T00:00:00Z");
    expect(getISOWeek(d)).toBe(29);
  });

  it("returns 1 for 2026-01-01 (Thursday of week 1)", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(getISOWeek(d)).toBe(1);
  });
});

describe("escapeHtml (F49)", () => {
  it("escapes the 5 dangerous characters", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
