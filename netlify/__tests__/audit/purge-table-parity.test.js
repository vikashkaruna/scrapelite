import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { _internal, RETAIN_TABLES } from "../../functions/billing-purge.js";

// ── Why this test exists ───────────────────────────────────────────────────
// billing-purge.js's PURGE_TABLES is a hand-maintained list, and it went
// stale exactly once already, silently: migrations 0029-0031 added 18
// user-content tables (13 audit, 3 workspace, 2 referral) and NONE of them
// were ever added to PURGE_TABLES. A user could request deletion, the UI
// would count down to a purge date, and the purge job would run and touch
// none of that content — the two halves of the deliberately-split design
// (an endpoint that records intent, a cron that performs the act) never
// actually met.
//
// Same shape as cron-registry-parity.test.js: two hand-edited lists that must
// agree, with no build error and no runtime error when they don't — the
// failure is silence. This is the check that would have caught it.
//
// Scope: the three migrations that introduced the documented gap (0029-0031),
// not the whole schema — billing/ops/audit-trail tables elsewhere (invoices,
// payment_events, ops_audit_log, ...) are already accounted for by the file's
// own header ("WHAT SURVIVES") and are out of scope for this specific check.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const TARGET_MIGRATIONS = [
  "0029_referrals.sql",
  "0030_discoverability_audits.sql",
  "0031_team_workspaces.sql",
];

function tablesIn(migrationFile) {
  const sql = readFileSync(resolve(ROOT, "supabase/migrations", migrationFile), "utf8");
  return [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
}

const introducedTables = TARGET_MIGRATIONS.flatMap(tablesIn);

describe("PURGE_TABLES ↔ RETAIN_TABLES parity for 0029-0031", () => {
  it("the migration scan itself found tables — guards the regex", () => {
    expect(introducedTables.length).toBe(18);
  });

  it("every table those migrations introduced is accounted for exactly once", () => {
    const purge = new Set(_internal.PURGE_TABLES);
    const retain = new Set(Object.keys(RETAIN_TABLES));

    const unhandled = introducedTables.filter((t) => !purge.has(t) && !retain.has(t));
    expect(unhandled, `introduced but neither purged nor retained: ${unhandled.join(", ")}`).toEqual([]);

    const both = introducedTables.filter((t) => purge.has(t) && retain.has(t));
    expect(both, `listed in BOTH PURGE_TABLES and RETAIN_TABLES: ${both.join(", ")}`).toEqual([]);
  });

  it("every RETAIN_TABLES entry carries a real reason, not a placeholder", () => {
    for (const [table, reason] of Object.entries(RETAIN_TABLES)) {
      expect(typeof reason, `${table}'s reason should be a string`).toBe("string");
      expect(reason.length, `${table}'s reason reads as too short to be a real explanation`).toBeGreaterThan(20);
    }
  });

  it("workspaces (shared, multi-member) is retained, not purged on one member's account", () => {
    // The cross-account-harm case this whole split exists to prevent: purging
    // one member must never delete a workspace other members still use.
    expect(_internal.PURGE_TABLES).not.toContain("workspaces");
    expect(RETAIN_TABLES).toHaveProperty("workspaces");
  });

  it("workspace_members IS purged — that's just the purged user's own membership row", () => {
    expect(_internal.PURGE_TABLES).toContain("workspace_members");
  });
});
