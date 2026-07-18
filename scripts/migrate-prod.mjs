#!/usr/bin/env node
//
// scripts/migrate-prod.mjs
//
// Production Supabase migration runner — Node-only, no psql required.
//
// Usage:
//   PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXX.supabase.co:5432/postgres" \
//     node scripts/migrate-prod.mjs
//
//   or (preferred):
//   npm run migrate:prod
//   npm run migrate:prod -- --dry-run
//   npm run migrate:prod -- --list
//   npm run migrate:prod -- --include=scripts/extra.sql
//
// What it does:
//   1. Connects to the prod Supabase via the direct connection (port 5432, SSL).
//   2. Auto-discovers every 00*.sql file in supabase/migrations/ in lexical order
//      (which equals dependency order: 0001 → 0011). Skips run-all.sql and
//      rollback.sql (run-all.sql is the master concatenated file; rollback.sql
//      is destructive).
//   3. Runs each file in its own transaction. On error, the transaction rolls
//      back, the script prints the failing file + the underlying error, and
//      exits non-zero. Subsequent files are not attempted.
//   4. All migrations are idempotent (IF NOT EXISTS / OR REPLACE) so re-running
//      is safe.
//
// Required env:
//   PROD_SUPABASE_DB_URL  — Supabase direct connection string.
//                            Get it from: Supabase → Project Settings → Database
//                            → Connection string → "Direct"

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// ── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIST_ONLY = args.includes("--list");
const INCLUDES = args
  .filter((a) => a.startsWith("--include="))
  .map((a) => a.slice("--include=".length));

// ── env var ────────────────────────────────────────────────────────────
const DB_URL = process.env.PROD_SUPABASE_DB_URL;
if (!DB_URL) {
  console.error(`
✗ PROD_SUPABASE_DB_URL is not set.

Get it from: Supabase dashboard → Project Settings → Database → Connection string → "Direct"
Example: postgresql://postgres:PASSWORD@db.abcdefgh.supabase.co:5432/postgres
`);
  process.exit(1);
}

// ── file discovery ─────────────────────────────────────────────────────
function discoverMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`✗ migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => f !== "rollback.sql" && f !== "run-all.sql")
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

function buildFileList() {
  const numbered = discoverMigrations();
  const extras = INCLUDES
    .map((p) => resolve(ROOT, p))
    .filter((p) => existsSync(p));
  if (extras.length === 0 && INCLUDES.length > 0) {
    console.error(`✗ --include paths not found: ${INCLUDES.join(", ")}`);
    process.exit(1);
  }
  return [...numbered, ...extras];
}

// ── log helpers ────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const logStep = (m) => log(`\n→ ${m}`);
const logOk = (m) => log(`  ✓ ${m}`);

// ── run one file ───────────────────────────────────────────────────────
async function runFile(client, filePath) {
  const rel = relative(ROOT, filePath);
  const sql = readFileSync(filePath, "utf8");

  if (DRY_RUN || LIST_ONLY) {
    logOk(`${rel} (${sql.length} bytes)`);
    return { skipped: true };
  }

  logStep(`applying ${rel} (${sql.length} bytes)`);

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    logOk(rel);
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error(
      `${rel} failed: ${err.message}` +
        (err.position ? ` (at position ${err.position})` : "") +
        (err.hint ? `\n   hint: ${err.hint}` : "")
    );
  }
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const files = buildFileList();
  if (files.length === 0) {
    console.error("✗ no migrations found in supabase/migrations/");
    process.exit(1);
  }

  const redacted = DB_URL.replace(/:[^:@/]+@/, ":***@");
  log(`\n[prod-migrate] target: ${redacted}`);
  if (DRY_RUN) log(`[prod-migrate] DRY RUN — no changes will be made`);
  if (LIST_ONLY) log(`[prod-migrate] LIST ONLY — no changes will be made`);
  log(`[prod-migrate] ${files.length} migration file(s) queued\n`);

  if (LIST_ONLY) {
    for (const f of files) log(`  - ${relative(ROOT, f)}`);
    return;
  }

  const client = new Client({
    connectionString: DB_URL,
    // Supabase direct connection uses a self-signed cert chain — same default
    // as `psql` with sslmode=require. The auth is by password, not by cert.
    ssl: { rejectUnauthorized: false },
  });

  let connected = false;
  let applied = 0;
  let skipped = 0;

  try {
    logStep("connecting to prod Supabase…");
    await client.connect();
    connected = true;
    logOk("connected");

    // Disable any server-side statement timeout. Migrations like index creation
    // on populated tables can take minutes.
    await client.query("SET statement_timeout = 0");

    // Sanity-check: confirm we're talking to the right kind of database.
    const r = await client.query(
      "SELECT current_database() AS db, " +
        "inet_server_addr()::text AS host, " +
        "version() AS pg_version"
    );
    const { db, host, pg_version } = r.rows[0];
    log(`  current_database: ${db}`);
    log(`  server host:      ${host || "(local/unknown)"}`);
    log(`  postgres version: ${pg_version.split(" ").slice(0, 2).join(" ")}`);

    if (db !== "postgres") {
      throw new Error(
        `Refusing to migrate: current_database is "${db}", expected "postgres".\n` +
          `Did you point PROD_SUPABASE_DB_URL at the right Supabase project?`
      );
    }

    for (const file of files) {
      const result = await runFile(client, file);
      if (result.ok) applied++;
      if (result.skipped) skipped++;
    }

    log(
      `\n[prod-migrate] ✓ done. applied=${applied}, ` +
        `skipped=${skipped}, total=${files.length}\n`
    );
  } catch (err) {
    log(`\n✗ ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    if (connected) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
}

main();
