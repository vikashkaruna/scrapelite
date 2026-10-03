#!/usr/bin/env node
// deployment/adapter/jobs-cron-sim.mjs — local Cloud Scheduler stand-in.
// Fires the 13 scheduled functions on their netlify.toml schedules against the
// jobs service, with the same token the jobs service requires (the local
// equivalent of Cloud Scheduler's OIDC ID token on GCP).
//
// Schedules come from SCHEDULES_JSON (5-field cron per job). Default below
// mirrors netlify.toml 1:1: hourly ×3, */5 ×5, daily ×5 (DAILY_HOUR_UTC staggers
// the dailies so they don't all fire on the same tick).

import http from "node:http";

const JOBS_URL = (process.env.JOBS_URL || "http://jobs:8080").replace(/\/$/, "");
const TOKEN = process.env.JOBS_TOKEN || "";
const DAILY_HOUR = Number(process.env.DAILY_HOUR_UTC || 3);
const TICK_MS = Number(process.env.TICK_MS || 30_000);

const DEFAULT_SCHEDULES = {
  "scheduled-runner": "0 * * * *",
  "health-monitor": "0 * * * *",
  "watchlist-monitor": "0 * * * *",
  "bulk-runner": "*/5 * * * *",
  "engagement-dispatcher": "*/5 * * * *",
  "signal-retry": "*/5 * * * *",
  "workflow-orchestrator-cron": "*/5 * * * *",
  "sxo-analytics-import-worker": "*/5 * * * *",
  "reengagement": `0 ${DAILY_HOUR} * * *`,
  "billing-lifecycle": `0 ${DAILY_HOUR} * * *`,
  "billing-purge": `0 ${DAILY_HOUR + 1} * * *`,
  "discoverability-monitor": `0 ${DAILY_HOUR + 1} * * *`,
  "prompt-monitor": `0 ${DAILY_HOUR + 2} * * *`,
};
const schedules = process.env.SCHEDULES_JSON ? JSON.parse(process.env.SCHEDULES_JSON) : DEFAULT_SCHEDULES;

function fieldMatches(field, value) {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) return value % Number(part.slice(2)) === 0;
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      return value >= a && value <= b;
    }
    return Number(part) === value;
  });
}

function due(cron, now) {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  // Local granularity: day-of-month / month / day-of-week are only honoured as
  // "*" (all local jobs use "* * *" there — the sim is a rehearsal, not a
  // scheduler implementation).
  if (dom !== "*" || mon !== "*" || dow !== "*") return false;
  return fieldMatches(min, now.getMinutes()) && fieldMatches(hour, now.getHours());
}

const lastFired = new Map(); // `${name}@${minuteSlot}` → true

async function fire(name) {
  const res = await fetch(`${JOBS_URL}/run/${name}`, {
    method: "POST",
    headers: { "x-datiq-cron-token": TOKEN, "content-type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  console.log(`[cron-sim] ${new Date().toISOString()} ${name} → ${res.statusCode} ${text.slice(0, 160)}`);
}

console.log(`✓ cron-sim: ${Object.keys(schedules).length} jobs → ${JOBS_URL} (tick ${TICK_MS / 1000}s)`);

setInterval(() => {
  const now = new Date();
  const slot = `${now.getUTCHours()}:${now.getUTCMinutes()}`;
  for (const [name, cron] of Object.entries(schedules)) {
    const key = `${name}@${slot}`;
    if (lastFired.has(key)) continue;
    if (due(cron, now)) {
      lastFired.set(key, true);
      fire(name).catch((e) => console.error(`[cron-sim] ${name} failed:`, e?.message || e));
    }
  }
}, TICK_MS);
