import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SUBJECT_SCORE_IDS, SUBJECT_MODEL_VERSION, scoreSubject,
} from "../../../src/lib/discoverability/subjectScoring.js";

const ROOT = process.cwd();
const RAW = readFileSync(join(ROOT, "supabase", "migrations", "0064_subject_scores.sql"), "utf8");
// Comments are stripped before matching. An earlier parity test in this
// directory failed on its own header comment; a structural test that reads
// prose is testing the prose.
const SQL = RAW.replace(/^\s*--.*$/gm, "");

/** Every .js/.jsx under a root, excluding tests. */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("🔴 W11's model has a CALLER — the guard this gap needed", () => {
  // W11 shipped `subjectScoring.js` complete, tested, and imported by NOTHING.
  // The deferral was deliberate and recorded, and its two blockers (D7, then
  // TC/TP from W13) both shipped — after which nobody noticed the reason had
  // expired, exactly as `local_directory.built` stayed false for a session.
  //
  // ⚠️ THIS ASSERTS A NON-TEST IMPORTER, NOT MERELY THAT THE FILE PARSES. Its
  // own unit suite imports it; so did the four columns in this schema that were
  // declared, reviewed, merged and written by nothing. A module whose only
  // reader is its own test is not wired.
  it("is imported by production code, not only by its own test", () => {
    const importers = [...sources(join(ROOT, "src")), ...sources(join(ROOT, "netlify"))]
      .filter((f) => !f.endsWith(join("discoverability", "subjectScoring.js")))
      .filter((f) => /from\s+["'][^"']*subjectScoring\.js["']/.test(readFileSync(f, "utf8")));

    expect(importers.length).toBeGreaterThan(0);
  });

  it("the store writes the table, so the migration is not a declared-and-never-written fifth", () => {
    const store = readFileSync(
      join(ROOT, "netlify", "functions", "lib", "audit", "auditStore.js"), "utf8");
    expect(store).toMatch(/audit_subject_scores/);
  });
});

describe("🔴 the migration's own guarantees, parsed rather than restated", () => {
  it("constrains `kind` to exactly the three SCORABLE kinds", () => {
    // `audit_subjects` legitimately holds page/domain/location too, and
    // `scoreIdFor` returns null for all three. A row claiming a page has a BDS
    // is a category error the database refuses rather than trusting every
    // future writer to remember.
    const m = SQL.match(/kind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(([^)]+)\)/i);
    expect(m).toBeTruthy();
    const kinds = m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).sort();
    expect(kinds).toEqual([...SUBJECT_SCORE_IDS].sort());
  });

  it("🔴 leaves `score` NULLABLE — unknown is never 0", () => {
    // A stored 0 is indistinguishable, for ever, from a subject that genuinely
    // scored zero. This is the one thing the whole module is built to prevent.
    expect(SQL).toMatch(/score\s+numeric\(5,1\)\s+check/i);
    expect(SQL).not.toMatch(/score\s+numeric\(5,1\)\s+not\s+null/i);
  });

  it("🔴 makes `coverage` NOT NULL — a score without it is a different measurement", () => {
    // 72 at 80% coverage with TC excluded and 72 at 100% are not the same
    // number. A trend drawn through stored scores whose coverage was dropped
    // shows a phantom jump the day an excluded component starts being measured.
    expect(SQL).toMatch(/coverage\s+numeric\(5,1\)\s+not\s+null/i);
  });

  it("⚠️ gives `model_version` NO DEFAULT — the rule 0048 established", () => {
    // A default lets a writer that forgets the stamp file a future score under
    // the current version, which is precisely the mislabelling the column
    // exists to prevent.
    const m = SQL.match(/model_version\s+text\s+not\s+null([^,]*)/i);
    expect(m).toBeTruthy();
    expect(m[1]).not.toMatch(/default/i);
  });

  it("🔴 has NO unique arbiter — this table appends, because the trend is the product", () => {
    // Every sibling table W12/W13 added carries one so a re-observation
    // updates. Here an arbiter would silently collapse a subject's whole
    // history into one row on every re-score. A reader will wonder why this
    // one differs, so the difference is pinned.
    expect(SQL).not.toMatch(/unique\s+nulls\s+not\s+distinct[\s\S]{0,200}audit_subject_scores/i);
    expect(SQL).not.toMatch(/add\s+constraint\s+\w*subject_score\w*\s+unique/i);
  });

  it("is RLS-locked to service_role and revoked from anon", () => {
    expect(SQL).toMatch(/alter table public\.audit_subject_scores enable row level security/i);
    expect(SQL).toMatch(/revoke all on public\.audit_subject_scores from anon, authenticated/i);
  });
});

describe("the subject model version is its own series", () => {
  it("is namespaced `s`, never the page model's `v`", () => {
    // Filing both formulas under one number makes both comparability claims
    // false: a page-model bump would wrongly invalidate every subject trend.
    expect(SUBJECT_MODEL_VERSION).toMatch(/^s\d+$/);
  });

  it("is stamped by the model onto every result", () => {
    const r = scoreSubject("brand", { entity_clarity: 70 });
    expect(r.modelVersion).toBe(SUBJECT_MODEL_VERSION);
  });
});
