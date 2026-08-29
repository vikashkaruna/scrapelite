// scripts/staging-gate.test.mjs
//
// Guard tests for the Staging Gate's deploy-convergence check — the step that
// decides whether a commit actually shipped to staging.
//
// ── THE BUG THESE EXIST TO PREVENT ─────────────────────────────────────────
// The original check required the NEWEST staging deploy's commit_ref to EQUAL
// $GITHUB_SHA. That is not a flaky condition, it is an unsatisfiable one the
// moment staging moves: the newest deploy only ever gets newer, so the loop can
// never recover and burns its full timeout.
//
// Run 32995206476 gated c4330e8. Staging had advanced to 24985b0 — a DESCENDANT
// of c4330e8, containing every byte of it — and Netlify had published that. All
// 30 attempts printed `latest_staging=24985b0 state=ready` and the gate failed
// on a deploy that was strictly BETTER than the one it was demanding.
//
// The right question is "has a healthy staging deploy shipped this commit's
// content", which is an ancestry question, not a string comparison.
//
// These are text assertions rather than YAML-object ones on purpose: what has to
// stay correct is the SHELL, and the repo carries no YAML parser (see
// scripts/netlify-toml.test.mjs for the same approach applied to TOML).
//
// Run with: npx vitest run scripts/staging-gate.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  resolve(__dirname, "..", ".github", "workflows", "staging-gate.yml"),
  "utf8",
);

/** The deploy-verified job, from its key to end of file. */
const deployJob = workflow.slice(workflow.indexOf("\n  deploy-verified:"));

describe("staging gate — deploy convergence", () => {
  it("decides by ancestry, not by SHA equality", () => {
    // The whole fix in one line. `--is-ancestor "$GITHUB_SHA" "$SHA"` reads as
    // "is the commit under test contained in this deploy".
    expect(deployJob).toMatch(
      /git merge-base --is-ancestor "\$GITHUB_SHA" "\$SHA"/,
    );
  });

  it("does not gate on the newest deploy's SHA matching exactly", () => {
    // The exact shape of the shipped bug:
    //   if [ "$LATEST_SHA" = "$GITHUB_SHA" ] && [ "$STATE" = "ready" ]; then
    // An equality test against a single newest-deploy SHA must never be what
    // decides the gate again.
    expect(deployJob).not.toMatch(
      /\[\s*"\$LATEST_SHA"\s*=\s*"\$GITHUB_SHA"\s*\]/,
    );
  });

  it("is one-directional — an OLDER deploy must not satisfy the gate", () => {
    // phase-gate.yml deliberately accepts BOTH directions, because it runs on
    // main and staging legitimately sits on either side. This workflow runs ON
    // staging, so a deploy that is an ANCESTOR of the commit under test is an
    // older build and proves nothing about this push. Accepting it would let a
    // never-deployed commit pass the gate.
    expect(deployJob).not.toMatch(
      /git merge-base --is-ancestor "\$SHA" "\$GITHUB_SHA"/,
    );
  });

  it("scans every ready staging deploy, not just index 0", () => {
    // The target deploy can be pushed off `.[0]` by any later build.
    expect(deployJob).toMatch(/\.state == "ready"/);
    expect(deployJob).toMatch(/for SHA in \$READY_SHAS/);
  });

  it("reads the Functions manifest off the MATCHED deploy", () => {
    // Checking `.[0].available_functions` would verify a different artifact
    // from the one just accepted as proof this commit shipped.
    expect(deployJob).toMatch(/--arg sha "\$MATCH"/);
    expect(deployJob).toMatch(/\.commit_ref == \$sha/);
  });

  it("checks out full history so merge-base can answer", () => {
    // actions/checkout takes a depth-1 clone by default, in which
    // `git merge-base --is-ancestor` has nothing to work with.
    expect(deployJob).toMatch(/fetch-depth:\s*0/);
  });

  it("skips deploy SHAs this clone does not have", () => {
    // A force-push or a deploy of a rewritten commit would otherwise make
    // merge-base error out and, under `set -e`, fail the whole step.
    expect(deployJob).toMatch(/git cat-file -e "\$\{SHA\}\^\{commit\}"/);
  });

  it("fails fast only when the FAILED deploy is this commit's", () => {
    // A newer, unrelated build erroring is not this commit's problem. Bailing
    // on any `state == "error"` let one commit inherit another's red deploy.
    expect(deployJob).toMatch(/\[ "\$STATE" = "error" \] && \[ "\$NEWEST" = "\$GITHUB_SHA" \]/);
  });

  it("requests enough deploys that a busy branch cannot hide the match", () => {
    const perPage = deployJob.match(/per_page=(\d+)/);
    expect(perPage).not.toBeNull();
    expect(Number(perPage[1])).toBeGreaterThanOrEqual(50);
  });

  it("still guards jq against a non-array API body", () => {
    // The Netlify API can answer with an error envelope, a bare number or an
    // HTML error page. Feeding those to jq exits non-zero and, under `set -e`,
    // fails the step on a transient blip. This hardening predates the ancestry
    // fix and must survive it.
    expect(deployJob).toMatch(/if type == "array"/);
    expect(deployJob).toMatch(/curl -fsS/);
  });

  it("keeps every function the app cannot run without in the expected list", () => {
    const line = deployJob.match(/EXPECTED_FUNCTIONS="([^"]+)"/);
    expect(line).not.toBeNull();
    const listed = line[1].split(/\s+/);
    for (const fn of [
      "extract", "extractions", "ai", "admin-auth", "scheduled-runner",
      "billing-lifecycle", "billing-purge", "health-monitor",
      "payment-webhook", "create-checkout", "verify-payment",
    ]) {
      expect(listed).toContain(fn);
    }
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
