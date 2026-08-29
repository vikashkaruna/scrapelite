// scripts/bump-version.mjs — the one place DatIQ's version number changes.
//
// Bumps the `version` field in package.json, which is the single source of
// truth the UI reads via vite.config.js's __APP_VERSION__ define — the only
// place it's displayed is /about (src/pages/About.jsx) and /changelog
// (src/pages/Changelog.jsx). Nothing else in the app shows a version number
// anymore; see the CLAUDE.md session note this fix was born from.
//
// Deliberately NOT wired into `npm run build` or any other command that runs
// on every local build — that would churn the version on every dev rebuild.
// This is a release-time step: run it explicitly (e.g. from the
// production-readiness release checklist) as part of shipping a version.
//
// Usage:
//   node scripts/bump-version.mjs            # patch bump: 1.0.0 -> 1.0.1
//   node scripts/bump-version.mjs --minor    # minor bump: 1.0.5 -> 1.1.0
//   node scripts/bump-version.mjs --major    # major bump: 1.4.2 -> 2.0.0
//
// Patch auto-increments on every release; major/minor are deliberate,
// explicit acts — matching the standing instruction that only a build
// instruction changes those two numbers.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");

export function bumpVersion(currentVersion, mode) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
  if (!m) {
    throw new Error(`package.json version "${currentVersion}" is not plain semver (X.Y.Z) — bump it by hand once, then this script can take over.`);
  }
  let [, major, minor, patch] = m.map(Number);
  if (mode === "major") {
    major += 1; minor = 0; patch = 0;
  } else if (mode === "minor") {
    minor += 1; patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--major") ? "major" : args.includes("--minor") ? "minor" : "patch";

  const pkgRaw = readFileSync(PKG_PATH, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const from = pkg.version;
  const to = bumpVersion(from, mode);

  pkg.version = to;
  // Preserve trailing newline convention of the existing file.
  const hadTrailingNewline = pkgRaw.endsWith("\n");
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + (hadTrailingNewline ? "\n" : ""));

  console.log(`Version bumped (${mode}): ${from} -> ${to}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
