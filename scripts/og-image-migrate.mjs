// scripts/og-image-migrate.mjs
// One-shot: replace favicon.svg with og-card.jpg on og:image and twitter:image
// meta tags across all static pages and the root index.html.
// Safe to run multiple times; idempotent.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["public", "."];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".claude", ".worktrees", "scripts"]);
const FROM = /favicon\.svg(?=[\s\S]*?(?:og:image|twitter:image))/g;
// The simpler, unambiguous swap: any time favicon.svg appears inside a meta
// tag whose name/property is og:image or twitter:image, replace it.
const PATTERNS = [
  // <meta property="og:image" content="https://datiq.app/favicon.svg">
  /(<meta\s+property="og:image"\s+content="https:\/\/datiq\.app\/)favicon\.svg(")/g,
  // <meta name="twitter:image" content="https://datiq.app/favicon.svg">
  /(<meta\s+name="twitter:image"\s+content="https:\/\/datiq\.app\/)favicon\.svg(")/g,
  // <meta property="og:image" content="/favicon.svg" />   (no protocol)
  /(<meta\s+property="og:image"\s+content="\/?)favicon\.svg(")/g,
  // <meta name="twitter:image" content="/favicon.svg" />
  /(<meta\s+name="twitter:image"\s+content="\/?)favicon\.svg(")/g,
];

let touched = 0;
let matches = 0;
const files = [];
function walk(d) {
  for (const name of readdirSync(d)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(d, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (name === "index.html" || (d === "." && name === "index.html")) files.push(p);
  }
}
for (const r of ROOTS) {
  try {
    walk(r);
  } catch (e) {
    // root "." already includes files
  }
}

for (const f of files) {
  const before = readFileSync(f, "utf8");
  let after = before;
  for (const p of PATTERNS) {
    after = after.replace(p, "$1og-card.jpg$2");
  }
  if (after !== before) {
    writeFileSync(f, after);
    touched++;
    const m = (before.match(/favicon\.svg/g) || []).length - (after.match(/favicon\.svg/g) || []).length;
    matches += Math.max(0, m);
    console.log(`updated: ${f}  (-${Math.max(0, m)} favicon.svg refs)`);
  }
}

console.log(`\nDone. ${touched} file(s) updated, ${matches} meta-tag ref(s) swapped.`);
