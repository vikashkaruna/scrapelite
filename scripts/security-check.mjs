#!/usr/bin/env node
// Repository security gate: tracked-source secret scan plus production audit.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = ["package.json", "package-lock.json", "netlify.toml", ".gitignore", ".env.example"];
const findings = [];
for (const file of required) if (!existsSync(resolve(repoRoot, file))) findings.push(`missing required file: ${file}`);

let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter(Boolean).filter((file) => !file.startsWith(".claude/worktrees/"));
} catch (error) { findings.push(`could not enumerate tracked files: ${error.message}`); }

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\b(?:sk|rk|whsec|rzp_live)_[A-Za-z0-9_-]{16,}\b/,
];
const browserSecretEnv = /(?:import\.meta\.env|VITE_)[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE)[A-Z0-9_]*/;
const sourceKeyExport = /export\s+(?:const|let|var)\s+[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*[^;]+/;
const isFixture = (file) => /(?:^|\/)(?:__tests__|.*\.test\.|.*\.spec\.|fixtures?)(?:\/|\.)/i.test(file);

for (const file of tracked) {
  let source;
  try { source = readFileSync(resolve(repoRoot, file), "utf8"); } catch { continue; }
  for (const pattern of secretPatterns) {
    if (pattern.test(source) && !isFixture(file)) findings.push(`credential-like material in ${file}`);
  }
  if (file.startsWith("src/") && browserSecretEnv.test(source)) findings.push(`server-only secret env referenced by browser source: ${file}`);
  if (file.startsWith("src/") && sourceKeyExport.test(source)) findings.push(`credential-shaped value exported from browser source: ${file}`);
}

if (findings.length) {
  console.error(`[security-check] ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`  ✗ ${finding}`);
  process.exit(1);
}

if (process.env.SECURITY_CHECK_SKIP_AUDIT !== "1") {
  try {
    const output = execFileSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
    const audit = JSON.parse(output);
    const blocking = Object.entries(audit.vulnerabilities || {}).filter(([, item]) => ["high", "critical"].includes(item.severity));
    if (blocking.length) {
      console.error(`[security-check] ${blocking.length} high/critical dependency advisory group(s)`);
      for (const [pkg, item] of blocking) console.error(`  ✗ ${pkg} [${item.severity}]`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`[security-check] dependency audit unavailable or failed: ${error.message}`);
    console.error("[security-check] Set SECURITY_CHECK_SKIP_AUDIT=1 only for offline local source-only checks.");
    process.exit(1);
  }
} else {
  console.warn("[security-check] dependency audit skipped by SECURITY_CHECK_SKIP_AUDIT=1");
}

console.log("[security-check] source and dependency checks passed");
