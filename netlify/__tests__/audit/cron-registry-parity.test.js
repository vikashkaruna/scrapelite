import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AUTOMATION_JOBS } from "../../../src/lib/monitoringModel.js";

// ── Why this test exists ───────────────────────────────────────────────────
// netlify.toml is the ONLY thing that schedules a function; the AUTOMATION_JOBS
// registry is only what the ops dashboard EXPECTS to see. The two are edited by
// hand in different files, and when they drift there is no build error and no
// runtime error — the job simply never fires, or fires with nobody watching.
//
// That is not hypothetical. Every cron in this repo sat unscheduled from R19
// until 2026-07-27 because each declared `export const config = { schedule }`
// inside the function, which is honoured only for v2 handlers, and nothing
// checked. Six months of billing lifecycle and dunning never ran, silently.
//
// This is the check that would have caught it in seconds.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const toml = readFileSync(resolve(ROOT, "netlify.toml"), "utf8");

const scheduled = [...toml.matchAll(
  /\[functions\."([a-z0-9-]+)"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/g,
)].map((m) => ({ id: m[1], schedule: m[2] }));

describe("cron registry ↔ netlify.toml parity", () => {
  it("netlify.toml actually declares some schedules", () => {
    // Guards the regex itself: if the toml format changes and this stops
    // matching, every assertion below would pass vacuously.
    expect(scheduled.length).toBeGreaterThanOrEqual(6);
  });

  it("every registered job is actually scheduled", () => {
    const missing = AUTOMATION_JOBS
      .filter((j) => !scheduled.some((s) => s.id === j.id))
      .map((j) => j.id);
    expect(missing, `registered in AUTOMATION_JOBS but never scheduled: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("every scheduled function is registered, so none runs unmonitored", () => {
    const unmonitored = scheduled
      .filter((s) => !AUTOMATION_JOBS.some((j) => j.id === s.id))
      .map((s) => s.id);
    expect(unmonitored, `scheduled in netlify.toml but absent from AUTOMATION_JOBS: ${unmonitored.join(", ")}`)
      .toEqual([]);
  });

  it("the cadences agree", () => {
    // A registry that says @hourly while the toml says @daily makes the
    // dashboard's "next run" and its stale-job detection quietly wrong.
    const drift = AUTOMATION_JOBS
      .map((j) => ({ id: j.id, registry: j.schedule, toml: scheduled.find((s) => s.id === j.id)?.schedule }))
      .filter((x) => x.toml && x.toml !== x.registry);
    expect(drift, `cadence drift: ${JSON.stringify(drift)}`).toEqual([]);
  });

  it("the discoverability monitor is scheduled daily and registered", () => {
    const entry = scheduled.find((s) => s.id === "discoverability-monitor");
    expect(entry).toBeDefined();
    expect(entry.schedule).toBe("@daily");
    const job = AUTOMATION_JOBS.find((j) => j.id === "discoverability-monitor");
    expect(job).toBeDefined();
    expect(job.destructive).toBe(false);
  });
});
