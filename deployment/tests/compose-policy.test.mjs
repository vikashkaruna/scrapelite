// deployment/tests/compose-policy.test.mjs — guards the local stack's
// container lifecycle contract:
//   1. every LONG-RUNNING service in the local compose files declares
//      `restart: unless-stopped` — the one policy that keeps stop/pause
//      meaningful (a container the operator stopped or paused stays down
//      across Docker Desktop restarts; `always` would fight `down.sh`,
//      which now stops by default so local test data survives)
//   2. the one-shot services stay one-shots (db-passwords "no", migrator
//      profile-gated with no policy) — they must never join the reboot set
//   3. `restart: always` appears nowhere — it would silently undo 1 and 2
//   4. the lifecycle scripts (up/down/stack) are bash-syntax-clean and
//      stack.sh is executable — they are the stop/start/pause interface
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(HERE, "..");
const REPO = join(DEPLOY, "..");

/**
 * Parse a compose file's `services:` section into { name → block text }.
 * Service keys sit at exactly two spaces of indent; their keys deeper.
 * Deliberately not a YAML dependency — these files are simple and flat.
 */
function servicesOf(relPath) {
  const lines = readFileSync(join(DEPLOY, relPath), "utf8").split("\n");
  const out = {};
  let current = null;
  let inServices = false;
  for (const line of lines) {
    if (/^services:\s*(?:#.*)?$/.test(line)) { inServices = true; current = null; continue; }
    if (!inServices) continue;
    // A top-level key (zero indent, not a comment) ends the services section.
    if (/^[^ #\t]/.test(line)) { inServices = false; continue; }
    const svc = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (svc) { current = svc[1]; out[current] = ""; continue; }
    if (current && /^ {3,}/.test(line)) out[current] += `${line}\n`;
  }
  return out;
}

/** The `restart:` value inside one service block ("" when absent), comments and quotes stripped. */
function restartOf(block) {
  const m = /^ {4,}restart:[ \t]*(.*?)[ \t]*$/m.exec(block);
  if (!m) return "";
  return m[1].replace(/#.*$/, "").trim().replace(/^['"]|['"]$/g, "");
}

describe("compose restart policies", () => {
  const appServices = servicesOf("compose/compose.yaml");
  const localServices = servicesOf("compose/compose.local.yaml");

  it("every long-running app service is restart: unless-stopped", () => {
    const longRunning = ["gateway", "web", "admin", "trackers", "api", "jobs", "scheduler"];
    for (const name of longRunning) {
      expect(appServices[name], `service ${name} missing from compose.yaml`).toBeTruthy();
      expect(restartOf(appServices[name]), `service ${name}`).toBe("unless-stopped");
    }
  });

  it("supabase-lite long-running services are restart: unless-stopped", () => {
    const longRunning = ["db", "auth", "rest", "mailpit", "pg-meta", "studio"];
    for (const name of longRunning) {
      expect(localServices[name], `service ${name} missing from compose.local.yaml`).toBeTruthy();
      expect(restartOf(localServices[name]), `service ${name}`).toBe("unless-stopped");
    }
  });

  it("one-shot services stay one-shots (never join the reboot set)", () => {
    expect(restartOf(localServices["db-passwords"])).toBe("no");
    expect(restartOf(localServices["migrator"])).toBe("");
  });

  it("restart: always appears nowhere — it would fight stop/pause", () => {
    for (const rel of ["compose/compose.yaml", "compose/compose.local.yaml", "../n8n/docker-compose.yml"]) {
      const text = readFileSync(join(DEPLOY, rel), "utf8");
      expect(/restart:\s*(['"]?)always\b/.test(text), rel).toBe(false);
    }
  });

  it("the n8n reference stack keeps unless-stopped too", () => {
    const n8n = servicesOf("../n8n/docker-compose.yml");
    expect(n8n.n8n).toBeTruthy();
    expect(restartOf(n8n.n8n)).toBe("unless-stopped");
  });
});

describe("lifecycle scripts", () => {
  const scripts = ["scripts/up.sh", "scripts/down.sh", "scripts/stack.sh"];

  it.each(scripts)("bash -n passes for %s", (rel) => {
    expect(() => execFileSync("bash", ["-n", join(DEPLOY, rel)], { stdio: "pipe" })).not.toThrow();
  });

  it("stack.sh is executable", () => {
    const mode = statSync(join(DEPLOY, "scripts/stack.sh")).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});
