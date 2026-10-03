#!/usr/bin/env node
// deployment/scripts/gen-routes-manifest.mjs — builds the adapter's route
// manifest from the ACTUAL repo state (no hard-coded function lists):
//   - functions: every netlify/functions/<name>.js
//   - scheduled: every [functions."name"] block in netlify.toml (the cron set —
//     on Netlify these are the functions whose public HTTP access is blocked)
//   - routes:    the /api/* redirect rules from netlify.toml ([[redirects]]
//     with source starting /api/), longest/most-specific first, so the adapter
//     resolves sub-path routers exactly like the Netlify edge does.
// Mirrors netlify.toml (single source of truth) — re-run on toml changes.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const functionsDir = resolve(REPO, "netlify", "functions");
const tomlPath = resolve(REPO, "netlify.toml");

const argOf = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const outPath = argOf("out", join(HERE, "routes.manifest.json"));
const functionsDirArg = argOf("functions-dir", functionsDir);

const functions = readdirSync(functionsDirArg)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .map((f) => f.replace(/\.js$/, ""))
  .sort();

const toml = readFileSync(argOf("toml", tomlPath), "utf8");

// [functions."name"] blocks in netlify.toml == the scheduled (cron) functions.
const scheduled = [...toml.matchAll(/\[functions\."([^"]+)"\]/g)].map((m) => m[1]);
for (const s of scheduled) {
  if (!functions.includes(s)) {
    console.error(`✗ gen-routes-manifest: netlify.toml schedules "${s}" but netlify/functions/${s}.js is missing`);
    process.exit(1);
  }
}

// [[redirects]] blocks: from / to / status / force. Keep /api/* API mappings.
const routes = [];
const blocks = toml.split(/\[\[redirects\]\]/).slice(1);
for (const block of blocks) {
  const pick = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(block);
    return m ? m[1] : "";
  };
  const from = pick("from");
  const to = pick("to");
  const status = Number(pick("status") || "301");
  if (!from || !to) continue;
  if (!from.startsWith("/api/")) continue; // page redirects stay at the edge, not the adapter
  // Destinations appear either as "name/:splat" or "/.netlify/functions/name/:splat"
  const normTo = to.replace(/^\/\.netlify\/functions\//, "");
  const fn = normTo.split("/").filter(Boolean)[0];
  if (!fn || fn.startsWith(":")) continue; // generic catch-all (":splat") — adapter falls back to <segment>
  if (!functions.includes(fn)) {
    console.error(`✗ gen-routes-manifest: redirect ${from} → ${to} names unknown function "${fn}"`);
    process.exit(1);
  }
  routes.push({ from, fn, splat: from.endsWith("*"), force: /force\s*=\s*true/.test(block), status });
}
// Most-specific prefix first so /api/integrations/hubspot/* wins over /api/integrations/*.
routes.sort((a, b) => b.from.length - a.from.length);

const manifest = { generatedFrom: "netlify.toml + netlify/functions", functions, scheduled, routes };
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`✓ gen-routes-manifest: ${functions.length} functions, ${scheduled.length} scheduled, ${routes.length} api routes → ${outPath}`);
