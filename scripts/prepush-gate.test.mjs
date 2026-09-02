// scripts/prepush-gate.test.mjs — guards the pre-push hook's own gates.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// Measured on 2026-09-02 across the last 25 Staging Gate runs: 5 failed, and
// 4 of those 5 failed on the SAME step — "End-to-end smoke tests (Playwright)".
// All four had passed the pre-push hook first, because test-all.mjs --prepush
// deliberately skips the e2e suite. The most common route to a red gate was
// therefore: change a UI file → nine local gates green in ~30s → push → find
// out ten minutes later in CI.
//
// A conditional e2e gate now closes that. These tests exist so it cannot be
// quietly removed or defanged — the same reasoning deploy-toolchain.test.mjs
// applies to the release workflow, and the same reasoning behind the hook's own
// warning that PREPUSH_FORCE once silently switched the prerender gate OFF.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "pre-push.sh");
const sh = readFileSync(SRC, "utf8");

describe("pre-push: the e2e smoke gate", () => {
  it("runs the e2e smoke suite", () => {
    expect(sh).toMatch(/run_step\s+"test:e2e:smoke"/);
  });

  it("is conditional on UI or spec files changing, not unconditional", () => {
    // Unconditional would add ~90s to every push — including docs-only and
    // netlify-only ones — and a slow hook is a hook people --no-verify past.
    expect(sh).toMatch(/E2E_TRIGGER/);
    expect(sh).toMatch(/src\/\(pages\|components\|styles\|lib\|hooks\)\//);
  });

  it("triggers on changes to the specs themselves, not only to src", () => {
    // Editing a spec is exactly when you want to know it still passes.
    // Match the whole LINE: the assignment embeds quoted shell inside quotes,
    // so a /"[^"]+"/ match stops at the first inner quote and asserts nothing.
    const trigger = sh.split("\n").find((l) => l.includes("E2E_TRIGGER=")) ?? "";
    expect(trigger).toMatch(/e2e\//);
  });

  it("has an explicit, named escape hatch rather than a silent one", () => {
    expect(sh).toMatch(/PREPUSH_SKIP_E2E/);
    expect(sh).toMatch(/skip with PREPUSH_SKIP_E2E=1/);
  });

  it("sits OUTSIDE the docs-only early-exit block", () => {
    // The prerender gate once lived inside PREPUSH_FORCE, so a flag whose whole
    // purpose was to run MORE checks silently switched it off. The e2e gate
    // must come after the suites, at top level.
    const e2eAt = sh.indexOf('run_step "test:e2e:smoke"');
    const securityAt = sh.indexOf('run_step "test:security"');
    expect(e2eAt).toBeGreaterThan(securityAt);
  });

  it("watches the SAME source set as the prerender gate", () => {
    // If a change can make a prerendered page stale it can break a rendered-
    // structure contract. Two different notions of "affects what renders"
    // would drift, and the narrower one would quietly stop catching things.
    const prerenderLine = sh.split("\n").find((l) => l.includes("PRERENDER_SRC=")) ?? "";
    const e2eLine = sh.split("\n").find((l) => l.includes("E2E_TRIGGER=")) ?? "";
    for (const dir of ["pages", "components", "styles", "lib", "hooks"]) {
      expect(prerenderLine, `prerender watches ${dir}`).toContain(dir);
      expect(e2eLine, `e2e watches ${dir}`).toContain(dir);
    }
  });

  it("still reads CHANGED_FILES, the same signal the prerender gate uses", () => {
    // One definition of "what changed" for both gates; two would drift.
    expect(sh).toMatch(/\$\{CHANGED_FILES:-\}/);
  });
});

describe("pre-push: the gate set has not shrunk", () => {
  const REQUIRED = [
    "readiness", "test:unit", "test:contract", "test:integration",
    "test:system", "test:db", "build", "check:prerender", "test:security",
  ];
  it.each(REQUIRED)("still runs %s", (gate) => {
    expect(sh).toContain(`run_step "${gate}"`);
  });

  it("keeps the prerender staleness gate outside PREPUSH_FORCE", () => {
    expect(sh).toMatch(/PREPUSH_SKIP_PRERENDER/);
    expect(sh).toMatch(/DELIBERATELY OUTSIDE THE PREPUSH_FORCE BLOCK/);
  });
});

describe("pre-push: the installed hook matches the source", () => {
  it("has not drifted from scripts/pre-push.sh", () => {
    // Every Claude session here works in a WORKTREE, where .git is a FILE —
    // which is why `cp` into .git/hooks used to fail silently and the installed
    // copy rotted. scripts/install-hook.mjs resolves --git-common-dir.
    let common;
    try {
      common = execSync("git rev-parse --git-common-dir", { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      return; // not a git checkout (tarball, some CI shapes) — nothing to compare
    }
    const installed = join(common.startsWith("/") ? common : join(ROOT, common), "hooks", "pre-push");
    if (!existsSync(installed)) return; // hook not installed on this machine
    expect(readFileSync(installed, "utf8")).toBe(sh);
  });
});

describe("test-all.mjs: --prepush still skips e2e by default", () => {
  // The conditionality lives in the HOOK, where the diff signal is. If
  // test-all.mjs also grew its own e2e-on-prepush logic, a UI push would run
  // the suite twice and nobody would notice until the hook took 3 minutes.
  const ta = readFileSync(join(ROOT, "scripts", "test-all.mjs"), "utf8");
  it("gates the Playwright smoke suite behind !isPrepush", () => {
    expect(ta).toMatch(/isPrepush/);
    expect(ta).toMatch(/test:e2e:smoke/);
  });
});
