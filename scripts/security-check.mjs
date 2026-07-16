// scripts/security-check.mjs
// M0 security-check stub. The full secret-pattern scan + dep audit lands
// in M6 (Security). For now this is a self-test that confirms the script
// runs to completion so `npm run test:security` and `npm run test:all`
// do not break the gate on a missing-file path.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const REQUIRED_PATHS = [
  "package.json",
  "netlify.toml",
  ".gitignore",
  ".env.example",
];

let failed = 0;
for (const p of REQUIRED_PATHS) {
  const full = resolve(repoRoot, p);
  if (!existsSync(full)) {
    console.error(`[security-check] missing: ${p}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`[security-check] ${failed} required file(s) missing`);
  process.exit(1);
}

console.log("[security-check] M0 stub passed — full scan lands in M6");
