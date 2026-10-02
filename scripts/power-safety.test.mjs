// scripts/power-safety.test.mjs
//
// The sleep/wake feature exists to SAVE money without ever risking data. These
// tests pin the guarantees that make it safe to run casually (and from CI):
//   - it is staging-only (prod refused);
//   - the code paths it uses contain no deletion verb at all;
//   - `down.sh --sleep` is handled before any destructive code and cannot be
//     combined with the destructive flags;
//   - a deploy wakes a sleeping staging first.
// Text assertions on purpose: what must stay true is the shell.
// Run: npx vitest run scripts/power-safety.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const D = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deployment", "scripts");
const read = (p) => readFileSync(resolve(D, p), "utf8");
/** Code only — comments legitimately talk about what the script never does. */
const code = (s) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const DESTRUCTIVE = /\b(delete|destroy|rm\s+-|rm\s|--wipe|--delete-data|down\s+-v|--remove-orphans|volume\s+rm|sql\s+instances\s+delete)\b/;

describe("power.sh — soft shutdown, nothing deleted", () => {
  const src = read("gcp/power.sh");
  it("contains no deletion verb", () => {
    expect(code(src)).not.toMatch(DESTRUCTIVE);
  });
  it("stops Cloud SQL only by flipping the activation policy", () => {
    expect(code(src)).toMatch(/instances patch .*--activation-policy=NEVER/);
    expect(code(src)).toMatch(/instances patch .*--activation-policy=ALWAYS/);
    expect(code(src)).not.toMatch(/sql instances (delete|restart|import|export)/);
  });
  it("refuses everything except staging", () => {
    expect(src).toMatch(/\[ "\$ENV_NAME" = "staging" \]/);
    expect(src).toMatch(/Prod is never put to sleep/);
  });
  it("overwrites its bookkeeping file on wake instead of deleting it", () => {
    expect(code(src)).toMatch(/write_state "" ""/);
  });
  it("resumes only the jobs sleep paused", () => {
    expect(code(src)).toMatch(/for job in \$\(read_state_jobs\)/);
  });
  it("records what to resume BEFORE it stops the database", () => {
    const c = code(src);
    expect(c.indexOf("write_state \"$remember\"")).toBeGreaterThan(-1);
    expect(c.indexOf("write_state \"$remember\"")).toBeLessThan(c.indexOf("--activation-policy=NEVER"));
  });
  it("supports DRY_RUN", () => {
    expect(src).toMatch(/DRY_RUN/);
  });
});

describe("gcp/down.sh --sleep", () => {
  const src = read("gcp/down.sh");
  it("execs power.sh BEFORE any teardown code can run", () => {
    const sleepAt = src.indexOf('exec "$HERE/power.sh"');
    expect(sleepAt).toBeGreaterThan(-1);
    for (const marker of ["gcloud run services delete", "gcloud scheduler jobs delete", "gcloud secrets delete", "--delete-data) DELETE_DATA=1"]) {
      const at = src.indexOf(marker);
      if (at !== -1) expect(sleepAt).toBeLessThan(at);
    }
  });
  it("cannot be combined with other flags", () => {
    expect(src).toMatch(/cannot be combined with other flags/);
  });
});

describe("local down.sh --sleep", () => {
  const src = read("down.sh");
  const branch = src.slice(src.indexOf('if [ "$SLEEP" = "1" ]; then\n  if docker info'), src.indexOf('elif [ "$WIPE"'));
  it("is mutually exclusive with -r and -v", () => {
    expect(src).toMatch(/--sleep is the non-destructive mode — it cannot be combined with -r or -v/);
  });
  it("only ever stops containers — the sleep branch has no removal", () => {
    expect(branch).toMatch(/\$COMPOSE stop/);
    expect(branch).not.toMatch(DESTRUCTIVE);
  });
  it("leaves Docker Desktop running unless --quit-docker is given", () => {
    // The quit call must sit behind the opt-in flag, never run unconditionally.
    const q = branch.indexOf("quit_docker_desktop");
    expect(q).toBeGreaterThan(-1);
    expect(branch.slice(0, q)).toMatch(/if \[ "\$QUIT_DOCKER" = "1" \]; then/);
    expect(branch).toMatch(/Docker Desktop left running/);
  });
  it("--quit-docker needs --sleep and cannot target single units", () => {
    expect(src).toMatch(/--quit-docker only applies with --sleep/);
    expect(src).toMatch(/--quit-docker stops EVERY unit/);
  });
});

describe("docker-power helpers", () => {
  const src = read("lib/docker-power.sh");
  it("only starts or quits the Docker Desktop app, never removes anything", () => {
    expect(code(src)).not.toMatch(DESTRUCTIVE);
    expect(code(src)).toMatch(/open -a Docker/);
    expect(code(src)).toMatch(/quit app "Docker"/);
  });
  it("up.sh and stack.sh wake Docker Desktop before using it", () => {
    expect(read("up.sh")).toMatch(/ensure_docker_running/);
    expect(read("stack.sh")).toMatch(/ensure_docker_running/);
  });
});

describe("deploy wakes a sleeping staging", () => {
  it("deploy-staging.sh wakes first (skippable with SKIP_WAKE)", () => {
    const src = read("gcp/deploy-staging.sh");
    expect(src).toMatch(/power\.sh" staging wake/);
    expect(src.indexOf("power.sh\" staging wake")).toBeLessThan(src.indexOf('step "bootstrap"'));
    expect(src).toMatch(/SKIP_WAKE/);
  });
  it("the staging workflow can sleep it again, only after a green smoke and only on request", () => {
    const wf = readFileSync(resolve(D, "..", "..", ".github", "workflows", "gcp-staging.yml"), "utf8");
    expect(wf).toMatch(/if: success\(\) && inputs\.sleep_after/);
    expect(wf).toMatch(/sleep_after:\s*\n\s+type: boolean\s*\n\s+default: false/);
  });
});
