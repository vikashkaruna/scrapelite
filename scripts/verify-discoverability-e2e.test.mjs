// scripts/verify-discoverability-e2e.test.mjs
//
// The test instrument's own test.
//
// A checker with nothing checking it is exactly the pattern this repository
// keeps catching — a module whose only reader is its own test, a column declared
// and never written, a guard pinned to the redundant one of three. So the
// registry is imported and asserted rather than trusted.
//
// What it pins:
//   1. postgrestAnswer() — the predicate that stops a security probe reporting
//      "locked down" from a machine that never reached the project.
//   2. Every check carries the three things a human needs to approve its result.
//   3. Production writes and audit spend are OFF unless asked for, twice.
//   4. Check ids are unique and the documented set is covered.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { postgrestAnswer } from "./lib/postgrestAnswer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "scripts/verify-discoverability-e2e.mjs"), "utf8");

const headers = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

let suites, MANUAL_ONLY, allChecks;
beforeAll(async () => {
  process.env.DATIQ_VERIFY_IMPORT_ONLY = "1";
  const m = await import("./verify-discoverability-e2e.mjs");
  suites = m.suites;
  MANUAL_ONLY = m.MANUAL_ONLY;
  allChecks = suites.flatMap((s) => s.checks);
});

describe("postgrestAnswer — a refusal is evidence only if PostgREST wrote it", () => {
  // 🔴 THE CASE THAT WAS LIVE. An egress proxy answers 403 with its own
  // plain-text body BEFORE the request reaches Supabase. The old loop counted
  // that as a refusal and printed "0044 is applied" from a machine that had
  // never contacted the project — a green light nobody would look behind.
  it("calls a proxy's own 403 INCONCLUSIVE, never a refusal", () => {
    const r = postgrestAnswer({
      status: 403,
      headers: headers({ "x-deny-reason": "host_not_allowed", "content-type": "text/plain" }),
      text: "Host not in allowlist: datiq.app.",
    });
    expect(r.fromPostgrest).toBe(false);
    expect(r.reason).toMatch(/proxy refused/i);
  });

  it("calls a plain-text 403 with no deny header INCONCLUSIVE too", () => {
    const r = postgrestAnswer({
      status: 403, headers: headers({ "content-type": "text/html" }), text: "<html>Blocked by policy</html>",
    });
    expect(r.fromPostgrest).toBe(false);
  });

  it("accepts a real PostgREST refusal, which is JSON", () => {
    const r = postgrestAnswer({
      status: 401,
      headers: headers({ "content-type": "application/json; charset=utf-8" }),
      text: '{"code":"42501","message":"permission denied for table audit_subjects"}',
    });
    expect(r.fromPostgrest).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("accepts a JSON body even when the content type is missing", () => {
    const r = postgrestAnswer({ status: 404, headers: headers({}), text: '{"code":"PGRST205"}' });
    expect(r.fromPostgrest).toBe(true);
  });

  // No proxy invents rows, so a 200 can only have come from the database — and
  // a 200 is the one verdict that must never be softened into "inconclusive",
  // because it is the leak.
  it("always treats a 200 as having come from the database", () => {
    const r = postgrestAnswer({ status: 200, headers: headers({ "content-type": "text/plain" }), text: "[]" });
    expect(r.fromPostgrest).toBe(true);
  });

  it("treats a failed request as inconclusive rather than safe", () => {
    expect(postgrestAnswer({ status: 0, error: "ECONNRESET" }).fromPostgrest).toBe(false);
  });

  it("treats an empty non-JSON body as inconclusive", () => {
    const r = postgrestAnswer({ status: 403, headers: headers({ "content-type": "text/plain" }), text: "" });
    expect(r.fromPostgrest).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });
});

describe("the check registry", () => {
  it("has no duplicate ids", () => {
    const ids = allChecks.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  // The three fields a human needs to approve a result without re-deriving it:
  // what had to be true first, what to look at to believe the pass, and where
  // to go on a fail. A check missing any of them produces a verdict nobody can
  // act on, which is the same as no check.
  it("gives every check a prereq, a post-check and a fix", () => {
    const thin = allChecks
      .filter((c) => !c.prereq || !c.postCheck || !c.fix)
      .map((c) => `${c.id}: missing ${[!c.prereq && "prereq", !c.postCheck && "postCheck", !c.fix && "fix"].filter(Boolean).join("+")}`);
    expect(thin).toEqual([]);
  });

  it("declares a severity of stop-ship or bug on every check", () => {
    const bad = allChecks.filter((c) => !["stop-ship", "bug"].includes(c.severity)).map((c) => c.id);
    expect(bad).toEqual([]);
  });

  it("covers every section of the companion document", () => {
    const prefixes = new Set(allChecks.map((c) => c.id[0]));
    // P pre-flight · A P1 · B W9/W10 · C W12 · D W13 · E W14 · F W11 · G P3A · H P3B · I P3C · S security
    expect([...prefixes].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "P", "S"]);
  });

  // Coverage that quietly omits what it does not cover is the same defect as
  // coverageClaim()'s forbidden flat sentence, one level up.
  it("states every manual-only row rather than leaving it out", () => {
    expect(MANUAL_ONLY.length).toBeGreaterThan(0);
    for (const [id, title, why] of MANUAL_ONLY) {
      expect(id, "every manual row needs an id").toBeTruthy();
      expect(title, `${id} needs a title`).toBeTruthy();
      expect(why, `${id} needs a reason it cannot be automated`).toBeTruthy();
    }
  });

  it("does not automate and also list the same id as manual-only", () => {
    const automated = new Set(allChecks.map((c) => c.id));
    const both = MANUAL_ONLY.map(([id]) => id).filter((id) => automated.has(id));
    expect(both).toEqual([]);
  });
});

describe("the safety model", () => {
  // 🔴 A full write-path regression creates real rows in a real tenant's
  // account and an audit run spends real quota. Several P2 tables have no
  // delete endpoint — audit_subject_scores APPENDS by design — so residue on
  // production cannot be tidied away. Both must be opt-in there.
  it("defaults production to no writes and no audit spend", () => {
    expect(SRC).toMatch(/const ALLOW_WRITES = argv\.flags\.has\("allow-writes"\) \|\| \(!IS_PROD/);
    expect(SRC).toMatch(/const ALLOW_AUDITS = argv\.flags\.has\("allow-audits"\) \|\| \(!IS_PROD/);
  });

  it("never accepts a password as a command-line flag", () => {
    // A flag lands in shell history and in `ps`. Credentials come from the
    // environment and nowhere else, the same rule the authenticated Playwright
    // journey states for the same reason.
    expect(SRC).not.toMatch(/opt\.password|opt\["password"\]|opt\.pass\b/);
    expect(SRC).toMatch(/process\.env\.DATIQ_TEST_PASSWORD/);
  });

  it("treats an unmet prerequisite as SKIP, never as PASS", () => {
    expect(SRC).toMatch(/record\(check, VERDICT\.SKIP, CAP_REASON\[unmet\[0\]\]/);
  });

  it("fails the run on a stop-ship deviation, not only on a failure", () => {
    expect(SRC).toMatch(/stopShipProblems = \[\.\.\.fails, \.\.\.devs\]\.filter/);
  });

  // 🔴 THE FAIL-OPEN THIS INSTRUMENT ALMOST SHIPPED WITH. The first draft of
  // the summary printed "PRODUCTION: READY" off a run with zero passes and
  // sixty-one skips, because it counted only failures. A run that exercised
  // nothing is not a pass, and the exit code has to say so.
  it("calls a run that exercised nothing INCONCLUSIVE, never READY", () => {
    expect(SRC).toMatch(/notExercised = stopShip\.filter/);
    expect(SRC).toMatch(/: notExercised\.length \? "INCONCLUSIVE"/);
  });

  it("exits non-zero when a stop-ship check was never exercised", () => {
    // 2 is this repo's existing convention for inconclusive — verify-workflow-rls
    // uses it for the same reason. It must never read as success in CI.
    expect(SRC).toMatch(/: outcome\.notExercised\.length \? 2/);
  });
});

describe("the companion document and the runner are one artifact in two forms", () => {
  const DOC = readFileSync(join(ROOT, "docs/AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md"), "utf8");

  // A document that restates the thing it documents cannot catch it drifting —
  // the defect that let `UNBUILT_SOURCES` stay stale for a whole session, and
  // the hand-written STORE_EXPORTS array go red twice. So the parity is
  // asserted rather than maintained by hand.
  it("documents every automated check", () => {
    const missing = allChecks.filter((c) => !DOC.includes(`#### ${c.id} —`)).map((c) => c.id);
    expect(missing, "regenerate the §7–§10 sections from the registry").toEqual([]);
  });

  it("documents every manual-only row", () => {
    const missing = MANUAL_ONLY.filter(([id]) => !DOC.includes(`| ${id} |`)).map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it("carries the whole prereq / confirm-by-eye / fix triplet for each check", () => {
    for (const c of allChecks) {
      const i = DOC.indexOf(`#### ${c.id} —`);
      const block = DOC.slice(i, i + 2600);
      expect(block, `${c.id} lost its prereq`).toContain("**Before it can run:**");
      expect(block, `${c.id} lost its confirm-by-eye`).toContain("**Confirm by eye:**");
      expect(block, `${c.id} lost its remedy`).toContain("**If it fails:**");
    }
  });

  it("does not still point at the pre-rename filename", () => {
    // The rename is the whole reason this file exists under a new name; a stale
    // self-reference inside it would send the next reader to a deleted file.
    expect(DOC).not.toMatch(/\]\(MANUAL-TEST-DISCOVERABILITY-P1-P2\.md\)/);
  });
});
