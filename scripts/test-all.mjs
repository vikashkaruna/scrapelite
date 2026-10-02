#!/usr/bin/env node
// scripts/test-all.mjs — Comprehensive local test runner before pushing to git.
//
// Usage:
//   npm run test:all            # Runs readiness + unit + contract + integration
//                               # + system + deployment + db + vuln + defects
//                               # + build + prerender + security + smoke
//   npm run test:all -- --quick # Runs pre-push subset (skips e2e smoke)
//   npm run test:all -- --visual # Also runs visual regression suite
//   npm run test:all -- --journeys # Also runs the Playwright journey specs
//   npm run test:all -- --a11y     # Also runs the Playwright a11y specs
//   npm run test:all -- --all-browsers # Smoke on chromium+firefox+webkit
//   npm run test:all -- --release  # Also runs the release regression suite
//
// The default set mirrors what the GitHub gates run (phase-gate.yml +
// staging-gate.yml): a green `npm run test:all` locally is the same bar CI
// enforces before a deploy.

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const isPrepush = args.includes("--prepush") || args.includes("--quick");
const includeVisual = args.includes("--visual");
const includeJourneys = args.includes("--journeys");
const includeA11y = args.includes("--a11y");
const includeAllBrowsers = args.includes("--all-browsers");
const includeRelease = args.includes("--release");
const includeSmoke = !isPrepush || args.includes("--smoke");

const suites = [
  { name: "Production Readiness", cmd: "npm", args: ["run", "readiness"] },
  { name: "Unit Tests", cmd: "npm", args: ["run", "test:unit"] },
  { name: "Contract Tests", cmd: "npm", args: ["run", "test:contract"] },
  { name: "Integration Tests", cmd: "npm", args: ["run", "test:integration"] },
  { name: "System Tests", cmd: "npm", args: ["run", "test:system"] },
  { name: "Deployment Config Tests", cmd: "npx", args: ["vitest", "run", "deployment"] },
  { name: "Database & Referral Tests", cmd: "npm", args: ["run", "test:db"] },
  { name: "Dependency Vulnerabilities", cmd: "node", args: ["scripts/check-vulnerabilities.mjs"] },
  // The defects gate queries the GitHub issues API — it needs a token, which
  // CI (phase-gate.yml) provides. Without one locally it prints a SKIP line
  // rather than failing (and never fakes a pass).
  {
    name: "Open Defects Gate",
    cmd: "node",
    args: ["scripts/check-open-defects.mjs"],
    skip: !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN,
    skipReason: "no GH_TOKEN/GITHUB_TOKEN (CI runs this with one)",
  },
  { name: "Production Build & Sync", cmd: "npm", args: ["run", "build"] },
  { name: "Prerender Integrity", cmd: "npm", args: ["run", "check:prerender"] },
  { name: "Security Check", cmd: "npm", args: ["run", "test:security"] },
];

if (includeRelease) {
  suites.push({ name: "Release Regression", cmd: "npm", args: ["run", "test:release"] });
}

if (includeSmoke) {
  const smokeArgs = ["run", includeAllBrowsers ? "test:e2e:smoke:all-browsers" : "test:e2e:smoke"];
  suites.push({ name: includeAllBrowsers ? "Playwright Smoke Tests (all browsers)" : "Playwright Smoke Tests", cmd: "npm", args: smokeArgs });
}

if (includeJourneys) {
  suites.push({ name: "Playwright Journey Tests", cmd: "npm", args: ["run", "test:e2e:journeys"] });
}

if (includeA11y) {
  suites.push({ name: "Playwright Accessibility Tests", cmd: "npm", args: ["run", "test:e2e:a11y"] });
}

if (includeVisual) {
  suites.push({ name: "Playwright Visual Tests", cmd: "npm", args: ["run", "test:e2e:visual"] });
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.log(`\n${BOLD}${CYAN}=== DatIQ Local Pre-Push Test Suite ===${RESET}\n`);
console.log(`${DIM}Running ${suites.length} test suites...${RESET}\n`);

const results = [];
const overallStart = performance.now();

for (let i = 0; i < suites.length; i++) {
  const suite = suites[i];
  const prefix = `[${i + 1}/${suites.length}]`;
  process.stdout.write(`${BOLD}${prefix} ${suite.name}...${RESET} `);

  if (suite.skip) {
    console.log(`${CYAN}SKIPPED${RESET} ${DIM}(${suite.skipReason})${RESET}`);
    results.push({ name: suite.name, passed: true, duration: "0.00", skipped: true });
    continue;
  }

  const start = performance.now();
  const exitCode = await new Promise((resolve) => {
    const proc = spawn(suite.cmd, suite.args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

  const duration = ((performance.now() - start) / 1000).toFixed(2);

  if (exitCode.code === 0) {
    console.log(`${GREEN}PASSED${RESET} ${DIM}(${duration}s)${RESET}`);
    results.push({ name: suite.name, passed: true, duration });
  } else {
    console.log(`${RED}FAILED${RESET} ${DIM}(${duration}s)${RESET}`);
    console.error(`\n${RED}Error output for ${suite.name}:${RESET}\n`);
    if (exitCode.stdout) console.log(exitCode.stdout);
    if (exitCode.stderr) console.error(exitCode.stderr);
    results.push({ name: suite.name, passed: false, duration });
    break;
  }
}

const totalDuration = ((performance.now() - overallStart) / 1000).toFixed(2);
const allPassed = results.every((r) => r.passed) && results.length === suites.length;

console.log(`\n${BOLD}${CYAN}───────────────────────────────────────────────────${RESET}`);
console.log(`${BOLD}Test Summary (${totalDuration}s total):${RESET}`);
for (const r of results) {
  const status = r.skipped ? `${CYAN}◌ SKIP${RESET}` : r.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
  console.log(`  ${status}  ${r.name.padEnd(30)} ${DIM}(${r.duration}s)${RESET}`);
}
console.log(`${BOLD}${CYAN}───────────────────────────────────────────────────${RESET}\n`);

if (!allPassed) {
  console.error(`${RED}${BOLD}One or more test suites failed. Fix the issues before pushing.${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}All test suites passed! Ready to push.${RESET}\n`);
  process.exit(0);
}
