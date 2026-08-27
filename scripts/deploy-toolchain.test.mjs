// scripts/deploy-toolchain.test.mjs
//
// Guard tests for the PRODUCTION DEPLOY TOOLCHAIN.
//
// The production deploy is the one step in the whole pipeline that runs after
// every gate is green, after a human has approved, and after an operator has
// hand-unlocked production in the Netlify UI. It is the worst possible place to
// discover that a dependency resolved differently today than it did yesterday.
//
// On 2026-08-27 it did exactly that. `npx --yes netlify-cli` re-resolves the
// CLI's entire transitive tree from the live npm registry on every run;
// @netlify/dev@5.0.4 was published 27 minutes before the deploy declaring
// @netlify/ai@^1.0.1, a version that has never existed, and npm answered
// ETARGET. No commit in this repository was involved.
//
// These tests pin the shape of the fix so it cannot quietly regress: the deploy
// tool is installed from a committed lockfile, and the workflow installs it
// from that lockfile rather than from the registry.
//
// They run in `npm run test:unit` (which covers `scripts/`), so the Staging
// Gate and the pre-push hook both enforce this — the production deploy job
// itself only ever runs on `main`, which is far too late to find out.
//
// Run with: npx vitest run scripts/deploy-toolchain.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const toolDir = resolve(root, "tools", "netlify-cli");
const toolPkgPath = resolve(toolDir, "package.json");
const toolLockPath = resolve(toolDir, "package-lock.json");
const workflowPath = resolve(root, ".github", "workflows", "phase-gate.yml");

const workflow = readFileSync(workflowPath, "utf8");

// The `run:` bodies only — a `#` comment describing the old bug must never make
// a test about the real commands pass or fail.
const workflowCommands = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

describe("deploy toolchain — the pin exists and is exact", () => {
  it("ships a package.json and a committed lockfile", () => {
    expect(existsSync(toolPkgPath)).toBe(true);
    // Without the lockfile `npm ci` cannot run at all, and the workflow would
    // be back to resolving the tree live — the exact failure being guarded.
    expect(existsSync(toolLockPath)).toBe(true);
  });

  it("pins netlify-cli to one exact version, not a range", () => {
    const pkg = JSON.parse(readFileSync(toolPkgPath, "utf8"));
    const spec = pkg.dependencies?.["netlify-cli"];
    expect(spec).toBeTruthy();
    // `^27.1.2` would let the top-level version float on every fresh install,
    // which is half of what this directory exists to stop.
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a lockfile that agrees with package.json", () => {
    const pkg = JSON.parse(readFileSync(toolPkgPath, "utf8"));
    const lock = JSON.parse(readFileSync(toolLockPath, "utf8"));
    // `npm ci` aborts outright on this mismatch, so catching it here turns a
    // failed release into a failed pre-push.
    expect(lock.packages["node_modules/netlify-cli"].version).toBe(
      pkg.dependencies["netlify-cli"],
    );
  });

  it("freezes the transitive tree, not just the top-level version", () => {
    const lock = JSON.parse(readFileSync(toolLockPath, "utf8"));
    // @netlify/dev is the package that floated to 5.0.4 and took the release
    // down. Its presence at a resolved version in the lockfile is the whole
    // point: a top-level pin alone would still have let it move.
    const dev = lock.packages["node_modules/@netlify/dev"];
    expect(dev?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(lock.packages).length).toBeGreaterThan(100);
  });
});

describe("phase-gate.yml — the deploy never resolves its tool from the registry", () => {
  it("installs the deploy tool with `npm ci` from the pinned lockfile", () => {
    expect(workflowCommands).toMatch(/npm ci --prefix tools\/netlify-cli/);
  });

  it("never invokes netlify-cli through npx", () => {
    // `npx --yes netlify-cli` (or `npx netlify-cli@27.1.2`, which is no safer —
    // npx re-resolves every transitive range regardless of the top-level pin).
    expect(workflowCommands).not.toMatch(/npx[^\n]*netlify-cli/);
  });

  it("runs the deploy from the locked local binary", () => {
    expect(workflowCommands).toContain(
      "./tools/netlify-cli/node_modules/.bin/netlify deploy",
    );
  });

  it("proves the CLI actually runs before it touches production", () => {
    // The toolchain is installed with --ignore-scripts (the native postinstalls
    // belong to `netlify dev`, not to `deploy`). That trade is only safe because
    // this step loads the deploy command first, with production untouched.
    const deployJob = workflow.slice(
      workflow.indexOf("  deploy-production:"),
      workflow.indexOf("  smoke-production:"),
    );
    expect(deployJob).toContain("--ignore-scripts");
    const verifyAt = deployJob.indexOf("Verify the deploy toolchain runs");
    const deployAt = deployJob.indexOf("Deploy to Netlify (production)");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(deployAt);
  });
});

describe("phase-gate.yml — the auto-rollback is a command that exists", () => {
  const smokeJob = workflow.slice(workflow.indexOf("  smoke-production:"));

  it("never calls `netlify rollback`", () => {
    // netlify-cli has NO `rollback` command — it exits 2 with the generic help
    // text. The workflow called it for months, so the one safety net that pulls
    // a bad release off datiq.app could never have fired.
    // Matches both spellings the workflow has used: `netlify rollback` and
    // `npx --yes netlify-cli rollback`. The first version of this test only
    // matched the former and passed against the very code it was written to
    // catch — a green test that asserts nothing is worse than no test.
    expect(workflowCommands).not.toMatch(/netlify(-cli)?\s+rollback/);
  });

  it("restores through the documented REST endpoint instead", () => {
    // restoreSiteDeploy — POST /sites/{site_id}/deploys/{deploy_id}/restore,
    // confirmed against Netlify's own open-api spec.
    expect(smokeJob).toMatch(/deploys\/\$TARGET\/restore/);
    expect(smokeJob).toMatch(/context=production/);
  });

  it("only restores a deploy that is ready and is not the failed one", () => {
    // Restoring the deploy that just failed its smoke test would report a
    // successful rollback while leaving the bad build live.
    expect(smokeJob).toContain('select(.state == "ready")');
    expect(smokeJob).toContain("select(.id != $bad)");
  });

  it("verifies the restore actually changed what production serves", () => {
    // A rollback that claims success without moving published_deploy is worse
    // than one that fails loudly, because nobody goes and looks.
    expect(smokeJob).toContain('if [ "$NOW" != "$TARGET" ]');
    expect(smokeJob).toMatch(/Rollback did not take effect/);
  });

  it("needs no npm install to run", () => {
    // The recovery path must not depend on the thing that broke the deploy.
    expect(smokeJob).not.toMatch(/npm ci --prefix tools\/netlify-cli/);
  });
});
