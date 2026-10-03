// scripts/staging-gate.test.mjs
//
// Guard tests for the Staging Gate's deploy step, plus the pre-push hook tests
// that share its "a gate that reports green without having run" theme.
//
// HISTORY. The deploy step used to poll Netlify's API and decide by ANCESTRY
// whether a healthy staging deploy had shipped the commit (run 32995206476
// failed because it demanded SHA EQUALITY against a deploy that kept moving).
// Netlify is no longer a deploy target: the gate now calls gcp-staging.yml,
// which builds, deploys and smokes GCP staging in the SAME run. The ancestry
// problem cannot exist any more — the commit that was gated IS the commit that
// was deployed — and the properties worth guarding are different:
//   - the deploy cannot start unless all three gates are green;
//   - a push run is never cancelled mid-deploy;
//   - there is no second, ungated route into staging.
//
// Text assertions rather than YAML-object ones on purpose: what must stay
// correct is the workflow's shape and its shell.
//
// Run with: npx vitest run scripts/staging-gate.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wf = (n) => readFileSync(resolve(__dirname, "..", ".github", "workflows", n), "utf8");
const workflow = wf("staging-gate.yml");

/** The deploy-verified job, from its key to end of file. */
const deployJob = workflow.slice(workflow.indexOf("\n  deploy-verified:"));

describe("staging gate — deploy step", () => {
  it("only runs on a push to staging, never on a PR", () => {
    expect(deployJob).toMatch(/if: github\.event_name == 'push'/);
  });

  it("needs ALL THREE gates, so a red gate can never be deployed past", () => {
    const needs = deployJob.match(/needs: \[([^\]]+)\]/);
    expect(needs).not.toBeNull();
    const listed = needs[1].split(",").map((x) => x.trim());
    expect(listed.sort()).toEqual(["open-defects", "test-suites", "vulnerabilities"]);
  });

  it("deploys through gcp-staging.yml, not an inline copy of the deploy", () => {
    expect(deployJob).toMatch(/uses: \.\/\.github\/workflows\/gcp-staging\.yml/);
  });

  it("skips the Cloud SQL step in CI", () => {
    expect(deployJob).toMatch(/skip_db: true/);
  });

  it("never cancels a push run mid-deploy", () => {
    // A half-cancelled deploy leaves Cloud Run, Hosting and Scheduler on
    // different revisions. PR runs may still be superseded.
    expect(workflow).toMatch(/cancel-in-progress: \$\{\{ github\.event_name != 'push' \}\}/);
  });

  it("keeps the check name stable", () => {
    expect(deployJob).toMatch(/name: "Staging Gate: Deployed & Smoke Tested"/);
  });

  it("no longer talks to Netlify at all", () => {
    expect(workflow).not.toMatch(/api\.netlify\.com|NETLIFY_AUTH_TOKEN|NETLIFY_SITE_ID/);
  });
});

describe("gcp-staging.yml — no ungated route into staging", () => {
  const stg = wf("gcp-staging.yml");
  const on = stg.slice(stg.indexOf("\non:"), stg.indexOf("\nconcurrency:"));

  it("has no push or pull_request trigger", () => {
    expect(on).not.toMatch(/^\s+push:/m);
    expect(on).not.toMatch(/^\s+pull_request/m);
  });

  it("is callable (the gate) and manually runnable", () => {
    expect(on).toMatch(/workflow_call:/);
    expect(on).toMatch(/workflow_dispatch:/);
  });

  it("deploys inside the gcp-staging environment", () => {
    expect(stg).toMatch(/environment: gcp-staging/);
  });
});

// ── The pre-push hook's first-push hole ─────────────────────────────────────
// A guard test in this file rather than its own, because it is the same class
// of defect as the one above: a gate that reports green without having run.
import { readFileSync as _read } from "node:fs";

describe("pre-push hook — a new branch is still gated", () => {
  const hook = _read(resolve(__dirname, "..", "scripts", "pre-push.sh"), "utf8");

  it("does not diff a brand-new branch against its own last commit", () => {
    // On a first push `origin/<branch>` does not exist. Falling back to HEAD~1
    // diffed the branch against its own last commit — and if that commit only
    // touched docs (which, for a branch ending in a CLAUDE.md or handoff
    // update, it usually does), the docs-only skip fired and the ENTIRE branch
    // was pushed with no gate run, under a green "✓ pre-push" line.
    expect(hook).not.toMatch(/merge-base HEAD "\$REMOTE\/\$UPSTREAM" 2>\/dev\/null \|\| echo HEAD~1/);
  });

  it("falls back to the integration branch instead", () => {
    expect(hook).toMatch(/PREPUSH_BASE_BRANCH/);
    expect(hook).toMatch(/git rev-parse --verify --quiet "\$REMOTE\/\$UPSTREAM"/);
  });

  it("runs everything rather than skipping when no base can be found at all", () => {
    // A fresh clone with no remote branches. Skipping on a diff we could not
    // compute is the same failure wearing a different hat.
    expect(hook).toMatch(/CHANGED_FILES="\$\(git ls-files\)"/);
  });

  it("keeps the prerender gate outside the PREPUSH_FORCE block", () => {
    // PREPUSH_FORCE exists to make MORE checks run. It used to switch this one
    // off, which is exactly backwards.
    const forceBlock = hook.slice(
      hook.indexOf('if [ "${PREPUSH_FORCE:-0}" != "1" ]'),
      hook.indexOf("# ── Prerender staleness gate"),
    );
    expect(forceBlock).not.toMatch(/prerendered pages are stale/);
    expect(hook).toMatch(/PREPUSH_SKIP_PRERENDER/);
  });

  it("checks that the installed hook is not stale", () => {
    // .git/hooks/pre-push is a COPY. Nothing re-copies it when this file
    // changes, so a rotted hook silently stops running whichever gates were
    // added after it was installed.
    expect(hook).toMatch(/the installed hook differs from scripts\/pre-push\.sh/);
  });
});

describe("pre-push hook — deleting a branch is not a code change", () => {
  const hook = _read(resolve(__dirname, "..", "scripts", "pre-push.sh"), "utf8");

  it("skips the suites when the ref is being deleted", () => {
    // `git push --delete` sends an all-zero local_sha. There is no tree to
    // test, so running the suites proves nothing about the operation — it just
    // makes deleting a merged branch take 30 seconds and lets an unrelated
    // flake block a cleanup. Which is how people acquire the --no-verify habit,
    // and that habit is how a real gate gets bypassed later.
    expect(hook).toMatch(/PUSHING_CONTENT/);
    expect(hook).toMatch(/no content to test/);
  });

  it("detects the all-zero sha by pattern, not by string length", () => {
    // A 40-char and a 64-char (SHA-256) all-zero sha must both count.
    expect(hook).toMatch(/\*\[!0\]\*\)/);
  });
});
