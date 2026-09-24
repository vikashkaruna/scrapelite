#!/usr/bin/env node
// scripts/verify-workflow-rls.mjs
//
// Confirms that migration 0044 is actually applied to a LIVE Supabase project,
// by doing the thing an attacker would do: an anonymous PostgREST read of every
// Phase 4-6 table using nothing but the publishable anon key.
//
// This exists because `npm run test:db` proves the migration is correct against
// WASM Postgres, and proves nothing about whether anyone ran it. Migrations in
// this repo are applied by hand, so "the SQL is right" and "the database is
// safe" are two different claims and only this script checks the second.
//
// Expected AFTER 0044:  every table → 401 (or 404). Exit 0.
// Expected BEFORE 0044: every table → 200 with real rows. Exit 1.
//
// Read-only by construction: it only ever issues `select=id&limit=1`.
//
// Usage:
//   node scripts/verify-workflow-rls.mjs                    # staging, key read from runtime-config.js
//   node scripts/verify-workflow-rls.mjs --prod             # production project
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/verify-workflow-rls.mjs

import { readFileSync } from "node:fs";
import { postgrestAnswer } from "./lib/postgrestAnswer.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every table 0041-0043 created, plus the Prospect Engagement Engine's
// (0081, 0082). A table missing from this list is a table nobody is checking,
// so keep it in step with the migrations.
const TABLES = [
  "lists", "canonical_entities", "list_records", "icp_score_rules",
  "enrichment_jobs", "enrichment_job_items", "review_queue",
  "watchlists", "watchlist_targets", "monitored_pages", "entity_snapshots",
  "field_changes", "change_feedback",
  "signal_rules", "rule_executions",
  // 0081 / 0082 — these hold prospects' names, emails and phone numbers.
  "engagement_campaigns", "engagement_prospects", "engagement_messages",
  "engagement_activity_log", "engagement_sync_configs", "engagement_suppressions",
  "account_brand_kits",
  // 0085 — which rules listen to which lists / watchlists.
  "signal_rule_sources",
];

const wantProd = process.argv.includes("--prod");

/** Pull the project URL and its paired anon key out of the committed runtime config. */
function fromRuntimeConfig() {
  const s = readFileSync(join(ROOT, "public/runtime-config.js"), "utf8");
  const urls = [...s.matchAll(/"(https:\/\/[a-z0-9]+\.supabase\.co)"/g)].map((m) => m[1]);
  const i = s.indexOf("supabaseAnonKey:");
  const keys = [...s.slice(i, i + 2500).matchAll(
    /(sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_.-]{60,})/g
  )].map((m) => m[1]);
  // runtime-config picks by `_isMain ? production : staging`, so index 0 is
  // production and index 1 is staging in BOTH lists.
  const idx = wantProd ? 0 : 1;
  return { url: urls[idx], key: keys[idx] };
}

const url = process.env.SUPABASE_URL || fromRuntimeConfig().url;
const key = process.env.SUPABASE_ANON_KEY || fromRuntimeConfig().key;

if (!url || !key) {
  console.error("Could not resolve a Supabase URL and anon key.");
  process.exit(2);
}

const label = wantProd ? "PRODUCTION" : "STAGING";
console.log(`\n[verify-workflow-rls] ${label} · ${url}`);
console.log("Anonymous PostgREST read with the public anon key. 401/404 = locked down.\n");

let exposed = 0;
let unreachable = 0;
let absent = 0;

for (const t of TABLES) {
  let res = null;
  try {
    const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(20_000),
    });
    res = { status: r.status, headers: r.headers, text: await r.text() };
  } catch (e) {
    unreachable += 1;
    console.log(`  ?  ${t.padEnd(22)} network error: ${e.message}`);
    continue;
  }

  // 🔴 A REFUSAL IS EVIDENCE ONLY IF POSTGREST WROTE IT. Behind an egress proxy
  // that allow-lists hosts, every request is answered 403 by the PROXY before it
  // reaches Supabase — and counting those as refusals printed "0044 is applied"
  // from a machine that had never contacted the project. See lib/postgrestAnswer.mjs.
  const { fromPostgrest, reason } = postgrestAnswer(res);
  if (!fromPostgrest) {
    unreachable += 1;
    console.log(`  ?  ${t.padEnd(22)} INCONCLUSIVE — ${reason}`);
    continue;
  }

  // A table that does not exist is not a table that refuses reads. Before a
  // migration is applied PostgREST answers 404 (PGRST205), and counting that as
  // a pass would report "all N tables refuse anonymous reads" for tables that
  // are not there to check.
  if (res.status === 404 && /PGRST205|schema cache|does not exist/i.test(res.text)) {
    absent += 1;
    console.log(`  –  ${t.padEnd(22)} not present on this project (migration not applied) — not checked`);
    continue;
  }

  if (res.status === 200) {
    exposed += 1;
    console.log(`  ✗  ${t.padEnd(22)} HTTP 200 — READABLE BY ANYONE`);
  } else {
    console.log(`  ✓  ${t.padEnd(22)} HTTP ${res.status}`);
  }
}

console.log("\n" + "─".repeat(62));

if (unreachable > 0) {
  // Not evidence of safety. Saying "locked down" on the strength of answers that
  // never came from the database would be the fail-open mistake this whole fix
  // is about, one level up — so ANY inconclusive table makes the run
  // inconclusive, not just all of them.
  console.log(
    `[verify-workflow-rls] INCONCLUSIVE — ${unreachable}/${TABLES.length} probe(s) never reached the project.\n` +
    `Run this from a network that can reach ${url} before concluding anything about RLS.`
  );
  process.exit(2);
}

if (exposed > 0) {
  console.log(
    `[verify-workflow-rls] ${exposed}/${TABLES.length} tables are readable anonymously.\n` +
    `Migration 0044_lock_down_workflow_rls.sql has NOT been applied to this project.\n` +
    `Apply it before anything else — see docs/WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md §S1.`
  );
  process.exit(1);
}

const checked = TABLES.length - absent;
console.log(`[verify-workflow-rls] All ${checked} present tables refuse anonymous reads. 0044 is applied.`);
if (absent > 0) {
  console.log(`[verify-workflow-rls] ${absent} table(s) are not on this project yet and were NOT checked — re-run after applying their migration.`);
}
process.exit(0);
