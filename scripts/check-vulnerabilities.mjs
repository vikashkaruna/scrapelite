#!/usr/bin/env node
// scripts/check-vulnerabilities.mjs — dependency-vulnerability gate
//
// Runs `npm audit --json` and FAILS the gate when any HIGH or CRITICAL
// advisory is present, unless that advisory has been manually bypassed in
// .github/gate-bypass/vulnerabilities.json.
//
// A bypass entry is only honored when it carries BOTH:
//   - a "todo"    (the future remediation note — required by the release policy)
//   - an "expires" date (ISO yyyy-mm-dd) that has not passed
//
// Bypass file format (.github/gate-bypass/vulnerabilities.json):
//   {
//     "bypasses": [
//       {
//         "id": "GHSA-xxxx-xxxx-xxxx",
//         "package": "some-dep",
//         "reason": "dev-only tooling, not shipped to browser",
//         "todo": "TODO: bump some-dep to >=2.0 when vite 6 migration lands",
//         "expires": "2026-09-30",
//         "approvedBy": "vikashkaruna"
//       }
//     ]
//   }
//
// Usage:  node scripts/check-vulnerabilities.mjs
// Env:    VULN_AUDIT_LEVEL  — minimum blocking severity (default "high")

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const BYPASS_FILE = resolve(repoRoot, ".github/gate-bypass/vulnerabilities.json");

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const level = (process.env.VULN_AUDIT_LEVEL || "high").toLowerCase();
const minRank = SEVERITY_RANK[level] ?? SEVERITY_RANK.high;

// ── load bypass allowlist ───────────────────────────────────────────
let bypasses = [];
if (existsSync(BYPASS_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(BYPASS_FILE, "utf8"));
    bypasses = Array.isArray(parsed) ? parsed : parsed.bypasses || [];
  } catch (e) {
    console.error(`[vuln-gate] could not parse ${BYPASS_FILE}: ${e.message}`);
    process.exit(1);
  }
}

const today = new Date().toISOString().slice(0, 10);
function activeBypassFor(ghsaIds, pkgName) {
  return bypasses.find((b) => {
    const matches =
      (b.id && ghsaIds.includes(b.id)) || (b.package && b.package === pkgName);
    if (!matches) return false;
    if (!b.todo || !/todo/i.test(String(b.todo))) {
      console.error(
        `[vuln-gate] bypass for ${b.id || b.package} REJECTED — missing "todo" note`
      );
      return false;
    }
    if (!b.expires || String(b.expires) < today) {
      console.error(
        `[vuln-gate] bypass for ${b.id || b.package} REJECTED — expired or missing "expires" (${b.expires || "none"})`
      );
      return false;
    }
    return true;
  });
}

// ── run npm audit ───────────────────────────────────────────────────
let audit;
try {
  // npm audit exits non-zero when vulnerabilities exist — capture stdout anyway.
  const out = execSync("npm audit --json", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  audit = JSON.parse(out);
} catch (e) {
  if (e.stdout) {
    try {
      audit = JSON.parse(e.stdout);
    } catch {
      console.error("[vuln-gate] npm audit produced unparseable output");
      process.exit(1);
    }
  } else {
    console.error(`[vuln-gate] npm audit failed to run: ${e.message}`);
    process.exit(1);
  }
}

const vulns = audit.vulnerabilities || {};
const blocking = [];
const bypassed = [];

for (const [pkgName, v] of Object.entries(vulns)) {
  const rank = SEVERITY_RANK[v.severity] ?? 0;
  if (rank < minRank) continue;

  // Collect GHSA ids from the advisory chain (via[] mixes strings + objects)
  const ghsaIds = (v.via || [])
    .filter((x) => typeof x === "object" && x.url)
    .map((x) => {
      const m = String(x.url).match(/GHSA-[\w-]+/);
      return m ? m[0] : null;
    })
    .filter(Boolean);

  const bp = activeBypassFor(ghsaIds, pkgName);
  const entry = {
    package: pkgName,
    severity: v.severity,
    ids: ghsaIds.length ? ghsaIds.join(", ") : "(transitive)",
  };
  if (bp) bypassed.push({ ...entry, todo: bp.todo, expires: bp.expires });
  else blocking.push(entry);
}

// ── report ──────────────────────────────────────────────────────────
if (bypassed.length) {
  console.log(`[vuln-gate] ${bypassed.length} advisory(ies) bypassed with active TODO:`);
  for (const b of bypassed) {
    console.log(`  ⚠ ${b.package} [${b.severity}] ${b.ids} — ${b.todo} (expires ${b.expires})`);
  }
}

if (blocking.length) {
  console.error(
    `[vuln-gate] ✗ ${blocking.length} ${level}+ vulnerability(ies) block this release:`
  );
  for (const b of blocking) {
    console.error(`  ✗ ${b.package} [${b.severity}] ${b.ids}`);
  }
  console.error(
    `[vuln-gate] Fix with "npm audit fix", or add a bypass WITH a TODO + expiry to .github/gate-bypass/vulnerabilities.json`
  );
  process.exit(1);
}

console.log(`[vuln-gate] ✓ no ${level}+ vulnerabilities (bypassed: ${bypassed.length})`);
