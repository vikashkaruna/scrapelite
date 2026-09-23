#!/usr/bin/env node
// scripts/consolidate-sessions.mjs
// Consolidates all historical session handoff and end files into a single master archive:
// docs/sessions/SESSIONS-HISTORY.md
// Last session recorded: 2026-09-20

import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(__filename, "../..");
const SESSIONS_DIR = join(ROOT, "docs", "sessions");
const ARCHIVE_FILE = join(SESSIONS_DIR, "SESSIONS-HISTORY.md");

const allFiles = readdirSync(SESSIONS_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "SESSIONS-HISTORY.md")
  .sort(); // Chronological sort by filename date

console.log(`Found ${allFiles.length} historical session files to consolidate.`);

let masterDoc = `# DatIQ — Master Consolidated Historical Session Archive

> **Archive Description:** Complete historical record of all prior DatIQ engineering sessions, milestones, decisions, handoffs, and operational logs.
> **Total Sessions Archived:** ${allFiles.length}
> **Generated:** ${new Date().toISOString()}

---

## Master Table of Contents

`;

allFiles.forEach((file, idx) => {
  const nameWithoutExt = file.replace(/\.md$/, "");
  const anchor = nameWithoutExt.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  masterDoc += `${idx + 1}. [${nameWithoutExt}](#${anchor})\n`;
});

masterDoc += `\n---\n\n`;

for (const file of allFiles) {
  const filePath = join(SESSIONS_DIR, file);
  const content = readFileSync(filePath, "utf8");
  const nameWithoutExt = file.replace(/\.md$/, "");
  const anchor = nameWithoutExt.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  masterDoc += `<a id="${anchor}"></a>\n\n`;
  masterDoc += `## Session Record: ${nameWithoutExt}\n\n`;
  masterDoc += `> **Source File:** \`docs/sessions/${file}\`\n\n`;
  masterDoc += content.trim();
  masterDoc += `\n\n---\n\n`;
}

writeFileSync(ARCHIVE_FILE, masterDoc, "utf8");
console.log(`✓ Created consolidated archive: ${ARCHIVE_FILE} (${(statSync(ARCHIVE_FILE).size / 1024).toFixed(1)} KB)`);

// Remove the individual scattered files
for (const file of allFiles) {
  unlinkSync(join(SESSIONS_DIR, file));
}
console.log(`✓ Removed ${allFiles.length} individual session files.`);
