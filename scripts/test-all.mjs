#!/usr/bin/env node
// scripts/test-all.mjs — Comprehensive local test runner before pushing to git.
//
// Usage:
//   npm run test:all           # Runs readiness + unit + contract + integration + system + db + build + prerender + security + smoke
//   npm run test:all -- --quick # Runs pre-push subset (skips e2e smoke)
//   npm run test:all -- --visual # Also runs visual regression suite

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const isPrepush = args.includes("--prepush") || args.includes("--quick");
const includeVisual = args.includes("--visual");
const includeSmoke = !isPrepush || args.includes("--smoke");

const suites = [
  { name: "Production Readiness", cmd: "npm", args: ["run", "readiness"] },
  { name: "Unit Tests", cmd: "npm", args: ["run", "test:unit"] },
  { name: "Contract Tests", cmd: "npm", args: ["run", "test:contract"] },
  { name: "Integration Tests", cmd: "npm", args: ["run", "test:integration"] },
  { name: "System Tests", cmd: "npm", args: ["run", "test:system"] },
  { name: "Database & Referral Tests", cmd: "npm", args: ["run", "test:db"] },
  { name: "Production Build & Sync", cmd: "npm", args: ["run", "build"] },
  { name: "Prerender Integrity", cmd: "npm", args: ["run", "check:prerender"] },
  { name: "Security Check", cmd: "npm", args: ["run", "test:security"] },
];

if (includeSmoke) {
  suites.push({ name: "Playwright Smoke Tests", cmd: "npm", args: ["run", "test:e2e:smoke"] });
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
  const status = r.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
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
