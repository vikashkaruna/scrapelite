#!/usr/bin/env node
/**
 * scripts/build-run-all.mjs — regenerate supabase/migrations/run-all.sql.
 *
 * WHY THIS EXISTS
 * run-all.sql is the "paste one file into the Supabase SQL Editor" bootstrap
 * path, and it was maintained by hand. It drifted: its own ORDER MATTERS header
 * listed 0001–0011, but the file only ever contained 0001–0009, so every fresh
 * database bootstrapped that way silently lacked rate_limit_log and
 * reengagement_log. Hand-maintaining a concatenation of N files is a bug
 * generator, so it is now generated.
 *
 * `npm run build:sql` regenerates it; `--check` verifies it is current (for CI).
 *
 * Note scripts/migrate-prod.mjs reads the numbered files directly and skips
 * run-all.sql, so the migrator path was never affected by the drift — only the
 * documented copy-paste path was.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "supabase", "migrations");
const OUT = join(DIR, "run-all.sql");
const SKIP = new Set(["run-all.sql", "rollback.sql"]);

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !SKIP.has(f))
  .sort(); // lexical order == dependency order, same rule migrate-prod.mjs uses

/** First non-empty comment line of a migration, for the ORDER MATTERS index. */
function summarize(sql) {
  for (const line of sql.split("\n")) {
    const m = line.match(/^--\s*(?:scripts\/\S+\s+—\s+)?(.+)$/);
    if (m && m[1].trim() && !/^=+$/.test(m[1].trim())) return m[1].trim();
  }
  return "";
}

const bodies = files.map((f) => ({ f, sql: readFileSync(join(DIR, f), "utf8") }));

const index = bodies
  .map(({ f, sql }) => `--   ${f.slice(0, 4)}  ${summarize(sql).slice(0, 88).trimEnd()}`)
  .join("\n");

const header = `-- supabase/migrations/run-all.sql
-- ============================================================================
-- DatIQ — Production migration orchestrator (single-file variant)
-- ============================================================================
--
-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate with:  npm run build:sql
-- Verify in CI with: npm run build:sql -- --check
--
-- Paste this file in the Supabase SQL Editor → New query → Run.
-- It is the concatenation of every numbered migration in this directory, in
-- lexical (== dependency) order. Every script is idempotent
-- (IF NOT EXISTS / OR REPLACE), so it is safe to re-run on a fresh or
-- partially-migrated database.
--
-- ORDER MATTERS:
${index}
--
-- Individual files are also committed for source control. If you prefer to run
-- them one at a time, paste each numbered file separately in the order above.
--
-- VERIFY: see README.md §3 for the list of tables that should exist after.
-- ROLLBACK: see rollback.sql for a destructive rollback (DESTRUCTIVE).
`;

const out =
  header +
  bodies
    .map(
      ({ f, sql }) =>
        `\n\n-- ============================================================\n` +
        `-- ${f}\n` +
        `-- ============================================================\n` +
        sql.trimEnd(),
    )
    .join("\n") +
  `\n\n-- Final: refresh the PostgREST schema cache so the API picks up new tables/RPCs immediately.\nNOTIFY pgrst, 'reload schema';\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== out) {
    console.error(
      "run-all.sql is stale. Run `npm run build:sql` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`run-all.sql is up to date (${files.length} migrations).`);
} else {
  writeFileSync(OUT, out);
  console.log(`Wrote run-all.sql from ${files.length} migrations:`);
  for (const f of files) console.log(`  ${f}`);
}
