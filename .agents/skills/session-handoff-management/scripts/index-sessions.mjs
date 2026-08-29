#!/usr/bin/env node
// scripts/index-sessions.mjs — Scan docs/sessions/*.md and generate docs/sessions/README.md

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SESSIONS_DIR = join(ROOT, "docs", "sessions");

const files = readdirSync(SESSIONS_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort()
  .reverse();

let content = `# DatIQ Session Archive Index

> This directory contains all historical and active development session handoffs and milestone records.
> Managed by the \`session-handoff-management\` skill.
> **Total Sessions Archived:** ${files.length}

---

## Session Archive (Reverse Chronological)

| Date | File | Summary / Topic |
|---|---|---|
`;

for (const file of files) {
  const filePath = join(SESSIONS_DIR, file);
  const text = readFileSync(filePath, "utf8");
  
  // Extract date from filename: SESSION-HANDOFF-2026-08-30-... -> 2026-08-30
  const dateMatch = file.match(/\d{4}-\d{2}-\d{2}/);
  const date = dateMatch ? dateMatch[0] : "—";

  // Extract first H1 heading
  const h1Match = text.match(/^#\s+(.+)$/m);
  let title = h1Match ? h1Match[1].trim() : file.replace(/\.md$/, "");
  title = title.replace(/^Session\s+(handoff|record|end)\s*[-—:]*\s*/i, "").trim();

  content += `| ${date} | [\`${file}\`](./${file}) | ${title} |\n`;
}

content += `\n---\n\n*Index generated automatically by \`node .agents/skills/session-handoff-management/scripts/index-sessions.mjs\`*\n`;

writeFileSync(join(SESSIONS_DIR, "README.md"), content, "utf8");
console.log(`✓ Generated docs/sessions/README.md with ${files.length} indexed sessions.`);
