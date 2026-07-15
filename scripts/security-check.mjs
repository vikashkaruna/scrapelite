#!/usr/bin/env node
/**
 * Release security checks with deliberately safe output.
 *
 * - Scans tracked, text-like files for credential-shaped values.
 * - Never reads .env files (tracked or otherwise) and never prints a match.
 * - Audits production dependencies only; high/critical findings block a release.
 *
 * Lower-severity findings are reported for triage but do not fail the command.
 * A future exception must be documented in security-audit-allowlist.json with
 * a package, advisory identifier, reason, and non-expired date; transitive
 * dependencies are not exempt merely because they are transitive.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|html?|css|md|sh|toml|sql|svg)$/i;
const MAX_SCAN_BYTES = 1_000_000;

const secretPatterns = [
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|gho_[A-Za-z0-9]{36})\b/],
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ["Anthropic secret key", /\bsk-ant-[A-Za-z0-9_-]{16,}\b/],
  ["private key block", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["JWT-like token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

function isEnvFile(file) {
  return path.basename(file).startsWith(".env");
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

function scanForSecrets() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (isEnvFile(file) || !TEXT_FILE.test(file)) continue;
    const absolute = path.join(root, file);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_SCAN_BYTES) continue;

    // A matching value is intentionally never retained or printed.
    const content = readFileSync(absolute, "utf8");
    for (const [kind, expression] of secretPatterns) {
      expression.lastIndex = 0;
      if (expression.test(content)) findings.push({ file, kind });
    }
  }
  return findings;
}

function loadAllowlist() {
  const filename = path.join(root, "security-audit-allowlist.json");
  try {
    const parsed = JSON.parse(readFileSync(filename, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    return new Set(
      (parsed.exceptions || [])
        .filter((entry) => entry.package && entry.advisory && entry.reason && entry.expires >= today)
        .map((entry) => `${entry.package}:${entry.advisory}`),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw new Error("security-audit-allowlist.json must contain valid JSON");
  }
}

function auditDependencies() {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("npm audit did not return a JSON report");
  }

  const counts = report.metadata?.vulnerabilities || {};
  const allowed = loadAllowlist();
  const blocking = [];
  for (const [pkg, vulnerability] of Object.entries(report.vulnerabilities || {})) {
    const matchingAdvisory = (vulnerability.via || []).find((item) => {
      if (typeof item !== "object" || !item.url) return false;
      const advisory = item.url.split("/").pop();
      return allowed.has(`${pkg}:${advisory}`);
    });
    if (BLOCKING_SEVERITIES.has(vulnerability.severity) && !matchingAdvisory) {
      blocking.push({ package: pkg, severity: vulnerability.severity });
    }
  }
  return { counts, blocking };
}

let failed = false;
try {
  const findings = scanForSecrets();
  if (findings.length) {
    failed = true;
    console.error("Secret-pattern scan failed. Matched values are intentionally redacted:");
    for (const finding of findings) console.error(`- ${finding.file} (${finding.kind})`);
  } else {
    console.log("Secret-pattern scan passed (tracked text files only; .env files excluded).");
  }

  const { counts, blocking } = auditDependencies();
  console.log(
    `Production dependency audit: ${counts.critical || 0} critical, ${counts.high || 0} high, ` +
      `${counts.moderate || 0} moderate, ${counts.low || 0} low.`,
  );
  if (blocking.length) {
    failed = true;
    console.error("Blocking production dependency vulnerabilities:");
    for (const finding of blocking) console.error(`- ${finding.package} (${finding.severity})`);
  } else {
    console.log("Dependency audit passed the high/critical release policy.");
  }
} catch (error) {
  failed = true;
  console.error(`Security check could not complete: ${error.message}`);
}

if (failed) process.exitCode = 1;
