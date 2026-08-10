import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRESET_KEY,
  SCHEDULE_PRESETS,
  applyEdits,
  buildCron,
  buildSchedule,
  cadenceLabel,
  describeCron,
  estimateNextRun,
  listSchedules,
  listSchedulesLocal,
  presetByKey,
  recordRun,
  saveSchedule,
  toggleSchedule,
} from "./schedulerService.js";
import { apiClient } from "./apiClient.js";

/**
 * U-33..37 — schedulerService is the client-side half of the
 * "recurring extraction" feature. The server (scheduled-runner.js) is
 * the execution side; this module is the composer/editor state plus a
 * local-first persistence layer.
 */

vi.mock("./apiClient.js", () => ({
  apiClient: {
    listSchedules: vi.fn(async () => {
      throw { status: 503, useLocalStorage: true };
    }),
    upsertSchedule: vi.fn(async () => null),
    deleteSchedule: vi.fn(async () => null),
  },
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildCron (U-33, U-34)", () => {
  it("hourly with everyHours=6 → 0 */6 * * *", () => {
    expect(buildCron({ frequency: "hourly", everyHours: 6 })).toBe("0 */6 * * *");
  });

  it("hourly with everyHours=2 → 0 */2 * * *", () => {
    expect(buildCron({ frequency: "hourly", everyHours: 2 })).toBe("0 */2 * * *");
  });

  it("daily → '0 9 * * *' with default hour=9 minute=0", () => {
    expect(buildCron({ frequency: "daily" })).toBe("0 9 * * *");
  });

  it("weekday → '0 9 * * 1-5'", () => {
    expect(buildCron({ frequency: "weekday", hour: 9, minute: 0 })).toBe("0 9 * * 1-5");
  });

  it("weekly with weekday=3 → '0 9 * * 3'", () => {
    expect(buildCron({ frequency: "weekly", hour: 9, minute: 0, weekday: 3 })).toBe("0 9 * * 3");
  });

  it("monthly with dayOfMonth=15 → '0 9 15 * *'", () => {
    expect(buildCron({ frequency: "monthly", hour: 9, minute: 0, dayOfMonth: 15 })).toBe("0 9 15 * *");
  });

  it("clamps dayOfMonth to 1–28 to be cron-safe", () => {
    expect(buildCron({ frequency: "monthly", dayOfMonth: 30 })).toBe("0 9 28 * *");
  });

  it("respects explicit minute / hour overrides", () => {
    expect(buildCron({ frequency: "daily", hour: 21, minute: 30 })).toBe("30 21 * * *");
  });
});

describe("buildSchedule cap (U-35)", () => {
  it("the 51st schedule is rejected", async () => {
    for (let i = 0; i < 50; i += 1) {
      const s = buildSchedule({
        type: "track",
        target: `https://example.com/${i}`,
        cadenceKey: "daily",
      });
      await saveSchedule(s);
    }
    expect(listSchedulesLocal().length).toBe(50);

    const extra = buildSchedule({
      type: "track",
      target: "https://example.com/extra",
      cadenceKey: "daily",
    });
    await expect(saveSchedule(extra)).rejects.toThrow(/Schedule limit reached/);
    expect(listSchedulesLocal().length).toBe(50);
  });
});

describe("presetByKey (U-36)", () => {
  it("returns the daily preset for 'daily'", () => {
    const p = presetByKey("daily");
    expect(p.cron).toBe("0 9 * * *");
  });

  it("falls back to default preset for unknown key", () => {
    const p = presetByKey("nope");
    expect(p.cron).toBe(presetByKey(DEFAULT_PRESET_KEY).cron);
  });

  it("SCHEDULE_PRESETS has 6 entries (6h, 12h, daily, weekday, weekly, monthly)", () => {
    expect(SCHEDULE_PRESETS.length).toBe(6);
  });
});

describe("localStorage fallback (U-37)", () => {
  it("listSchedules returns [] when localStorage is corrupt", async () => {
    localStorage.setItem("datiq.schedules", "{not valid json}");
    const list = await listSchedulesLocal();
    expect(list).toEqual([]);
  });

  it("listSchedules returns [] when no key is set", () => {
    expect(listSchedulesLocal()).toEqual([]);
  });
});

describe("listSchedules() server merge (2026-08-11 bug fix)", () => {
  // The bug: listSchedules() called writeLocal(remote) unconditionally,
  // so when the server returned [] (e.g. transient hiccup, user has
  // unsynced local items, fresh Supabase project with no rows), the
  // localStorage cache was wiped. The user then saw "No schedules yet"
  // even though they had schedules in localStorage from a prior session.
  //
  // The fix: when the server returns [] but localStorage has items, the
  // local items are returned and NOT overwritten. When the server returns
  // a non-empty array, the local-only items (any with no server
  // counterpart) are preserved alongside the server data.

  it("server returns [] but local has items → keep local, do not wipe", async () => {
    const local = [{
      id: "sch_local1",
      type: "track",
      target: "https://local.com",
      label: "Local only",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    localStorage.setItem("datiq.schedules", JSON.stringify(local));
    apiClient.listSchedules.mockResolvedValueOnce([]);
    const result = await listSchedules();
    expect(result).toEqual(local);
    // localStorage is preserved (not wiped to [])
    expect(JSON.parse(localStorage.getItem("datiq.schedules"))).toEqual(local);
  });

  it("server returns items + local has matching items → server wins, no duplicates", async () => {
    const local = [{
      id: "sch_a",
      type: "track",
      target: "https://a.com",
      label: "A",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    localStorage.setItem("datiq.schedules", JSON.stringify(local));
    const server = [{
      id: "sch_a",
      type: "track",
      target: "https://a.com",
      label: "A (server)",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    apiClient.listSchedules.mockResolvedValueOnce(server);
    const result = await listSchedules();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("A (server)"); // server version
  });

  it("server returns items + local has UNmatched items → both are kept (merge)", async () => {
    const local = [{
      id: "sch_local_only",
      type: "track",
      target: "https://local-only.com",
      label: "Local only",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    localStorage.setItem("datiq.schedules", JSON.stringify(local));
    const server = [{
      id: "sch_server1",
      type: "track",
      target: "https://server.com",
      label: "Server",
      cadenceKey: "weekly",
      cron: "0 9 * * 1",
      status: "active",
      createdAt: "2026-08-05T00:00:00.000Z",
    }];
    apiClient.listSchedules.mockResolvedValueOnce(server);
    const result = await listSchedules();
    // Both items are present (server + local-only).
    expect(result.map((s) => s.id).sort()).toEqual(["sch_local_only", "sch_server1"]);
    // Persisted state is the merged set (so the local-only item is
    // re-pushed on the next mutation).
    const persisted = JSON.parse(localStorage.getItem("datiq.schedules"));
    expect(persisted.map((s) => s.id).sort()).toEqual(["sch_local_only", "sch_server1"]);
  });

  it("server returns items, local is empty → use server, persist", async () => {
    localStorage.clear();
    const server = [{
      id: "sch_server1",
      type: "track",
      target: "https://server.com",
      label: "Server",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    apiClient.listSchedules.mockResolvedValueOnce(server);
    const result = await listSchedules();
    expect(result).toEqual(server);
    expect(JSON.parse(localStorage.getItem("datiq.schedules"))).toEqual(server);
  });

  it("server errors → fall back to local without modification", async () => {
    const local = [{
      id: "sch_local1",
      type: "track",
      target: "https://local.com",
      label: "Local only",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }];
    localStorage.setItem("datiq.schedules", JSON.stringify(local));
    apiClient.listSchedules.mockRejectedValueOnce({ status: 503, useLocalStorage: true });
    const result = await listSchedules();
    expect(result).toEqual(local);
  });
});

describe("saveSchedule — real rejection vs infra fallback", () => {
  it("a 5xx/network-shaped error still saves locally (infra fallback)", async () => {
    apiClient.upsertSchedule.mockRejectedValueOnce({ status: 503, useLocalStorage: true });
    const s = buildSchedule({ type: "track", target: "https://example.com/a", cadenceKey: "daily" });
    await expect(saveSchedule(s)).resolves.toBeTruthy();
    expect(listSchedulesLocal().some((x) => x.id === s.id)).toBe(true);
  });

  it("a 502 Bad Gateway (e.g. local dev proxy with no netlify functions running) also falls back to local-only save (regression: this was NOT in the fallback set, so schedule creation failed outright with 'Bad Gateway' in local dev)", async () => {
    const gatewayErr = new Error("Bad Gateway");
    gatewayErr.status = 502;
    apiClient.upsertSchedule.mockRejectedValueOnce(gatewayErr);
    const s = buildSchedule({ type: "track", target: "https://example.com/gw", cadenceKey: "daily" });
    await expect(saveSchedule(s)).resolves.toBeTruthy();
    expect(listSchedulesLocal().some((x) => x.id === s.id)).toBe(true);
  });

  it("a 504 Gateway Timeout also falls back to local-only save", async () => {
    const timeoutErr = new Error("Gateway Timeout");
    timeoutErr.status = 504;
    apiClient.upsertSchedule.mockRejectedValueOnce(timeoutErr);
    const s = buildSchedule({ type: "track", target: "https://example.com/gt", cadenceKey: "daily" });
    await expect(saveSchedule(s)).resolves.toBeTruthy();
    expect(listSchedulesLocal().some((x) => x.id === s.id)).toBe(true);
  });

  it("a 402 entitlement denial (e.g. plan doesn't include scheduling) rolls back the optimistic local write and surfaces the real message (regression: previously showed a generic 'couldn't save' error even though the schedule was silently orphaned in localStorage)", async () => {
    const denyErr = new Error("Scheduled monitoring is not available on your current plan. Upgrade to Pro to schedule recurring runs.");
    denyErr.status = 402;
    apiClient.upsertSchedule.mockRejectedValueOnce(denyErr);
    const s = buildSchedule({ type: "track", target: "https://example.com/b", cadenceKey: "daily" });
    await expect(saveSchedule(s)).rejects.toThrow(/Scheduled monitoring is not available/);
    expect(listSchedulesLocal().some((x) => x.id === s.id)).toBe(false);
  });

  it("a real rejection on an EDIT restores the prior version rather than deleting it", async () => {
    const s = buildSchedule({ type: "track", target: "https://example.com/c", cadenceKey: "daily" });
    await saveSchedule(s); // succeeds (default mock resolves null)
    const edited = applyEdits(s, { cadenceKey: "weekly", cron: "0 9 * * 1" });
    const denyErr = new Error("Denied.");
    denyErr.status = 402;
    apiClient.upsertSchedule.mockRejectedValueOnce(denyErr);
    await expect(saveSchedule(edited)).rejects.toThrow(/Denied/);
    const stored = listSchedulesLocal().find((x) => x.id === s.id);
    expect(stored).toBeTruthy();
    expect(stored.cadenceKey).toBe("daily"); // NOT "weekly" — edit was rolled back
  });
});

describe("describeCron + cadenceLabel + estimateNextRun", () => {
  it("describeCron renders the canonical English for each shape", () => {
    expect(describeCron("0 9 * * *")).toMatch(/Daily/);
    expect(describeCron("0 9 * * 1-5")).toMatch(/Every weekday/);
    expect(describeCron("0 9 * * 1")).toMatch(/Mon/);
    expect(describeCron("0 9 1 * *")).toMatch(/Monthly/);
    expect(describeCron("0 */6 * * *")).toMatch(/Every 6 hours/);
  });

  it("cadenceLabel prefers the preset's human label when the key matches", () => {
    const s = { cadenceKey: "daily", cron: "0 9 * * *" };
    expect(cadenceLabel(s)).toBe("Daily");
  });

  it("estimateNextRun returns a forward-looking ISO timestamp", () => {
    const from = new Date("2026-07-15T08:00:00.000Z");
    const next = estimateNextRun("0 9 * * *", from);
    const nextDate = new Date(next);
    expect(nextDate.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe("applyEdits + recordRun (change detection)", () => {
  it("applyEdits recomputes nextRunAt when cron changes", () => {
    const s = buildSchedule({
      type: "track",
      target: "https://example.com",
      cadenceKey: "daily",
    });
    const before = s.nextRunAt;
    const edited = applyEdits(s, { cron: "0 */2 * * *" });
    expect(edited.cron).toBe("0 */2 * * *");
    // nextRunAt is a fresh estimate; we don't assert it changed exactly
    // because estimateNextRun is wall-clock, but it must be set.
    expect(edited.nextRunAt).toBeTruthy();
    expect(before).toBeTruthy();
  });

  it("recordRun sets lastStatus='changed' when content hash differs", async () => {
    const s = buildSchedule({
      type: "track",
      target: "https://example.com",
      cadenceKey: "daily",
    });
    await saveSchedule(s);
    recordRun(s.id, { content: "first content" });
    recordRun(s.id, { content: "second content" });
    const stored = listSchedulesLocal().find((x) => x.id === s.id);
    expect(stored.lastStatus).toBe("changed");
    expect(stored.runCount).toBe(2);
  });

  it("recordRun sets lastStatus='unchanged' when content is identical", async () => {
    const s = buildSchedule({
      type: "track",
      target: "https://example.com",
      cadenceKey: "daily",
    });
    await saveSchedule(s);
    recordRun(s.id, { content: "same content" });
    recordRun(s.id, { content: "same content" });
    const stored = listSchedulesLocal().find((x) => x.id === s.id);
    expect(stored.lastStatus).toBe("unchanged");
  });

  it("recordRun sets lastStatus='error' when given an error", async () => {
    const s = buildSchedule({
      type: "track",
      target: "https://example.com",
      cadenceKey: "daily",
    });
    await saveSchedule(s);
    recordRun(s.id, { error: "scrape failed" });
    const stored = listSchedulesLocal().find((x) => x.id === s.id);
    expect(stored.lastStatus).toBe("error");
  });
});

describe("toggleSchedule", () => {
  it("toggles active ↔ paused", async () => {
    const s = buildSchedule({
      type: "track",
      target: "https://example.com",
      cadenceKey: "daily",
    });
    await saveSchedule(s);
    expect(listSchedulesLocal()[0].status).toBe("active");
    await toggleSchedule(s.id);
    expect(listSchedulesLocal()[0].status).toBe("paused");
    await toggleSchedule(s.id);
    expect(listSchedulesLocal()[0].status).toBe("active");
  });
});
