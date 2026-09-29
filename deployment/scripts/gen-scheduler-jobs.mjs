#!/usr/bin/env node
// gen-scheduler-jobs.mjs — renders the Cloud Scheduler job set from the single
// source of truth (netlify.toml [functions."name"] schedule blocks — the same
// parser shape gen-routes-manifest.mjs uses). Output: scheduler.json consumed
// by deploy-scheduler.sh. Names/schedules carry no literals (doc 06): the job
// name is composed from SCH_NAME_PREFIX and the function name at deploy time.
//
// Netlify @hourly → "0 * * * *"; @daily → "0 ${DAILY_HOUR_UTC} * * *" (the
// local cron-sim staggers dailies the same way so they don't share one tick).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

function argOf(k, d) {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
}

const toml = readFileSync(resolve(argOf("--toml", resolve(REPO, "netlify.toml"))), "utf8");
const outPath = resolve(argOf("--out", resolve(REPO, "deployment/generated/gcp/scheduler.json")));
const DAILY_HOUR = Number(argOf("--daily-hour-utc", process.env.DAILY_HOUR_UTC || "3"));

// [functions."name"] blocks in netlify.toml == the scheduled (cron) functions.
const jobs = [];
for (const block of toml.split(/\[functions\."/).slice(1)) {
  const name = /^([^"]+)"\]/.exec(block)?.[1];
  const schedule = /^\s*schedule\s*=\s*"([^"]+)"/m.exec(block)?.[1];
  if (!name || !schedule) continue;
  let cron;
  if (schedule === "@hourly") cron = "0 * * * *";
  else if (schedule === "@daily") cron = `0 ${DAILY_HOUR} * * *`;
  else if (schedule === "@weekly") cron = `0 ${DAILY_HOUR} * * 0`;
  else cron = schedule; // 5-field cron passes through 1:1
  jobs.push({ name, schedule, cron });
}

if (jobs.length === 0) {
  console.error("✗ gen-scheduler-jobs: no scheduled functions found in netlify.toml");
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generatedFrom: "netlify.toml", jobs }, null, 2) + "\n");
console.log(`✓ gen-scheduler-jobs: ${jobs.length} jobs → ${outPath}`);
