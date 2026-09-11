import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIER_IDS, ACQUISITION_IDS, DIRECTORY_SOURCES } from "../../../src/lib/discoverability/directorySources.js";
import { LOCAL_FINDING_CODE_IDS, LOCAL_FINDING_CODES } from "../../../src/lib/discoverability/napModel.js";

// ── The drift this file exists to catch ─────────────────────────────────────
//
// 0058 deliberately does NOT enumerate source ids in a CHECK — a new market is
// a dozen new sources, and each would otherwise be a migration. What it DOES
// enumerate is the tier, the acquisition mode and the LD code shape, and those
// three now live in two places: a SQL constraint and a JS registry.
//
// 🔴 SO THIS TEST PARSES THE CONSTRAINT OUT OF THE MIGRATION RATHER THAN
// RESTATING IT. A restated copy drifts exactly as EVENT_TO_SOURCE drifted from
// migration 0043's CHECK — eight event kinds querying for a value no row could
// hold, matching nothing, silently, because an empty result is indistinguishable
// from "nothing wanted this".

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0058_local_directory.sql"), "utf8",
);

/** Pull the values out of the first `check (<col> in ('a','b'))` for a column. */
function checkValues(column) {
  const re = new RegExp(`${column}\\s+text[^,]*?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "is");
  const m = MIGRATION.match(re);
  if (!m) return null;
  return m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
}

describe("0058 agrees with directorySources.js", () => {
  it("the tier CHECK lists exactly the registry's five tiers", () => {
    const inSql = checkValues("source_tier");
    expect(inSql, "source_tier CHECK not found — did the column change shape?").not.toBeNull();
    expect(inSql).toEqual([...TIER_IDS].sort());
  });

  it("the acquisition CHECK lists exactly D5's three modes", () => {
    const inSql = checkValues("acquisition");
    expect(inSql).not.toBeNull();
    expect(inSql).toEqual([...ACQUISITION_IDS].sort());
  });

  it("every tier the registry uses is legal in the database", () => {
    const inSql = new Set(checkValues("source_tier"));
    for (const s of DIRECTORY_SOURCES) expect(inSql.has(s.tier), `${s.id} → ${s.tier}`).toBe(true);
  });

  it("every acquisition mode the registry uses is legal in the database", () => {
    const inSql = new Set(checkValues("acquisition"));
    for (const s of DIRECTORY_SOURCES) expect(inSql.has(s.acquisition), `${s.id} → ${s.acquisition}`).toBe(true);
  });

  it("🔴 does NOT enumerate source ids — that is the deliberate departure from 0056", () => {
    // If somebody adds a source-id CHECK later, every new directory becomes a
    // migration plus a deploy plus a window where the API and the database
    // disagree about what is legal. The reasoning is in the migration header;
    // this assertion is what keeps it from being quietly undone.
    expect(MIGRATION).not.toMatch(/source_id\s+text[^,]*?check\s*\(\s*source_id\s+in/is);
  });
});

describe("0058 agrees with the LD code vocabulary", () => {
  it("every declared LD code satisfies the stored code pattern", () => {
    const m = MIGRATION.match(/code\s+text\s+not null\s+check\s*\(code\s*~\s*'([^']+)'/i);
    expect(m, "the LD code CHECK was not found").not.toBeNull();
    const re = new RegExp(m[1]);
    for (const code of LOCAL_FINDING_CODE_IDS) expect(re.test(code), code).toBe(true);
  });

  it("every declared LD severity is legal in the database", () => {
    const inSql = new Set(checkValues("severity"));
    for (const code of LOCAL_FINDING_CODE_IDS) {
      expect(inSql.has(LOCAL_FINDING_CODES[code].severity), code).toBe(true);
    }
  });

  it("the resolution vocabulary is the LISTING one, not the queue's workflow states", () => {
    // D7 §4: these are about a record, not about a task. Collapsing them into
    // the recommendation queue's eight states would lose the difference between
    // "this listing now agrees" and "somebody did the task".
    const inSql = checkValues("resolution");
    expect(inSql).toEqual(["listing_updated", "not_a_conflict", "record_updated", "wont_fix"]);
  });
});
