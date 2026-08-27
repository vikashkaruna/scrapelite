#!/usr/bin/env node
// scripts/install-hook.mjs — install scripts/pre-push.sh as the git pre-push hook.
//
//   npm run ci:install-hook
//
// ── WHY THIS IS NOT `cp scripts/pre-push.sh .git/hooks/pre-push` ───────────
// It used to be, and in a git WORKTREE that fails with "Not a directory":
// a worktree's `.git` is a FILE containing `gitdir: …`, not a directory. So
// anybody working in a worktree — which is how every Claude session in this
// repo works — silently could not refresh the hook.
//
// That matters more than it sounds. Hooks live in the SHARED common git dir,
// so all worktrees run the same one; if the only people positioned to notice
// it had gone stale were also the only people who could not reinstall it, it
// stays stale. On 2026-08-27 the installed hook predated the prerender
// staleness gate entirely, and the prerendered pages had gone stale twice.
//
// `git rev-parse --git-common-dir` resolves correctly from a worktree, from
// the main checkout, and from a subdirectory of either.

import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "scripts", "pre-push.sh");

function gitCommonDir() {
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: ROOT, encoding: "utf8",
  }).trim();
  // Returns a relative path (".git") from the main checkout, absolute from a worktree.
  return resolve(ROOT, out);
}

const hooksDir = join(gitCommonDir(), "hooks");
if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

const target = join(hooksDir, "pre-push");
const wasStale = existsSync(target) &&
  readFileSync(target, "utf8") !== readFileSync(SOURCE, "utf8");

copyFileSync(SOURCE, target);
chmodSync(target, 0o755);

console.log(`Installed pre-push hook → ${target}`);
if (wasStale) {
  console.log("  (it was out of date — gates added since the last install were not running)");
}
console.log("Every git push will now run npm run test:prepush first.");
