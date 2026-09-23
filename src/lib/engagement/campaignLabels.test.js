// src/lib/engagement/campaignLabels.test.js
import { describe, it, expect } from "vitest";
import { campaignOptionLabel, findNameClash } from "./campaignLabels.js";

describe("campaignOptionLabel — one option, one campaign", () => {
  it("shows a unique name as-is", () => {
    const c = { id: "a1", name: "Q4", status: "active", created_at: "2026-09-01T10:00:00Z" };
    expect(campaignOptionLabel(c, [c])).toBe("Q4");
  });
  it("adds the creation date when two campaigns share a name", () => {
    const a = { id: "a1", name: "Q4", created_at: "2026-09-01T10:00:00Z" };
    const b = { id: "b2", name: "q4", created_at: "2026-09-10T10:00:00Z" };
    expect(campaignOptionLabel(a, [a, b])).toMatch(/^Q4 · created Sep 1, 2026$/);
    expect(campaignOptionLabel(b, [a, b])).toMatch(/created Sep 10, 2026$/);
  });
  it("adds a short id when even the date is shared", () => {
    const a = { id: "aaaaaa11", name: "Q4", created_at: "2026-09-01T10:00:00Z" };
    const b = { id: "bbbbbb22", name: "Q4", created_at: "2026-09-01T11:00:00Z" };
    expect(campaignOptionLabel(a, [a, b])).toMatch(/#aaaaaa$/);
    expect(campaignOptionLabel(b, [a, b])).toMatch(/#bbbbbb$/);
  });
  it("names a status other than active", () => {
    expect(campaignOptionLabel({ id: "a", name: "Old", status: "paused" }, [])).toBe("Old (paused)");
  });
});

describe("findNameClash", () => {
  const list = [{ id: "a", name: "Q4 Outreach" }];
  it("matches ignoring case and spacing, but not the campaign itself", () => {
    expect(findNameClash("  q4  outreach", list)?.id).toBe("a");
    expect(findNameClash("Q4 outreach", list, "a")).toBeNull();
    expect(findNameClash("", list)).toBeNull();
  });
});
