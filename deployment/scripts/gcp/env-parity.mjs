#!/usr/bin/env node
// deployment/scripts/gcp/env-parity.mjs — config parity audit: Netlify -> GCP.
//
//   node deployment/scripts/gcp/env-parity.mjs [staging|prod]     (default: prod)
//
// Answers "did the migration drop a variable?" from three independent angles and
// exits 1 if the first two find anything. Needs the netlify CLI logged in (for
// the live site's variable NAMES); without it, angles 1 and 3 still run.
//
//   1. CODE  -> GCP   every env var the server code reads that the GCP deploy
//                     neither passes (deploy-run.sh) nor mounts (secrets.manifest)
//                     and that is NOT a known platform/local-only/optional knob.
//   2. NETLIFY -> GCP every variable set on the Netlify site's <context> that GCP
//                     does not carry, minus the explicit RETIRED list below.
//   3. .env.<env>     carried variables that are EMPTY in deployment/env/.env.<env>
//                     (declared but never filled = silently disabled feature).
//
// Values are never printed for secrets. Full mapping: doc 06 section 11.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = (process.argv[2] || "prod").replace("production", "prod");
const ctx = env === "prod" ? "production" : "staging";
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// Deliberately NOT carried to GCP (reasons in doc 06 section 11.4).
const RETIRED = new Map([
  ["AWS_LAMBDA_JS_RUNTIME", "Netlify Lambda runtime pin; Cloud Run runs the container's own node"],
  ["NODE_VERSION", "Netlify build image selector; the Dockerfile pins node"],
  ["SECRETS_SCAN_OMIT_KEYS", "Netlify secrets scanner config"],
  ["SECRETS_SCAN_OMIT_PATHS", "Netlify secrets scanner config"],
  ["SCHEDULE_ALERT_WEBHOOK", "retired by the v2 workflow pipeline (empty on Netlify)"],
  ["SCRAPE_PROVIDER_ORDER1", "typo duplicate of SCRAPE_PROVIDER_ORDER; read by nothing"],
  ["SUPABASE_ACCESS_TOKEN", "Supabase Management API token; no function reads it and a service should not hold it"],
  ["SUPABASE_PROJECT_NAME", "informational label for the hosted project"],
  ["DEPLOY_PRIME_URL", "Netlify-injected; the adapter sets DEPLOY_URL"],
]);
// Read by code but legitimately never set by the deploy: platform-injected,
// local-stack/generator-only, or optional tuning with a safe in-code default.
const PLATFORM = new Set(("NODE_ENV URL SITE_URL DEPLOY_URL CONTEXT BRANCH COMMIT_REF NETLIFY NETLIFY_DEV PATH HOME TZ PORT CI DEBUG NODE_OPTIONS " +
  "COMPOSE_PROJECT_NAME CONSENT_POLICY_VERSION DAILY_HOUR_UTC JOBS_URL JWT_SECRET MAILPIT_URL MAIL_TRANSPORT NETLIFY_TOML_FILE PUBLIC_BASE_URL " +
  "RESEND_ENDPOINT SCHEDULES_JSON SITE_ROUTES_FILE TICK_MS DATIQ_INTERNAL_API_BASE DATIQ_ALLOW_DEMO_ADMIN DATIQ_ALLOW_UNSIGNED_WEBHOOKS " +
  "D30_ENABLED DAILY_DIGEST_HOUR_UTC GUEST_AUDIT_HARD_LIMIT GUEST_BATCH_HARD_LIMIT GUEST_SINGLE_HARD_LIMIT PROXY_STRATEGY PROXY_URLS " +
  "RATE_LIMIT_BURST RATE_LIMIT_REFILL RL_BURST RL_REFILL GOOGLE_PAGESPEED_KEY VITE_FIRECRAWL_API_KEY VITE_RAZORPAY_KEY_ID").split(" "));

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules" || n === "__tests__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

// -- angle 1: what the code reads --------------------------------------------
const codeVars = new Map();
for (const f of walk(join(ROOT, "netlify/functions"))) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/(?:process\.env|\benv)\.([A-Z][A-Z0-9_]{2,})|(?:process\.env|\benv)\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g)) {
    const n = m[1] || m[2];
    (codeVars.get(n) || codeVars.set(n, new Set()).get(n)).add(f.split("/").pop());
  }
}

// -- what GCP supplies ---------------------------------------------------------
const deployRun = read("deployment/scripts/gcp/deploy-run.sh");
const manifest = new Set(read("deployment/gcp/secrets.manifest").split("\n")
  .filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split(/\s+/)[0]));
const optList = (deployRun.match(/for _opt in([\s\S]*?); do/) || [, ""])[1]
  .replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
const supplied = new Set([
  ...manifest, ...optList,
  ...[...deployRun.matchAll(/"([A-Z][A-Z0-9_]+)=/g)].map((m) => m[1]),
  ...[...deployRun.matchAll(/\b(GOTRUE_[A-Z_]+|PGRST_[A-Z_]+)=/g)].map((m) => m[1]),
]);

let bad = 0;
const section = (t) => console.log(`\n-- ${t}`);

section(`1. code reads, GCP does not supply (${env})`);
const miss1 = [...codeVars.keys()].filter((n) => !supplied.has(n) && !PLATFORM.has(n) && !RETIRED.has(n)).sort();
for (const n of miss1) console.log(`   x ${n.padEnd(36)} ${[...codeVars.get(n)].slice(0, 3).join(", ")}`);
if (!miss1.length) console.log("   ok none");
bad += miss1.length;

// -- angle 2: what the live Netlify site has ----------------------------------
section(`2. Netlify ${ctx} context -> GCP`);
let nl = null;
try {
  nl = JSON.parse(execFileSync("netlify", ["env:list", "--context", ctx, "--json"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
} catch { console.log("   (netlify CLI unavailable or not logged in - skipped)"); }
if (nl) {
  const miss2 = Object.keys(nl)
    .filter((n) => !n.startsWith("VITE_") && !supplied.has(n) && !RETIRED.has(n) && !PLATFORM.has(n)).sort();
  for (const n of miss2) console.log(`   x ${n.padEnd(36)} ${/^\*+/.test(nl[n]) ? "(secret)" : JSON.stringify(nl[n]).slice(0, 50)}`);
  if (!miss2.length) console.log("   ok none");
  bad += miss2.length;
  // Build-time VITE_*: deploy-hosting.sh bakes them from .env.<env>; anything absent
  // there falls back to the operator's LOCAL .env. SUPABASE pair is pinned by the script.
  const envFileV = join(ROOT, `deployment/env/.env.${env}`);
  const have = new Set(existsSync(envFileV)
    ? readFileSync(envFileV, "utf8").split("\n").map((l) => (l.match(/^(VITE_[A-Z_]+)=/) || [])[1]).filter(Boolean) : []);
  const miss3 = Object.keys(nl).filter((n) => n.startsWith("VITE_") && !have.has(n)
    && !/^VITE_SUPABASE_(URL|ANON_KEY)$/.test(n) && nl[n] !== "").sort();
  for (const n of miss3) console.log(`   x ${n.padEnd(36)} build-time, absent from .env.${env} (falls back to local .env)`);
  if (!miss3.length) console.log("   ok every non-empty VITE_* is set in .env." + env);
  bad += miss3.length;
}

// -- angle 3: declared but empty ----------------------------------------------
section(`3. carried by GCP but EMPTY in deployment/env/.env.${env}`);
const envFile = join(ROOT, `deployment/env/.env.${env}`);
if (!existsSync(envFile)) console.log("   (file not present - skipped)");
else {
  const kv = new Map();
  for (const l of readFileSync(envFile, "utf8").split("\n")) {
    const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) kv.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  const watch = [...manifest, ...optList].filter((n) => kv.has(n) && kv.get(n) === "").sort();
  for (const n of watch) console.log(`   ! ${n}`);
  if (!watch.length) console.log("   ok none");
  console.log("   (warnings only: some are legitimately blank, e.g. SUPPLIER_GSTIN until registered, Stripe while deferred)");
}

console.log(bad ? `\nx ${bad} parity gap(s): add to deploy-run.sh / secrets.manifest, or to RETIRED with a reason`
                : "\nok no parity gaps");
process.exit(bad ? 1 : 0);
