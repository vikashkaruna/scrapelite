#!/usr/bin/env node
// scripts/new-session.mjs — Generate a new formatted session handoff file in docs/sessions/

import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SESSIONS_DIR = join(ROOT, "docs", "sessions");

const titleArg = process.argv.slice(2).find((a) => !a.startsWith("-")) || "WORK-RECORD";
const slug = titleArg.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const today = new Date().toISOString().split("T")[0];
const filename = `SESSION-HANDOFF-${today}-${slug}.md`;
const filePath = join(SESSIONS_DIR, filename);

if (existsSync(filePath)) {
  console.log(`! File ${filename} already exists in docs/sessions/`);
  process.exit(0);
}

let branch = "unknown";
let headSha = "unknown";
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  headSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch (e) {}

const template = `# Session Handoff — ${today} — ${titleArg}

> **Branch:** \`${branch}\` @ \`${headSha}\`  
> **Target:** \`${branch}\`  
> **Status:** Work in progress / Verified  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | ${today} |
| **Branch** | \`${branch}\` |
| **HEAD SHA** | \`${headSha}\` |
| **Status** | Complete & verified |
| **Pre-Push Gates** | \`npm run test:all\` |

---

## 2. What Was Accomplished

- 

---

## 3. Verification Evidence

- \`npm run test:all\` green

---

## 4. Open Items for Next Session

- 
`;

writeFileSync(filePath, template, "utf8");
console.log(`✓ Created new session handoff: docs/sessions/${filename}`);
