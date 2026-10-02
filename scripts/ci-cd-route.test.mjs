// scripts/ci-cd-route.test.mjs
//
// Locks in the release ROUTE: feature → staging → main → prod, with GCP as the
// only deploy target. Every property below is something a well-meaning edit to
// a workflow could break silently — a workflow that deploys past a red gate, or
// to the wrong place, still shows a green tick.
//
// Text assertions on purpose (no YAML parser in the repo; the SHELL is what has
// to stay correct). Run: npx vitest run scripts/ci-cd-route.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WF_DIR = resolve(ROOT, ".github", "workflows");
const wf = (n) => readFileSync(resolve(WF_DIR, n), "utf8");
// Code only: comments legitimately MENTION things the workflow must never DO.
const code = (src) => src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const triggers = (src) => src.slice(src.indexOf("\non:"), src.indexOf("\nconcurrency:"));
const job = (src, id) => {
  const i = src.indexOf(`\n  ${id}:`);
  expect(i, `job ${id} exists`).toBeGreaterThan(-1);
  const rest = src.slice(i + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

describe("Netlify is not a deploy target", () => {
  it("no workflow calls the Netlify API or CLI", () => {
    for (const f of readdirSync(WF_DIR).filter((n) => n.endsWith(".yml"))) {
      expect(wf(f), f).not.toMatch(/api\.netlify\.com|netlify deploy|NETLIFY_AUTH_TOKEN|tools\/netlify-cli/);
    }
  });

  it("the netlify-cli toolchain stays deleted (its vulnerable tree was the reason)", () => {
    expect(existsSync(resolve(ROOT, "tools", "netlify-cli"))).toBe(false);
  });
});

describe("staging: gates → deploy, in one run", () => {
  const gate = wf("staging-gate.yml");
  it("deploys only via the reusable gcp-staging workflow, after the three gates", () => {
    const j = job(gate, "deploy-verified");
    expect(j).toMatch(/uses: \.\/\.github\/workflows\/gcp-staging\.yml/);
    expect(j).toMatch(/needs: \[test-suites, vulnerabilities, open-defects\]/);
  });
  it("gcp-staging has no push trigger of its own", () => {
    expect(triggers(wf("gcp-staging.yml"))).not.toMatch(/^\s+push:/m);
  });
});

describe("main: gates → staging proof → approved prod deploy", () => {
  const pg = wf("phase-gate.yml");

  it("runs on push to main", () => {
    expect(triggers(pg)).toMatch(/branches: \[main\]/);
  });

  it("the staging proof needs the gates, and the deploy needs the proof", () => {
    expect(job(pg, "staging-released")).toMatch(/needs: \[test-suites, vulnerabilities, open-defects\]/);
    const d = job(pg, "deploy-production");
    expect(d).toMatch(/needs: \[test-suites, vulnerabilities, open-defects, staging-released\]/);
    expect(d).toMatch(/uses: \.\/\.github\/workflows\/gcp-prod\.yml/);
  });

  it("proves EXACT content (tree equality), from a successful Staging Gate run", () => {
    const j = job(pg, "staging-released");
    expect(j).toMatch(/--workflow "Staging Gate"/);
    expect(j).toMatch(/--branch staging/);
    expect(j).toMatch(/--status success/);
    expect(j).toMatch(/\^\{tree\}/);
  });

  it("promotes the proven staging commit's images, not a guess", () => {
    const d = job(pg, "deploy-production");
    expect(d).toMatch(/staging_img_tag: \$\{\{ needs\.staging-released\.outputs\.tag \}\}/);
    expect(d).toMatch(/promote_from_staging: \$\{\{ needs\.staging-released\.outputs\.promote == 'true' \}\}/);
  });

  it("the only way past the staging proof is an explicit dispatch input", () => {
    const j = job(pg, "staging-released");
    expect(j).toMatch(/BYPASS: \$\{\{ inputs\.bypass_staging_check == true \}\}/);
    // …and a bypass never promotes: unproven bytes are built fresh, not shipped as staging's.
    expect(j).toMatch(/promote=false/);
  });

  it("never cancels an in-flight prod deploy", () => {
    expect(pg).toMatch(/group: prod-deploy\s*\n\s*cancel-in-progress: false/);
  });
});

describe("gcp-prod: a human approval sits in front of every prod step", () => {
  const prod = wf("gcp-prod.yml");
  it("runs inside the gcp-prod environment (required reviewers live there)", () => {
    expect(prod).toMatch(/environment: gcp-prod/);
  });
  it("has no push or pull_request trigger", () => {
    expect(triggers(prod)).not.toMatch(/^\s+push:/m);
    expect(triggers(prod)).not.toMatch(/^\s+pull_request/m);
  });
  it("still refuses without the typed confirmation", () => {
    expect(prod).toMatch(/inputs\.confirm_env \}\}" != "prod"/);
  });
  it("is callable by the phase-gate and manually runnable", () => {
    expect(triggers(prod)).toMatch(/workflow_call:/);
    expect(triggers(prod)).toMatch(/workflow_dispatch:/);
  });
  it("never touches the production database", () => {
    expect(code(prod)).not.toMatch(/skip_db|migrate-db|cutover-db/);
  });
});

describe("deploy workflows read ONE env file secret and verify its identity", () => {
  for (const [file, env] of [["gcp-staging.yml", "staging"], ["gcp-prod.yml", "prod"]]) {
    it(`${file} writes ENV_FILE and refuses the wrong environment's file`, () => {
      const src = wf(file);
      expect(src).toMatch(/ENV_FILE: \$\{\{ secrets\.ENV_FILE \}\}/);
      expect(src).toMatch(new RegExp(`DATIQ_ENV=${env}`));
    });
    it(`${file} skips bootstrap — CI deploys, it does not provision`, () => {
      expect(wf(file)).toMatch(/SKIP_BOOTSTRAP: "1"/);
    });
  }
});
