// billing-purge.js — deletes the CONTENT of accounts that lapsed 90 days ago.
//
// ⚠️ THIS IS THE ONLY FUNCTION IN DATIQ THAT DESTROYS CUSTOMER DATA. Everything
// about it is arranged so that the failure mode is "nothing was deleted",
// never "something was deleted that should not have been".
//
// FIVE INDEPENDENT INTERLOCKS, each of which alone stops a purge:
//
//  1. PURGE_ENABLED must be explicitly "1". Default OFF. Deploying this file
//     does not arm it.
//  2. billing-lifecycle must have succeeded within STALE_HOURS. A dunning cron
//     that silently died (a bad deploy, a disabled schedule) plus a healthy
//     purge cron would delete data from users who were never warned. That
//     combination is the worst plausible outcome of this whole feature, so the
//     purge refuses to run without a recent, successful dunning run.
//  3. Per user, entitlements.last_notice_kind must be 'delete_d90'. We delete
//     only what we have demonstrably warned about, three times.
//  4. purge_after must be in the past AND status must be 'deactivated'.
//  5. PURGE_MAX_USERS_PER_RUN caps the blast radius of any bug to a handful of
//     accounts per day rather than the entire customer base.
//
// PURGE_DRY_RUN=1 reports exactly what WOULD be deleted and deletes nothing.
//
// WHAT SURVIVES: the auth user, entitlements, invoices, invoice_lines and
// payment_events. Tax law requires invoice retention for years regardless of a
// deletion request, and the account row is what lets someone come back. Only
// the user's CONTENT goes.
// NOTE: this `config` export does NOT register the cron — it is only honoured
// for v2 functions (`export default`), and this is a v1 handler. The real
// schedule lives in netlify.toml under [functions."billing-purge"]. Keep both in sync;
// netlify.toml is authoritative.
export const config = { schedule: "@daily" };

import { withJobRun } from "./lib/jobControl.js";

const STALE_HOURS = 48;
const DEFAULT_MAX = 50;

// Tables purged, in dependency order. Anything not listed here is retained by
// default — a new user-content table must be added deliberately, which is the
// safe direction for an omission.
//
// ⚠️ countRows()/deleteRows() below filter on a plain `user_id=eq.<id>` REST
// query, so every table here MUST have a `user_id` column that actually
// belongs to the purged account. A table with a differently-named or
// multi-owner FK cannot go on this list without also changing that query —
// see RETAIN_TABLES for the four tables from migrations 0029-0031 that don't
// fit that shape and were deliberately left off rather than silently
// mismatched (netlify/__tests__/audit/purge-table-parity.test.js is the check
// that would have caught this list going stale the way it did the first time:
// migrations 0029-0031 added 18 user-content tables and none were listed
// here until this pass).
const PURGE_TABLES = [
  "extractions",
  "scheduled_tasks",
  "analytics_events",
  "summary_feedback",
  "public_reports",
  // ── 0029 referrals ──
  "referral_codes",           // user_id is the primary key
  // ── 0030 discoverability audits (user_id on every one of these) ──
  "audit_targets",
  "audits",
  "audit_results",
  "audit_signals",
  "audit_issues",
  "audit_recommendations",
  "audit_prompt_sets",
  "audit_prompt_runs",
  "audit_benchmarks",
  "audit_benchmark_members",
  "audit_schedules",
  "audit_webhooks",
  // ── 0031 team workspaces ──
  // Only the purged user's OWN membership row — never the workspace itself
  // (see RETAIN_TABLES: a workspace is shared, so deleting it would destroy
  // other members' data over one member's purge).
  "workspace_members",
];

// User-scoped tables from 0029-0031 deliberately NOT auto-purged, and why.
// purge-table-parity.test.js asserts every table those three migrations
// introduced is in exactly one of PURGE_TABLES or this list — so a table can
// go unhandled only by a reviewed, deliberate decision, never by omission.
export const RETAIN_TABLES = {
  referral_redemptions:
    "no plain `user_id` column (referrer_user_id / invitee_user_id instead) — " +
    "the current user_id=eq.<id> delete query cannot target it correctly, and " +
    "it is also the REFERRER's evidence of an earned bonus, not only the " +
    "purged user's own content. Needs a dedicated two-sided delete, not a " +
    "one-line addition to this array.",
  audit_events:
    "user_id is nullable with ON DELETE SET NULL, the same anonymize-not-" +
    "cascade shape as ops_audit_log — this is an audit-trail log, not user " +
    "content, and this codebase's standing rule is that audit trails are " +
    "never pruned by an automated job.",
  workspaces:
    "owned via `owner_id`, not `user_id`, and shared with other members. " +
    "Deleting it on the owner's purge would destroy every OTHER member's " +
    "workspace data too — needs an ownership-transfer or orphan-workspace " +
    "policy decided on purpose, not a blanket delete.",
  workspace_invites:
    "owned via `invited_by`, not `user_id`, and expires on its own 14-day " +
    "clock — cleanup belongs with that expiry, not with a user_id-scoped " +
    "content purge.",
};

function sb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  return {
    base,
    headers,

    async lastLifecycleRun() {
      const res = await fetch(
        `${base}/billing_cron_runs?job=eq.billing-lifecycle&select=last_success&limit=1`,
        { headers },
      );
      if (!res.ok) return null;
      const rows = await res.json().catch(() => []);
      return rows?.[0]?.last_success ?? null;
    },

    /** Interlocks 3 and 4 are expressed as query filters, not as code. */
    async purgeable(limit) {
      const nowIso = new Date().toISOString();
      const url =
        `${base}/entitlements` +
        `?status=eq.deactivated` +
        `&purge_after=not.is.null` +
        `&purge_after=lt.${encodeURIComponent(nowIso)}` +
        `&last_notice_kind=eq.delete_d90` +
        `&select=user_id,plan_id,period_end,purge_after,last_notice_kind` +
        `&limit=${limit}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`purgeable read → HTTP ${res.status}`);
      return (await res.json()) || [];
    },

    async countRows(table, userId) {
      const res = await fetch(
        `${base}/${table}?user_id=eq.${encodeURIComponent(userId)}&select=id`,
        { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } },
      );
      if (!res.ok) return 0;
      const range = res.headers.get("content-range") || "";
      const total = range.split("/")[1];
      return Number(total) || 0;
    },

    async deleteRows(table, userId) {
      const res = await fetch(`${base}/${table}?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" },
      });
      // A missing table (404) is not fatal — optional features may not be
      // installed on every deployment.
      if (!res.ok && res.status !== 404) {
        throw new Error(`delete ${table} → HTTP ${res.status}`);
      }
      return res.ok;
    },

    async markPurged(userId, version) {
      return fetch(`${base}/entitlements?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "purged",
          version: (version ?? 0) + 1,
          updated_at: new Date().toISOString(),
        }),
      });
    },

    async audit(userId, detail) {
      return fetch(`${base}/billing_audit_log`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          actor: "system:billing-purge",
          action: "purge",
          user_id: userId,
          reason: "90 days deactivated after subscription lapse; delete_d90 notice sent",
          detail,
        }),
      });
    },

    async recordRun(detail) {
      return fetch(`${base}/billing_cron_runs`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          job: "billing-purge",
          last_success: new Date().toISOString(),
          last_detail: detail,
        }),
      });
    },
  };
}

/** Interlock 2, extracted so it can be tested without a database. */
export function lifecycleIsFresh(lastSuccessIso, now = new Date(), staleHours = STALE_HOURS) {
  if (!lastSuccessIso) return false;
  const t = Date.parse(lastSuccessIso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < staleHours * 3600_000;
}

const run = async () => {
  // Interlock 1 — armed only by explicit configuration.
  if (process.env.PURGE_ENABLED !== "1") {
    return { statusCode: 200, body: "skipped (PURGE_ENABLED is not 1)" };
  }

  const db = sb();
  if (!db) return { statusCode: 200, body: "skipped (no supabase)" };

  const dryRun = process.env.PURGE_DRY_RUN === "1";
  const max = Number(process.env.PURGE_MAX_USERS_PER_RUN) || DEFAULT_MAX;

  // Interlock 2 — refuse to delete if dunning has not run recently.
  const lastRun = await db.lastLifecycleRun();
  if (!lifecycleIsFresh(lastRun)) {
    const msg = `ABORTED: billing-lifecycle has not succeeded since ${lastRun || "never"} (stale > ${STALE_HOURS}h). Refusing to purge.`;
    console.error(`[billing-purge] ${msg}`);
    return { statusCode: 200, body: msg };
  }

  let rows;
  try {
    rows = await db.purgeable(max); // interlocks 3, 4 and 5
  } catch (err) {
    console.error("[billing-purge]", err.message);
    return { statusCode: 500, body: `failed: ${err.message}` };
  }

  const stats = { eligible: rows.length, purged: 0, rows: 0, failed: 0, dryRun };

  for (const row of rows) {
    try {
      const counts = {};
      for (const table of PURGE_TABLES) {
        counts[table] = await db.countRows(table, row.user_id);
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);

      if (dryRun) {
        console.log(`[billing-purge][DRY RUN] would purge ${row.user_id}: ${JSON.stringify(counts)}`);
        stats.rows += total;
        stats.purged += 1;
        continue;
      }

      for (const table of PURGE_TABLES) {
        await db.deleteRows(table, row.user_id);
      }
      await db.markPurged(row.user_id, row.version);
      await db.audit(row.user_id, { counts, purge_after: row.purge_after });

      stats.rows += total;
      stats.purged += 1;
      console.log(`[billing-purge] purged ${row.user_id}: ${JSON.stringify(counts)}`);
    } catch (err) {
      // One failure must not abort the batch, and must not mark the user purged.
      stats.failed += 1;
      console.error(`[billing-purge] user ${row.user_id} failed:`, err?.message);
    }
  }

  await db.recordRun(stats);

  const summary =
    `${dryRun ? "[DRY RUN] " : ""}eligible ${stats.eligible}, ` +
    `purged ${stats.purged}, rows ${stats.rows}, failed ${stats.failed}`;
  console.log(`[billing-purge] ${summary}`);
  return { statusCode: 200, body: summary };
};

// Wrapped for /admin/monitoring — see jobControl.js.
//
// The operator kill switch is INTERLOCK SIX, not a replacement for the five
// already in `run`. It fails open (a Supabase outage lets the job run), which is
// safe precisely because interlock 1 — PURGE_ENABLED — is read from the process
// environment and cannot fail open at all.
//
// This job is also marked `manualRunAllowed: false` in monitoringModel.js, so
// admin-monitoring refuses to trigger it by hand. Its schedule is the only path
// that reaches it.
export const handler = withJobRun("billing-purge", run);

export const _internal = { sb, lifecycleIsFresh, PURGE_TABLES, STALE_HOURS };
