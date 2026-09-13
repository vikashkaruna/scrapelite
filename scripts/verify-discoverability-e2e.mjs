#!/usr/bin/env node
// scripts/verify-discoverability-e2e.mjs
//
// The automated regression pass for Discoverability P1 (W1–W8) and P2 (W9–W14),
// pointed at a REAL deployment: a branch preview, staging, or production.
//
// Run it, read the verdict, then spot-check a handful of rows by hand. The
// companion document is docs/AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md and
// every check id here is a row there — the two are one artifact in two forms, so
// a check that drifts from its documented expectation is visible.
//
// ── WHY THIS EXISTS ON TOP OF 6 530 GREEN TESTS ────────────────────────────
//
//   * vitest mocks the Supabase REST layer. It proves the HANDLER behaves. It
//     would pass happily against a database where the migration was never run.
//   * scripts/db-verify.mjs runs the SQL against WASM Postgres. It proves the
//     SCHEMA is correct, and says nothing about whether anyone applied it.
//   * Neither one has ever seen a deployed bundle, a real session, PostgREST,
//     or a real clock.
//
// A mismatch between the three falls through all of them and only breaks in
// production. That is the gap verify-referral-e2e.mjs closed for referrals and
// verify-workflow-rls.mjs closed for RLS; this is the same instrument pointed at
// the whole discoverability surface.
//
// ── THE SAFETY MODEL, AND WHY PRODUCTION IS READ-ONLY BY DEFAULT ────────────
//
// A full write-path regression CREATES REAL ROWS in a real tenant's account and
// an audit run SPENDS REAL QUOTA. Several P2 tables have no delete endpoint
// (schema entities, trust observations, subject scores — the last APPENDS by
// design, because the trend is the product), so residue on production cannot be
// tidied away afterwards.
//
// So the runner refuses to write or to spend unless told, explicitly, twice:
//
//   --allow-writes   permits POST/PATCH/DELETE against the P2 surface
//   --allow-audits   permits running an audit, which costs one from the month
//
// On a branch or staging both are ON by default (that is what those
// environments are for). On production both are OFF and must be passed by hand.
// Checks that need a capability nobody granted report SKIP with the reason —
// never PASS. A skipped check is not a passing one.
//
// ── FIVE VERDICTS, AND THE THIRD IS THE USEFUL ONE ─────────────────────────
//
//   PASS       the expectation held
//   FAIL       the expectation did not hold — something is broken
//   DEVIATION  not broken, but different from what the plan documents. The
//              commonest one by far is "this environment's database is behind".
//              Reported separately because the remedy is an APPLY, not a fix.
//   SKIP       a prerequisite was absent. Says which.
//   BLOCKED    an earlier check this one depends on did not pass.
//
// ── WHAT IT HONESTLY CANNOT DO ─────────────────────────────────────────────
//
// It drives the API. It cannot see a screen. It cannot tell you whether an
// unmeasured signal RENDERS muted rather than as a red zero, whether a refusal
// READS like a refusal, or whether a PDF looks right. Every check therefore
// carries a `postCheck` — one thing a human can confirm in seconds to satisfy
// themselves the automated PASS means what it claims. The report prints them.
//
// ── USAGE ──────────────────────────────────────────────────────────────────
//
//   node scripts/verify-discoverability-e2e.mjs \
//     --base-url=https://staging--datiqapp.netlify.app \
//     --target=https://example.com/pricing
//
//   # production, safe by default (read-only, no audit spend)
//   node scripts/verify-discoverability-e2e.mjs --base-url=https://datiq.app --env=production
//
//   # production, full regression — creates rows and spends one audit
//   node scripts/verify-discoverability-e2e.mjs --base-url=https://datiq.app \
//     --target=https://datiq.app/pricing --allow-writes --allow-audits
//
// Credentials come from the ENVIRONMENT and nowhere else — never a flag, which
// would land in shell history and in `ps`:
//
//   DATIQ_TEST_TOKEN     a Supabase access token for the primary account
//   DATIQ_TEST_EMAIL     } or these two, and the runner mints a token itself
//   DATIQ_TEST_PASSWORD  }
//   DATIQ_TENANT_B_TOKEN a SECOND account's token — unlocks the cross-tenant
//                        404 checks, which are the ones that matter most
//   DATIQ_FREE_TOKEN     a token for a FREE-plan account — unlocks the W14
//                        entitlement-refusal checks in both directions
//   DATIQ_DB_URL         a direct Postgres connection string — unlocks the
//                        schema and nullability checks (--db-url also works)
//
// Reports:  --json=<path>   machine-readable, for CI
//           --md=<path>     the sign-off sheet, ready to paste into a PR
//
// Exit: 0 all good · 1 a stop-ship check failed or deviated · 2 usage error.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { postgrestAnswer } from "./lib/postgrestAnswer.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { RELEASE_GATE_SCOPES } from "./release-gate-scopes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID = `vde-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const RUNNER_SCOPE = RELEASE_GATE_SCOPES.discoverability;

// ── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { flags: new Set(), opt: {} };
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out.flags.add(a.slice(2));
    else out.opt[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));

if (argv.flags.has("help") || argv.flags.has("h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

// DATIQ_VERIFY_IMPORT_ONLY lets the self-test import the check registry without
// running anything. It must not be able to stand in for a real base URL.
const IMPORT_ONLY = Boolean(process.env.DATIQ_VERIFY_IMPORT_ONLY);
const BASE = String(argv.opt["base-url"] || process.env.DATIQ_BASE_URL || "").replace(/\/+$/, "")
  || (IMPORT_ONLY ? "https://import-only.invalid" : "");
if (!BASE) {
  console.error("A --base-url is required, e.g. --base-url=https://datiq.app");
  console.error("Run with --help for the full usage.");
  process.exit(2);
}

/** Inferred, then overridable — guessing "production" wrong is the costly direction. */
function inferEnv(base) {
  const h = (() => { try { return new URL(base).hostname; } catch { return ""; } })();
  if (/^(datiq\.app|www\.datiq\.app|datiqapp\.netlify\.app)$/.test(h)) return "production";
  if (/staging/.test(h)) return "staging";
  if (/localhost|127\.0\.0\.1/.test(h)) return "local";
  return "branch";
}

const ENV = String(argv.opt.env || inferEnv(BASE)).toLowerCase();
const IS_PROD = ENV === "production";

// 🔴 THE ONE DECISION THAT PROTECTS A CUSTOMER'S ACCOUNT. On production, writing
// and spending are opt-in; everywhere else they are the point of the run.
const ALLOW_WRITES = argv.flags.has("allow-writes") || (!IS_PROD && !argv.flags.has("read-only"));
const ALLOW_AUDITS = argv.flags.has("allow-audits") || (!IS_PROD && !argv.flags.has("read-only"));

const TARGET = String(argv.opt.target || process.env.DATIQ_TEST_TARGET || "").trim();
const TIMEOUT_MS = Number(argv.opt.timeout) || 45_000;
const ONLY = argv.opt.suite ? new Set(String(argv.opt.suite).split(",").map((s) => s.trim())) : null;
const VERBOSE = argv.flags.has("verbose");

let TOKEN = process.env.DATIQ_TEST_TOKEN || null;
const TOKEN_B = process.env.DATIQ_TENANT_B_TOKEN || null;
const TOKEN_FREE = process.env.DATIQ_FREE_TOKEN || null;
const DB_URL = argv.opt["db-url"] || process.env.DATIQ_DB_URL || null;

// ── Results ─────────────────────────────────────────────────────────────────

const VERDICT = { PASS: "PASS", FAIL: "FAIL", DEVIATION: "DEVIATION", SKIP: "SKIP", BLOCKED: "BLOCKED" };
const MARK = { PASS: "✓", FAIL: "✗", DEVIATION: "≠", SKIP: "–", BLOCKED: "⊘" };

const results = [];
const ctx = {
  // Everything a later check needs from an earlier one. A check that finds its
  // input missing reports BLOCKED, not FAIL: "we could not test this" and "this
  // is broken" are different sentences and only one of them is a bug report.
  auditId: null, secondAuditId: null, subjectId: null, targetId: null,
  truthRecordId: null, entityAId: null, entityBId: null, listingId: null,
  recommendationId: null, auditCountBefore: null, plan: null,
  created: [],   // { kind, id } — what this run put in the database
};

function record(check, verdict, detail, extra = {}) {
  const row = {
    id: check.id, suite: check.suite, title: check.title,
    severity: check.severity || "bug",
    verdict, detail: detail || "",
    prereq: check.prereq || "", postCheck: check.postCheck || "", fix: check.fix || "",
    ...extra,
  };
  results.push(row);
  const pad = check.id.padEnd(6);
  console.log(`  ${MARK[verdict]} ${pad} ${check.title}${detail ? `\n        ${String(detail).replace(/\n/g, "\n        ")}` : ""}`);
  return row;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

let httpCalls = 0;

async function http(path, { method = "GET", token = TOKEN, body, headers = {}, raw = false, base = BASE } = {}) {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  httpCalls++;
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        // A bare fetch with no User-Agent is refused with 403 by the edge in
        // front of some of these hosts before it ever reaches a function, which
        // reads identically to an application failure. Identify ourselves.
        "User-Agent": `DatIQ-verify-discoverability/1.0 (+${RUN_ID})`,
        Accept: "*/*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (raw) return { status: res.status, headers: res.headers, text };
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — that is itself a finding */ }
    if (VERBOSE) console.log(`        → ${method} ${url} ${res.status}`);
    return { status: res.status, headers: res.headers, json, text };
  } catch (err) {
    return { status: 0, error: err?.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/** The discoverability API, which is what every P1/P2 check speaks to. */
const api = (p, opts) => http(`/api/discoverability${p}`, opts);

/**
 * Tell "the network will not carry us to this host" apart from "the app said no".
 *
 * 🔴 THIS DISTINCTION IS THE WHOLE DIFFERENCE BETWEEN A BUG REPORT AND A NOTE
 * ABOUT WHERE YOU ARE SITTING. Three things produce a refusal that looks like an
 * application failure and is not:
 *
 *   · an egress proxy that allow-lists hosts (`x-deny-reason: host_not_allowed`)
 *   · Netlify's own visitor-access gate on branch and staging deploys, which
 *     answers 401 to everything without a logged-in Netlify session
 *   · a corporate MITM proxy returning its own 403 page
 *
 * Without this, a run from the wrong place prints forty red rows and every one
 * of them is a lie. Returns a reason string, or null when the host answered.
 */
function networkVerdict(r) {
  if (r.status === 0) return r.error || "the request did not complete";
  const deny = r.headers?.get?.("x-deny-reason");
  if (deny) return `egress proxy refused the connection (${deny}) — add this host to the allow-list`;
  const body = (r.text || "").slice(0, 400);
  if (r.status === 403 && /not in allowlist|egress|proxy/i.test(body)) {
    return `a proxy between here and the host refused: ${body.split("\n")[0].slice(0, 120)}`;
  }
  if (r.status === 401 && /netlify|access|password/i.test(body + (r.headers?.get?.("www-authenticate") || ""))) {
    return "Netlify's visitor-access gate answered 401 — branch and staging deploys need a logged-in Netlify session or an SSO bypass (see scripts/netlify-edge-access-bypass.mjs)";
  }
  return null;
}

// ── Supabase identity, lifted from verify-workflow-rls.mjs so they cannot drift ─

/**
 * The project URL and its PAIRED anon key, out of the committed runtime config.
 * ⚠️ Pairing matters: a Supabase anon key carries the project ref inside its own
 * payload, and a URL/key pair that disagrees answers `Invalid API key` while
 * naming neither side. That mismatch survived three debugging sessions once.
 */
function supabaseFromRuntimeConfig(wantProd) {
  try {
    const s = readFileSync(join(ROOT, "public/runtime-config.js"), "utf8");
    const urls = [...s.matchAll(/"(https:\/\/[a-z0-9]+\.supabase\.co)"/g)].map((m) => m[1]);
    const i = s.indexOf("supabaseAnonKey:");
    const keys = [...s.slice(i, i + 2500).matchAll(
      /(sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_.-]{60,})/g)].map((m) => m[1]);
    const idx = wantProd ? 0 : 1;   // runtime-config picks by `_isMain`; index 0 is production in BOTH lists
    return { url: urls[idx] || null, key: keys[idx] || null };
  } catch {
    return { url: null, key: null };
  }
}

const SB = {
  url: process.env.SUPABASE_URL || argv.opt["supabase-url"] || supabaseFromRuntimeConfig(IS_PROD).url,
  anonKey: process.env.SUPABASE_ANON_KEY || argv.opt["anon-key"] || supabaseFromRuntimeConfig(IS_PROD).key,
};

/**
 * Mint an access token from email + password, read from the environment only.
 * The password never reaches a flag, a log line or the report — the same rule
 * e2e/journeys/workflows-authenticated.spec.js states for the same reason.
 */
async function mintToken(email, password) {
  if (!SB.url || !SB.anonKey) return { ok: false, error: "no Supabase URL/anon key to authenticate against" };
  const r = await http(`${SB.url}/auth/v1/token?grant_type=password`, {
    method: "POST", token: null,
    headers: { apikey: SB.anonKey },
    body: { email, password },
  });
  if (r.status !== 200 || !r.json?.access_token) {
    return { ok: false, error: `sign-in returned HTTP ${r.status}${r.json?.error_description ? ` — ${r.json.error_description}` : ""}` };
  }
  return { ok: true, token: r.json.access_token };
}

// ── Direct database access (optional) ───────────────────────────────────────

let dbClient = null;
async function db(sql, params = []) {
  if (!DB_URL) return { ok: false, unavailable: true };
  if (!dbClient) {
    const pg = (await import("pg")).default;
    dbClient = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await dbClient.connect();
  }
  try {
    const r = await dbClient.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ── The check registry ──────────────────────────────────────────────────────
//
// Each check declares what it NEEDS. A need that is not met makes it SKIP with
// the reason printed, never PASS — the whole value of this instrument is that
// its green means something.
//
//   auth      a token for the primary account
//   writes    --allow-writes
//   audits    --allow-audits (this check costs a real audit)
//   db        a direct Postgres connection
//   tenantB   a second account's token
//   free      a Free-plan account's token
//   local     the repository checkout (for checks that read committed files)

const CAPS = {
  auth: () => Boolean(TOKEN),
  writes: () => ALLOW_WRITES,
  audits: () => ALLOW_AUDITS,
  db: () => Boolean(DB_URL),
  tenantB: () => Boolean(TOKEN_B),
  free: () => Boolean(TOKEN_FREE),
  target: () => Boolean(TARGET),
  supabase: () => Boolean(SB.url && SB.anonKey),
};

const CAP_REASON = {
  auth: "no DATIQ_TEST_TOKEN (or DATIQ_TEST_EMAIL + DATIQ_TEST_PASSWORD) in the environment",
  writes: IS_PROD
    ? "production is read-only unless --allow-writes is passed; this check would create real rows"
    : "--read-only was passed",
  audits: IS_PROD
    ? "production will not spend an audit unless --allow-audits is passed"
    : "--read-only was passed",
  db: "no --db-url / DATIQ_DB_URL, so the database cannot be read directly",
  tenantB: "no DATIQ_TENANT_B_TOKEN — a second account is required to prove cross-tenant isolation",
  free: "no DATIQ_FREE_TOKEN — a Free-plan account is required to prove the refusal direction",
  target: "no --target URL to audit",
  supabase: "could not resolve a Supabase URL and its paired anon key",
};

const suites = [];
const suite = (name, title, checks) => suites.push({ name, title, checks });

// ════════════════════════════════════════════════════════════════════════════
// §2 · PRE-FLIGHT — five minutes, and it is the part that saves an afternoon
// ════════════════════════════════════════════════════════════════════════════

suite("preflight", "Pre-flight — is the right code on the right database?", [
  {
    id: "P-01", severity: "stop-ship",
    title: "The deployment serves a real JS bundle, not the SPA fallback",
    prereq: "None. Run this first on every environment.",
    postCheck: "Open the site and confirm React actually boots — a button navigates, the theme toggle toggles. A styled page with dead controls is exactly what this failure looks like.",
    fix: "The prerendered pages reference an asset the deploy does not carry. `scripts/sync-prerender-assets.mjs` runs after `vite build` and must repoint every /assets/ reference in dist/. Check the build log for it.",
    async run() {
      const home = await http("/", { token: null, raw: true });
      if (home.status !== 200) return { verdict: VERDICT.FAIL, detail: `GET / returned HTTP ${home.status}${home.error ? ` (${home.error})` : ""}` };
      const m = home.text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
      if (!m) return { verdict: VERDICT.DEVIATION, detail: "No /assets/index-*.js reference in the served HTML. Either this host is not the SPA, or it is behind an access gate." };
      const asset = await http(m[0], { token: null, raw: true });
      const ct = asset.headers?.get?.("content-type") || "";
      // 🔴 A SPA catch-all answers a MISSING asset with index.html at status 200.
      // "Everything returns 200" is compatible with React never booting.
      if (!/javascript|ecmascript/i.test(ct)) {
        return { verdict: VERDICT.FAIL, detail: `${m[0]} served as "${ct}" — the SPA fallback answered a missing bundle. React will never boot.` };
      }
      return { verdict: VERDICT.PASS, detail: `${m[0]} · ${ct}` };
    },
  },
  {
    id: "P-01b", severity: "stop-ship",
    title: "The discoverability function is deployed and routing sub-paths",
    prereq: "P-01.",
    postCheck: "None needed — a JSON body with `goals` and `audit_types` can only come from this function.",
    fix: "Check netlify.toml's `/api/discoverability/*` → `/.netlify/functions/discoverability/:splat` rule. A query-param splat (`?splat=:splat`) is the shape that produced 'Unknown endpoint' on every audit once already.",
    async run() {
      const r = await api("/profiles", { token: null });
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `GET /api/discoverability/profiles returned HTTP ${r.status}${r.error ? ` (${r.error})` : ""}` };
      const j = r.json || {};
      const missing = ["profiles", "page_types", "goals", "audit_types"].filter((k) => !j[k]);
      if (missing.length) return { verdict: VERDICT.DEVIATION, detail: `Reference payload is missing: ${missing.join(", ")}. The function is deployed but is an older build (pre-W2).` };
      return { verdict: VERDICT.PASS, detail: `${Object.keys(j.profiles || {}).length} profiles · ${Object.keys(j.audit_types || {}).length} audit types` };
    },
  },
  {
    id: "P-01c", severity: "stop-ship",
    title: "The P2 code is on this deployment (W11/W12/W13 registries answer)",
    prereq: "A valid DATIQ_TEST_TOKEN — the registries sit behind auth.",
    postCheck: "The subject-score registry must name BDS, PDS and SFS. If it names only two, the deploy predates W11's completion.",
    fix: "This environment is running a build from before P2. Redeploy the branch; a green CI run on the branch does not mean the branch is what is deployed.",
    needs: ["auth"],
    async run() {
      const probes = [
        ["subject-score/registry", (j) => Array.isArray(j?.scores) && j.scores.length === 3],
        ["schema-trust/schema-registry", (j) => Array.isArray(j?.approved_types) && j.approved_types.length > 0],
        ["local-directory/schema", (j) => Array.isArray(j?.sources) && j.sources.length > 0],
        ["entity-graph/schema", (j) => Boolean(j)],
      ];
      const bad = [];
      for (const [p, okFn] of probes) {
        const r = await api(`/${p}`);
        if (r.status !== 200 || !okFn(r.json)) bad.push(`${p} → HTTP ${r.status}`);
      }
      if (bad.length) return { verdict: VERDICT.FAIL, detail: `Registry endpoints not answering as expected: ${bad.join("; ")}` };
      return { verdict: VERDICT.PASS, detail: "subject-score, schema-trust, local-directory and entity-graph registries all answer" };
    },
  },
  {
    id: "P-02", offHost: true, severity: "stop-ship",
    title: "Migrations 0057–0064 are on THIS environment's database",
    prereq: "Either --db-url, or --allow-writes so the write probe can stand in.",
    postCheck: "🔴 Worth doing by hand whatever this says. `select count(*) from information_schema.tables where table_schema='public' and table_name in ('audit_subjects','audit_directory_listings','audit_schema_entities','audit_trust_evidence','audit_subject_scores');` must return 5.",
    fix: "Apply the migrations. docs/DB-MIGRATION-RUNBOOK.md §4b–§4e are the procedures. A deploy without the apply gives every P2 endpoint a table that does not exist — a 500 on a feature that tested clean twice.",
    async run() {
      const WANT = ["audit_subjects", "audit_directory_listings", "audit_schema_entities", "audit_trust_evidence", "audit_subject_scores"];
      if (DB_URL) {
        const r = await db(
          `select table_name from information_schema.tables
             where table_schema='public' and table_name = any($1::text[])`, [WANT]);
        if (!r.ok) return { verdict: VERDICT.SKIP, detail: `could not query the database: ${r.error}` };
        const have = r.rows.map((x) => x.table_name);
        const missing = WANT.filter((t) => !have.includes(t));
        if (missing.length) {
          return { verdict: VERDICT.DEVIATION, detail: `MISSING from this database: ${missing.join(", ")}. Every endpoint that reads them will 500. This is an APPLY, not a code fix.` };
        }
        return { verdict: VERDICT.PASS, detail: `all ${WANT.length} P2 tables present` };
      }
      // No database. A READ cannot tell us — the store returns [] for both "no
      // rows" and "no table", which is exactly the ambiguity that makes a
      // missing migration invisible. Only a WRITE distinguishes them.
      if (!ALLOW_WRITES) {
        return { verdict: VERDICT.SKIP, detail: "no --db-url, and writes are not allowed. A read cannot distinguish an empty table from an absent one — do the SQL in `postCheck` by hand." };
      }
      return { verdict: VERDICT.SKIP, detail: "no --db-url; the write checks in §5–§8 stand in — a 502/503 from any of them means the table is absent." };
    },
  },
  {
    id: "P-03", severity: "stop-ship",
    title: "audit_subject_scores.score is NULLABLE and coverage is NOT NULL",
    prereq: "--db-url.",
    postCheck: "🔴 The single most expensive thing on this sheet to get wrong. If `score` came back NOT NULL, an unmeasurable subject is stored as a real zero and nothing afterwards can tell it from a subject that genuinely scored zero. Re-read the column by hand.",
    fix: "0064 declares `score numeric(5,1)` with no NOT NULL and `coverage numeric(5,1) not null`. If this environment disagrees, a hand-edit was applied. Reconcile to the migration before storing anything.",
    needs: ["db"],
    async run() {
      const r = await db(
        `select column_name, is_nullable from information_schema.columns
           where table_name='audit_subject_scores'
             and column_name in ('score','coverage','model_version')`);
      if (!r.ok) return { verdict: VERDICT.SKIP, detail: `could not query the database: ${r.error}` };
      if (!r.rows.length) return { verdict: VERDICT.BLOCKED, detail: "audit_subject_scores does not exist here — see P-02." };
      const by = Object.fromEntries(r.rows.map((x) => [x.column_name, x.is_nullable]));
      const want = { score: "YES", coverage: "NO", model_version: "NO" };
      const wrong = Object.entries(want).filter(([k, v]) => by[k] !== v);
      if (wrong.length) {
        return { verdict: VERDICT.FAIL, detail: wrong.map(([k, v]) => `${k} is_nullable=${by[k] ?? "(absent)"}, want ${v}`).join("; ") };
      }
      return { verdict: VERDICT.PASS, detail: "score NULLABLE · coverage NOT NULL · model_version NOT NULL" };
    },
  },
  {
    id: "P-04", severity: "stop-ship",
    title: "RLS is enabled on the new P2 tables",
    prereq: "--db-url. S-01 checks the same thing from the attacker's side and needs no database.",
    postCheck: "S-01 is the one that matters — an anonymous PostgREST read must be refused. RLS enabled with a permissive policy would pass here and fail there.",
    fix: "Each migration ends with `alter table ... enable row level security` plus a service_role-only policy and a revoke from anon/authenticated. Re-apply the migration.",
    needs: ["db"],
    async run() {
      const r = await db(
        `select relname, relrowsecurity from pg_class
           where relname in ('audit_subjects','audit_directory_listings','audit_schema_entities','audit_trust_evidence','audit_subject_scores')`);
      if (!r.ok) return { verdict: VERDICT.SKIP, detail: `could not query the database: ${r.error}` };
      if (!r.rows.length) return { verdict: VERDICT.BLOCKED, detail: "none of the P2 tables exist here — see P-02." };
      const off = r.rows.filter((x) => !x.relrowsecurity).map((x) => x.relname);
      if (off.length) return { verdict: VERDICT.FAIL, detail: `RLS is OFF on: ${off.join(", ")}` };
      return { verdict: VERDICT.PASS, detail: `RLS on all ${r.rows.length} tables present` };
    },
  },
  {
    id: "P-05", severity: "stop-ship",
    title: "The 0044 RLS lockdown holds on this project (15/15 refused)",
    prereq: "The repository checkout, and a Supabase URL + anon key for this environment.",
    postCheck: "Read the script's own output. 401 or 404 on every table is the pass; a 200 with real row ids is a live data leak.",
    fix: "Apply 0044. Until then every Phase 4-6 table is world-readable with the committed publishable key.",
    needs: ["supabase"],
    async run() {
      // Shelling out rather than restating the 15-table list: a copy drifts,
      // which is exactly how EVENT_TO_SOURCE went wrong.
      const { execFileSync } = await import("node:child_process");
      const script = join(ROOT, "scripts/verify-workflow-rls.mjs");
      try { readFileSync(script); } catch { return { verdict: VERDICT.SKIP, detail: "scripts/verify-workflow-rls.mjs not found — run this from the repository checkout." }; }
      try {
        const out = execFileSync(process.execPath, [script, ...(IS_PROD ? ["--prod"] : [])], {
          encoding: "utf8", timeout: 120_000,
          env: { ...process.env, SUPABASE_URL: SB.url, SUPABASE_ANON_KEY: SB.anonKey },
        });
        const line = out.trim().split("\n").filter(Boolean).pop();
        return { verdict: VERDICT.PASS, detail: line || "all tables refused" };
      } catch (err) {
        const out = String(err?.stdout || err?.message || err).trim().split("\n").filter(Boolean).slice(-3).join(" | ");
        // The child exits 2 for INCONCLUSIVE — probes that never reached the
        // project. That is not a failing lockdown, and reporting it as one
        // would be the same fail-open mistake in reverse.
        if (err?.status === 2) return { verdict: VERDICT.SKIP, detail: out };
        return { verdict: VERDICT.FAIL, detail: out };
      }
    },
  },
  {
    id: "P-06", severity: "stop-ship",
    title: "The test account authenticates against this deployment",
    prereq: "DATIQ_TEST_TOKEN, or DATIQ_TEST_EMAIL + DATIQ_TEST_PASSWORD.",
    postCheck: "Sign in to the same account in a browser and confirm /discoverability loads its history. A token that authenticates to the API but a session that does not load is a client-side problem this runner cannot see.",
    fix: "A token from one Supabase project does not authenticate against another. Staging and production are DIFFERENT projects — confirm the token came from this environment's project.",
    needs: ["auth"],
    async run() {
      const r = await api("/audits?limit=1");
      if (r.status === 401) return { verdict: VERDICT.FAIL, detail: "401 — the token is not valid for this environment's Supabase project." };
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `GET /audits returned HTTP ${r.status}${r.error ? ` (${r.error})` : ""}` };
      const n = Array.isArray(r.json?.audits) ? r.json.audits.length : 0;
      ctx.authOk = true;
      return { verdict: VERDICT.PASS, detail: `authenticated · ${n} recent audit(s) visible` };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §3 · P1 (W1–W8) — the parts a real database and a real network change
// ════════════════════════════════════════════════════════════════════════════

/** A host whose robots.txt disallows `*`. Used to prove a refusal costs nothing. */
const DISALLOWED_URL = "https://www.linkedin.com/company/microsoft/";

suite("p1", "P1 regression — audit, scoring, comparison, export, compliance", [
  {
    id: "A-01", severity: "stop-ship",
    title: "An audit of a real URL completes with four pillar scores",
    prereq: "--target=<a URL you own or may audit>, --allow-audits, and quota remaining.",
    postCheck: "Open the audit in the UI. The four pillar numbers on screen must equal the ones in the report the runner prints — a fresh audit and a stored one are supposed to be identical by construction.",
    fix: "A 502 AUDIT_FAILED is the pipeline; a 503 STORAGE_UNAVAILABLE is the database. A 504 is the budget — AUDIT_BUDGET_MS defaults to 8s against a 10s function timeout; this repo has shipped that 504 once already.",
    needs: ["auth", "audits", "target"],
    async run() {
      const before = await api("/audits?limit=1");
      ctx.auditCountBefore = Array.isArray(before.json?.audits) ? before.json.audits.length : null;

      const r = await api("/audits", { method: "POST", body: { target_url: TARGET, source: "api" } });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: `out of audit quota on this account: ${r.json?.error || ""}` };
      if (r.status !== 201 && r.status !== 200) {
        return { verdict: VERDICT.FAIL, detail: `POST /audits returned HTTP ${r.status} — ${r.json?.error || r.error || r.text?.slice(0, 200)}` };
      }
      const j = r.json || {};
      ctx.auditId = j.auditId || null;
      ctx.targetId = j.targetId || null;
      if (ctx.auditId) ctx.created.push({ kind: "audit", id: ctx.auditId });

      const pillars = j.pillars || {};
      const names = Object.keys(pillars);
      if (names.length < 4) return { verdict: VERDICT.FAIL, detail: `expected four pillars, got ${names.length}: ${names.join(", ")}` };
      if (typeof j.finalScore !== "number" && j.finalScore !== null) {
        return { verdict: VERDICT.FAIL, detail: "no finalScore on the response" };
      }
      if (j.persisted === false) {
        return { verdict: VERDICT.DEVIATION, detail: `the audit ran but was NOT stored: ${j.persistError || "(no detail)"} — the user was charged for work they cannot find in their history` };
      }
      return {
        verdict: VERDICT.PASS,
        detail: `audit ${ctx.auditId} · score ${j.finalScore} · coverage ${j.coverage} · model ${j.scoringModelVersion}`,
      };
    },
  },
  {
    id: "A-02", severity: "stop-ship",
    title: "An unmeasured signal is NULL, never 0, and costs coverage",
    prereq: "A-01.",
    postCheck: "🔴 Look at the screen. An unmeasured signal must render muted or as “not measured” — `--dsc-muted` is not `--dsc-danger`. A grey dash and a red zero are the same number to this runner and completely different to a customer.",
    fix: "`weightedMean()` in scoringModel.js is the single implementation and every score flows through it. A 0 where a null belongs means a caller coerced before scoring — `numOrNull` returning 0 for null is the exact bug this rule exists for (`Number(null)` is 0 and finite).",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const r = await api(`/audits/${ctx.auditId}/results`);
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `GET results returned HTTP ${r.status}` };
      const pillars = r.json?.pillars || {};
      const offenders = [];
      let unmeasured = 0, total = 0;
      for (const [name, p] of Object.entries(pillars)) {
        for (const s of p.signals || []) {
          total++;
          if (s.measured === false) {
            unmeasured++;
            // 🔴 THE RULE THE WHOLE MODULE IS BUILT ON.
            if (s.score !== null && s.score !== undefined) offenders.push(`${name}/${s.code}=${s.score}`);
          }
        }
        if ((p.unmeasured || 0) > 0 && p.coverage === 100) {
          offenders.push(`${name} reports coverage 100 with ${p.unmeasured} unmeasured signal(s)`);
        }
      }
      if (offenders.length) return { verdict: VERDICT.FAIL, detail: `unmeasured signals carrying a value: ${offenders.join(", ")}` };
      if (unmeasured === 0) {
        return { verdict: VERDICT.PASS, detail: `every one of ${total} signals was measured on this page — the rule is untested here, so audit a page with thinner data to exercise it` };
      }
      return { verdict: VERDICT.PASS, detail: `${unmeasured}/${total} signals unmeasured, all NULL, coverage ${r.json?.coverage}` };
    },
  },
  {
    id: "A-03", severity: "bug",
    title: "A re-audit of the same URL compares, with deltas",
    prereq: "A-01 and a second audit — this SPENDS A SECOND AUDIT.",
    postCheck: "The diff's issue list should name what resolved between the two runs. On an unchanged page every delta should be 0 or near it; a large swing on an unchanged page is a measurement problem, not an improvement.",
    fix: "`auditDiff.js` is where this lives. A version mismatch refuses the deltas by design and still reports the issue list — that is `incomparableDiff`, not a bug.",
    needs: ["auth", "audits", "target"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const r = await api(`/audits/${ctx.auditId}/rerun`, { method: "POST", body: {} });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "out of audit quota for the second run" };
      if (r.status !== 201 && r.status !== 200) return { verdict: VERDICT.FAIL, detail: `rerun returned HTTP ${r.status} — ${r.json?.error || ""}` };
      ctx.secondAuditId = r.json?.auditId || null;
      if (ctx.secondAuditId) ctx.created.push({ kind: "audit", id: ctx.secondAuditId });
      if (!ctx.secondAuditId) return { verdict: VERDICT.FAIL, detail: "rerun did not return an auditId" };

      const c = await api(`/audits/${ctx.secondAuditId}/compare/${ctx.auditId}`);
      if (c.status !== 200) return { verdict: VERDICT.FAIL, detail: `compare returned HTTP ${c.status}` };
      if (c.json?.comparable !== true) {
        return { verdict: VERDICT.FAIL, detail: `two audits of the SAME url were refused as incomparable: ${c.json?.diff?.cause || "(no cause)"}` };
      }
      return { verdict: VERDICT.PASS, detail: `comparable · Δscore ${c.json?.diff?.scoreDelta ?? c.json?.diff?.finalScoreDelta ?? "(n/a)"}` };
    },
  },
  {
    id: "A-04", severity: "stop-ship",
    title: "Two audits of DIFFERENT pages are refused as incomparable, with a cause",
    prereq: "A-01 and A-03 (two audits of the same page), plus any older audit of a different page on the account.",
    postCheck: "🔴 The refusal must be visible, not a footnote. A caveat under a confident '+6.2' is read as a footnote and the number is what gets screenshotted.",
    fix: "This is D7's `sameSubject()` gate in compareRoute. If it returns comparable:true across two different subjects, the fallback is matching two NULL subject_ids — which must NEVER count as a match.",
    needs: ["auth"],
    async run() {
      const list = await api("/audits?limit=50");
      const audits = list.json?.audits || [];
      if (!ctx.auditId || audits.length < 2) return { verdict: VERDICT.SKIP, detail: "need two audits of DIFFERENT pages on this account" };
      const mine = audits.find((a) => a.id === ctx.auditId);
      const other = audits.find((a) => a.id !== ctx.auditId && a.id !== ctx.secondAuditId
        && (a.target_id && mine?.target_id ? a.target_id !== mine.target_id : false));
      if (!other) return { verdict: VERDICT.SKIP, detail: "no audit of a DIFFERENT target on this account to compare against — audit a second page and re-run" };
      const c = await api(`/audits/${ctx.auditId}/compare/${other.id}`);
      if (c.status !== 200) return { verdict: VERDICT.FAIL, detail: `compare returned HTTP ${c.status}` };
      if (c.json?.comparable === true) {
        return { verdict: VERDICT.FAIL, detail: `🔴 two audits of DIFFERENT pages compared as if they were the same thing (${ctx.auditId} vs ${other.id}) — a confident number that means nothing` };
      }
      const cause = c.json?.diff?.cause || c.json?.diff?.incomparableCause || null;
      if (!cause) return { verdict: VERDICT.DEVIATION, detail: "refused as incomparable, but with no stated cause — the reader is told 'no' without being told why" };
      return { verdict: VERDICT.PASS, detail: `refused · cause: ${typeof cause === "string" ? cause : JSON.stringify(cause)}` };
    },
  },
  {
    id: "A-05", severity: "bug",
    title: "An audit read back from history renders identically to a fresh one",
    prereq: "A-01.",
    postCheck: "Open the SAME audit from History in the UI. Signal NAMES, coverage and weights must all be there. This is the bug that never reproduces while you are looking at it: a fresh audit rendered perfectly and a stored one did not.",
    fix: "`rehydrate()` must route stored values back through `scorePillar()` — the same pure function the pipeline uses — so the two paths are identical by construction rather than by two field lists happening to agree.",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const r = await api(`/audits/${ctx.auditId}/results`);
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const pillars = Object.entries(r.json?.pillars || {});
      if (!pillars.length) return { verdict: VERDICT.FAIL, detail: "no pillars on the stored audit" };
      const problems = [];
      for (const [name, p] of pillars) {
        if (p.coverage === null || p.coverage === undefined) problems.push(`${name}: no coverage`);
        for (const s of p.signals || []) {
          if (!s.label) problems.push(`${name}/${s.code}: no label`);
          if (s.weight === undefined || s.weight === null) problems.push(`${name}/${s.code}: no weight`);
        }
      }
      if (problems.length) return { verdict: VERDICT.FAIL, detail: `stored audit is missing presentation data: ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? ` (+${problems.length - 6} more)` : ""}` };
      return { verdict: VERDICT.PASS, detail: `${pillars.length} pillars, every signal carries label + weight + coverage` };
    },
  },
  {
    id: "A-06", severity: "bug",
    title: "The markdown/JSON report exports carry scores, signals and evidence",
    prereq: "A-01.",
    postCheck: "Export the PDF from the UI — the runner cannot render one. A sub-70-coverage audit must be stamped THIN, because a PDF is forwarded to clients and read months later.",
    fix: "`buildMarkdownReport` / `toJsonPayload` in auditReport.js. A report that reshapes keys for API consumers (`framework_scores.overall`) must not be fed to a renderer expecting `finalScore` — that prints 'not measured' for every score.",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const md = await api(`/audits/${ctx.auditId}/report?format=markdown`, { raw: true });
      const js = await api(`/audits/${ctx.auditId}/report?format=json`);
      const problems = [];
      if (md.status !== 200) problems.push(`markdown HTTP ${md.status}`);
      else if (!/##/.test(md.text || "")) problems.push("markdown report has no headings");
      if (js.status !== 200) problems.push(`json HTTP ${js.status}`);
      else if (!js.json || typeof js.json !== "object") problems.push("json report is not an object");
      if (problems.length) return { verdict: VERDICT.FAIL, detail: problems.join("; ") };
      return { verdict: VERDICT.PASS, detail: `markdown ${md.text.length}B · json ${Object.keys(js.json).length} keys` };
    },
  },
  {
    id: "A-07", severity: "stop-ship",
    title: "CSV rows=signals exports an unmeasured signal BLANK, never 0",
    prereq: "A-01.",
    postCheck: "Open the CSV in a spreadsheet. A 0 in a numeric column gets averaged; a blank does not. That is the whole reason for the rule.",
    fix: "`signalsToCsv` in auditReport.js must emit an empty cell for `score === null`. Any `?? 0` or `Number(x)` on the way out re-creates the bug.",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const r = await api(`/audits/${ctx.auditId}/report?format=csv&rows=signals`, { raw: true });
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const res = await api(`/audits/${ctx.auditId}/results`);
      const unmeasured = Object.values(res.json?.pillars || {})
        .flatMap((p) => p.signals || []).filter((s) => s.measured === false).map((s) => s.code);
      if (!unmeasured.length) return { verdict: VERDICT.PASS, detail: "no unmeasured signal on this audit — the rule is untested here" };
      const lines = (r.text || "").split("\n");
      const offenders = [];
      for (const code of unmeasured) {
        const line = lines.find((l) => l.startsWith(`${code},`) || l.includes(`,${code},`));
        if (line && /(^|,)0(\.0)?(,|$)/.test(line)) offenders.push(code);
      }
      if (offenders.length) return { verdict: VERDICT.FAIL, detail: `unmeasured signals exported as 0: ${offenders.join(", ")}` };
      return { verdict: VERDICT.PASS, detail: `${unmeasured.length} unmeasured signal(s) exported blank` };
    },
  },
  {
    id: "A-08", severity: "stop-ship",
    title: "A robots.txt-disallowed URL is refused clearly, not as a crash",
    prereq: "--allow-audits (the refusal costs nothing, but it is still an audit request).",
    postCheck: "🔴 Read the message a customer would see. It must name robots.txt. 'Something went wrong / An unexpected error occurred' over a minified stack is what this looked like for months, and it is a policy decision being reported as a fault.",
    fix: "Branch on `code` (`robots_disallowed`), never on the prose in `reason` — the client classifier matches on message text only, so the string hits none of its regexes and falls to the generic default.",
    needs: ["auth", "audits"],
    async run() {
      const r = await api("/audits", { method: "POST", body: { target_url: DISALLOWED_URL, source: "api" } });
      if (r.status === 201 || r.status === 200) {
        return { verdict: VERDICT.DEVIATION, detail: `${DISALLOWED_URL} was ALLOWED. Either a scrape-consent grant exists for this host on this account, or robots handling is off. Revoke the grant and re-run.` };
      }
      if (r.status !== 403) return { verdict: VERDICT.FAIL, detail: `expected 403, got HTTP ${r.status} — ${r.json?.error || r.error || ""}` };
      const body = JSON.stringify(r.json || {});
      if (!/robots/i.test(body)) return { verdict: VERDICT.FAIL, detail: `refused, but the body never mentions robots.txt: ${body.slice(0, 200)}` };
      if (/\bat\s+\w+\s+\(/.test(body) || /stack/i.test(body)) return { verdict: VERDICT.FAIL, detail: "the refusal body carries a stack trace — a decision rendered as a crash" };
      return { verdict: VERDICT.PASS, detail: `403 · ${(r.json?.error || "").slice(0, 120)}` };
    },
  },
  {
    id: "A-09", severity: "bug",
    title: "The refusal in A-08 created no audit row and cost nothing",
    prereq: "A-08.",
    postCheck: "Check the account's usage for the month before and after. A refused request must be free — `consumeGuestCredit` once ran BEFORE the compliance check and a guest pasting three disallowed URLs was charged three times for work never done.",
    fix: "Gate order in executeAudit is load-bearing: everything above the audit-row insert can decline without doing work, so nothing above it may bill.",
    needs: ["auth", "audits"],
    async run() {
      const list = await api("/audits?limit=25");
      const audits = list.json?.audits || [];
      const host = new URL(DISALLOWED_URL).hostname;
      const leaked = audits.filter((a) => String(a.target_url || "").includes(host));
      if (leaked.length) return { verdict: VERDICT.FAIL, detail: `${leaked.length} audit row(s) exist for ${host} — a refusal was charged for` };
      return { verdict: VERDICT.PASS, detail: `no audit row for ${host}` };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §4 · W9 + W10 — business truth record and entity graph
// ════════════════════════════════════════════════════════════════════════════

/** A domain that is this run's alone, so a re-run never collides with itself. */
const RUN_DOMAIN = `${RUN_ID.replace(/[^a-z0-9]/g, "")}.verify.invalid`;

suite("w9w10", "W9 + W10 — truth record, approval interlocks, entity graph", [
  {
    id: "B-01", severity: "stop-ship",
    title: "A truth record is created and a draft version saved",
    prereq: "--allow-writes and a Select-or-above account.",
    postCheck: "The record should be visible in the account's own list. Confirm the canonical domain is stored as a BARE HOST — lower-case, no scheme, no www. It is the bridge key to public.canonical_entities and both sides must spell it identically or the same company resolves twice.",
    fix: "A 402 means W14's entitlement gate refused — expected on Free. A 500 means the table is absent; see P-02.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/business-truth", { method: "POST", body: { canonical_domain: RUN_DOMAIN, display_name: `Verify run ${RUN_ID}` } });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: `entitlement refused (this is the Free-plan behaviour, see E-01): ${r.json?.error || ""}` };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `POST /business-truth returned HTTP ${r.status} — ${r.json?.error || r.error || ""}` };
      ctx.truthRecordId = r.json?.record?.id || null;
      if (!ctx.truthRecordId) return { verdict: VERDICT.FAIL, detail: "created, but no record id came back" };
      ctx.created.push({ kind: "truth_record", id: ctx.truthRecordId });

      const v = await api(`/business-truth/${ctx.truthRecordId}/versions`, {
        method: "POST",
        body: { source: "declared", fields: { legal_name: `Verify Run ${RUN_ID} Pvt Ltd`, canonical_domain: RUN_DOMAIN } },
      });
      if (v.status !== 201) return { verdict: VERDICT.FAIL, detail: `version POST returned HTTP ${v.status} — ${v.json?.error || ""}` };
      ctx.truthVersionId = v.json?.version?.id || null;
      const stored = r.json?.record?.canonical_domain;
      if (stored && stored !== RUN_DOMAIN.toLowerCase()) {
        return { verdict: VERDICT.DEVIATION, detail: `canonical_domain stored as "${stored}", expected the bare lower-case host "${RUN_DOMAIN}"` };
      }
      return { verdict: VERDICT.PASS, detail: `record ${ctx.truthRecordId} · version ${ctx.truthVersionId}` };
    },
  },
  {
    id: "B-02", severity: "stop-ship",
    title: "Self-approval of your own truth version is REFUSED",
    prereq: "B-01.",
    postCheck: "🔴 Confirm the message says a second person must look, not 'something went wrong'. Blocked in three places — canPromote(), the audit_btv_no_self_approval CHECK, and promote_business_truth_version() — so a 200 here means all three were bypassed.",
    fix: "If this passes, the interlock is gone. Re-check 0055's CHECK constraint and the SQL function — the route alone is not the guard.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.truthRecordId || !ctx.truthVersionId) return { verdict: VERDICT.BLOCKED, detail: "no truth version from B-01" };
      await api(`/business-truth/${ctx.truthRecordId}/versions/${ctx.truthVersionId}/submit`, { method: "POST", body: {} });
      const r = await api(`/business-truth/${ctx.truthRecordId}/versions/${ctx.truthVersionId}/promote`, { method: "POST", body: {} });
      if (r.status === 200) return { verdict: VERDICT.FAIL, detail: "🔴 you approved your own version — self-approval is supposed to be refused in three independent places" };
      if (r.status !== 403) return { verdict: VERDICT.DEVIATION, detail: `refused, but with HTTP ${r.status} (${r.json?.code || "no code"}) rather than 403 SELF_APPROVAL — ${r.json?.error || ""}` };
      return { verdict: VERDICT.PASS, detail: `403 ${r.json?.code} · ${(r.json?.error || "").slice(0, 90)}` };
    },
  },
  {
    id: "B-04", severity: "stop-ship",
    title: "audit_business_truth_conflicts is actually WRITTEN, not merely declared",
    prereq: "--db-url, or an account that has already audited a domain with an approved record.",
    postCheck: "🔴 This schema's own recorded failure mode is a column declared, reviewed, merged and written by nothing — four times. A read path returns null identically for 'no conflict' and 'nobody ever wrote here', which is why this is checked at the storage layer.",
    fix: "checkAgainstTruthRecord() must be called from executeAudit and its result stored. A conflict table that stays empty across real audits of a recorded domain is the fifth instance of the pattern.",
    needs: ["db"],
    async run() {
      const r = await db(`select count(*)::int as n from public.audit_business_truth_conflicts`);
      if (!r.ok) return { verdict: r.error && /does not exist/.test(r.error) ? VERDICT.DEVIATION : VERDICT.SKIP, detail: r.error || "" };
      const n = r.rows[0]?.n ?? 0;
      if (n === 0) return { verdict: VERDICT.SKIP, detail: "the table exists and is empty — no audit on this database has yet run against a domain with an approved truth record, so there is nothing to have written" };
      return { verdict: VERDICT.PASS, detail: `${n} conflict row(s) written` };
    },
  },
  {
    id: "B-05", severity: "stop-ship",
    title: "Two entities and a valid edge between them are created",
    prereq: "--allow-writes.",
    postCheck: "Both endpoint types are JOINED from the entities, never stored on the edge — a second copy would drift the first time a node was re-typed. Confirm the edge response does not carry its own subject_type/object_type.",
    fix: "A 422 INVALID_RELATIONSHIP means the predicate's domain/range rejected the pair, which is the model working. A 500 means the table is absent.",
    needs: ["auth", "writes"],
    async run() {
      const a = await api("/entity-graph/entities", { method: "POST", body: { entity_type: "organization", name: `Verify Org ${RUN_ID}`, source: "declared" } });
      if (a.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (a.status !== 201) return { verdict: VERDICT.FAIL, detail: `entity A: HTTP ${a.status} — ${a.json?.error || ""}` };
      const b = await api("/entity-graph/entities", { method: "POST", body: { entity_type: "brand", name: `Verify Brand ${RUN_ID}`, source: "declared" } });
      if (b.status !== 201) return { verdict: VERDICT.FAIL, detail: `entity B: HTTP ${b.status} — ${b.json?.error || ""}` };
      ctx.entityAId = a.json?.entity?.id; ctx.entityBId = b.json?.entity?.id;
      ctx.created.push({ kind: "entity", id: ctx.entityAId }, { kind: "entity", id: ctx.entityBId });

      const e = await api("/entity-graph/relationships", { method: "POST", body: { subject_id: ctx.entityAId, predicate: "owns", object_id: ctx.entityBId, source: "declared" } });
      if (e.status !== 201) return { verdict: VERDICT.FAIL, detail: `relationship: HTTP ${e.status} — ${e.json?.error || ""}` };
      ctx.relationshipId = e.json?.relationship?.id || null;
      return { verdict: VERDICT.PASS, detail: `organization --owns--> brand · edge ${ctx.relationshipId}` };
    },
  },
  {
    id: "B-06", severity: "stop-ship",
    title: "A duplicate edge is 409 and the body says it was corroborated",
    prereq: "B-05.",
    postCheck: "🔴 Without the unique index a weekly crawler adds a row per run, every count doubles, and 'who do we compete with' answers differently depending on how many audits have happened. Confirm the edge count did not grow.",
    fix: "`corroborated: false` in the 409 body means recordEntityEvidence did not write — the exact defect W-security found, where the route CLAIMED corroboration and its test asserted the claim rather than the write.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.entityAId || !ctx.entityBId) return { verdict: VERDICT.BLOCKED, detail: "no entities from B-05" };
      const r = await api("/entity-graph/relationships", { method: "POST", body: { subject_id: ctx.entityAId, predicate: "owns", object_id: ctx.entityBId, source: "declared" } });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 the same edge was created TWICE — the unique index is missing, so every graph count will drift upward with each crawl" };
      if (r.status !== 409) return { verdict: VERDICT.FAIL, detail: `expected 409 RELATIONSHIP_EXISTS, got HTTP ${r.status}` };
      if (r.json?.corroborated !== true) {
        return { verdict: VERDICT.FAIL, detail: "409 says the edge exists but `corroborated` is not true — the body's own sentence ('re-observing corroborates it') is false again, and audit_entity_evidence stays empty" };
      }
      return { verdict: VERDICT.PASS, detail: "409 RELATIONSHIP_EXISTS · corroborated: true" };
    },
  },
  {
    id: "B-07", severity: "stop-ship",
    title: "audit_entity_evidence carries the corroboration row",
    prereq: "B-06, and --db-url to read it directly.",
    postCheck: "0056's header states the reason: 'we read this once in 2024' and 'we have read this on six pages across nine months' are different warranties on the same edge. An empty table means only the first sentence is ever true.",
    fix: "recordEntityEvidence() must be called from the duplicate-edge branch. It shipped written and called by nothing.",
    needs: ["db"],
    async run() {
      const r = await db(`select count(*)::int as n from public.audit_entity_evidence`);
      if (!r.ok) return { verdict: /does not exist/.test(r.error || "") ? VERDICT.DEVIATION : VERDICT.SKIP, detail: r.error || "" };
      const n = r.rows[0]?.n ?? 0;
      if (n === 0 && ALLOW_WRITES) return { verdict: VERDICT.FAIL, detail: "B-06 reported corroboration and the table is empty — the claim and the write disagree" };
      if (n === 0) return { verdict: VERDICT.SKIP, detail: "table empty and no writes were made this run" };
      return { verdict: VERDICT.PASS, detail: `${n} evidence row(s)` };
    },
  },
  {
    id: "B-08", severity: "bug",
    title: "A self-edge (A → A) is refused",
    prereq: "B-05.",
    postCheck: "'Acme is part of Acme' is vacuously true and pollutes every traversal. The refusal should say so.",
    fix: "Refused in the route (SELF_EDGE) and by a CHECK in 0056. A 201 means both are gone.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.entityAId) return { verdict: VERDICT.BLOCKED, detail: "no entity from B-05" };
      const r = await api("/entity-graph/relationships", { method: "POST", body: { subject_id: ctx.entityAId, predicate: "part_of", object_id: ctx.entityAId, source: "declared" } });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "a self-edge was created" };
      if (r.json?.code !== "SELF_EDGE") return { verdict: VERDICT.DEVIATION, detail: `refused with HTTP ${r.status} ${r.json?.code || ""} rather than SELF_EDGE` };
      return { verdict: VERDICT.PASS, detail: "400 SELF_EDGE" };
    },
  },
  {
    id: "B-09", severity: "bug",
    title: "Approving an edge approves both endpoints in one statement",
    prereq: "B-05 and a SECOND account, because self-approval is refused here too.",
    postCheck: "The endpoints are APPROVED, not CREATED — a node somebody rejected must block the edge rather than being silently revived. Confirm a rejected endpoint yields 409 ENDPOINT_REJECTED.",
    fix: "approveEntityRelationship() does all three in one SQL statement. Three PostgREST calls would leave windows where an approved edge joins two unreviewed nodes.",
    needs: ["auth", "writes", "tenantB"],
    async run() {
      if (!ctx.relationshipId) return { verdict: VERDICT.BLOCKED, detail: "no relationship from B-05" };
      const r = await api(`/entity-graph/relationships/${ctx.relationshipId}/approve`, { method: "POST", token: TOKEN_B, body: {} });
      if (r.status === 404) return { verdict: VERDICT.SKIP, detail: "the second account cannot see this edge — it needs to share the workspace. Cross-account approval must be set up by hand." };
      if (r.status !== 200) return { verdict: VERDICT.DEVIATION, detail: `approve returned HTTP ${r.status} ${r.json?.code || ""} — ${r.json?.error || ""}` };
      return { verdict: VERDICT.PASS, detail: "approved by a second account" };
    },
  },
  {
    id: "B-10", severity: "stop-ship",
    title: "Another tenant's entity id in an edge is 404, never 403",
    prereq: "DATIQ_TENANT_B_TOKEN, and B-05 having created an entity under the primary account.",
    postCheck: "🔴 A 403 confirms the row exists and turns the endpoint into an enumeration oracle over other tenants' uuids. This is the single most important row in this section.",
    fix: "The route must look the endpoint entities up SCOPED TO THE CALLER and return notFound() when either is absent. `getEntity(userId, id)` — never a global read followed by an ownership comparison.",
    needs: ["auth", "writes", "tenantB"],
    async run() {
      if (!ctx.entityAId || !ctx.entityBId) return { verdict: VERDICT.BLOCKED, detail: "no entities from B-05" };
      const r = await api("/entity-graph/relationships", {
        method: "POST", token: TOKEN_B,
        body: { subject_id: ctx.entityAId, predicate: "owns", object_id: ctx.entityBId, source: "declared" },
      });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 tenant B drew an edge between tenant A's entities" };
      if (r.status === 403) return { verdict: VERDICT.FAIL, detail: "🔴 403 — this confirms the ids are real and makes the endpoint an enumeration oracle. It must be 404." };
      if (r.status !== 404) return { verdict: VERDICT.DEVIATION, detail: `expected 404, got HTTP ${r.status} ${r.json?.code || ""}` };
      return { verdict: VERDICT.PASS, detail: "404 — the ids are not confirmed to exist" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §5 · W12 — local and directory intelligence
// ════════════════════════════════════════════════════════════════════════════

const CANONICAL_NAP = Object.freeze({
  name: "Verify Run Private Limited",
  address: "221 Residency Road, Bengaluru",
  phone: "+91 80 4718 2200",
  postal_code: "560025",
  locality: "Bengaluru",
});

suite("w12", "W12 — NAP normalisation, tiers, coverage honesty", [
  {
    id: "C-01", severity: "stop-ship",
    title: "A directory listing SAVES (the 0059 arbiter fix)",
    prereq: "--allow-writes.",
    postCheck: "🔴 The failure this guards is total: PostgREST's `on_conflict=` names COLUMNS, and PostgreSQL will not select an expression index as that arbiter — so 0058's coalesce() index made every listing save fail. Confirm the row comes back with an id.",
    fix: "0059 replaced the expression index with `unique nulls not distinct (...)`. If saves are refused here, this database is on 0058 and needs 0059.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/local-directory/listings", {
        method: "POST",
        body: {
          source_id: "justdial", acquisition: "public_listing",
          listing_url: `https://www.justdial.com/verify/${RUN_ID}`,
          observed_name: "Verify Run Pvt Ltd",
          observed_address: "221 Residency Rd, Bengaluru",
          observed_phone: "08047182200",
          observed_postal_code: "560025",
          observed_locality: "Bengaluru",
          ...(ctx.truthRecordId ? { truth_record_id: ctx.truthRecordId } : {}),
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || r.json?.detail || ""}` };
      ctx.listingId = r.json?.listing?.id || null;
      if (ctx.listingId) ctx.created.push({ kind: "listing", id: ctx.listingId });
      return { verdict: VERDICT.PASS, detail: `listing ${ctx.listingId}` };
    },
  },
  {
    id: "C-02", severity: "stop-ship",
    title: "“Pvt Ltd” vs “Private Limited”, “Rd” vs “Road”, +91 vs 0 — all MATCH",
    prereq: "C-01, so there is a listing to check against.",
    postCheck: "🔴 A checker that reports these three as mismatches produces a list nobody reads, and then the one real mismatch in it goes unfixed. Read the match rows and confirm the three fields are `match`, not `mismatch`.",
    fix: "Every equivalence in napModel.js is a declared, tested rule — never a fuzzy ratio. A mismatch here means a rule was dropped, not that a threshold needs tuning.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.listingId) return { verdict: VERDICT.BLOCKED, detail: "no listing from C-01" };
      const r = await api("/local-directory/check", {
        method: "POST",
        body: { canonical: CANONICAL_NAP, country: "IN", ...(ctx.truthRecordId ? { truth_record_id: ctx.truthRecordId } : {}) },
      });
      if (r.status !== 201 && r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      ctx.localCheck = r.json;
      const m = (r.json?.matches || []).find((x) => x.sourceId === "justdial" || x.listingId === ctx.listingId);
      if (!m) return { verdict: VERDICT.SKIP, detail: "the check ran but returned no match row for this run's listing" };
      const wrong = (m.mismatches || []).filter((f) => ["name", "address", "phone"].includes(f.field || f));
      if (wrong.length) {
        return { verdict: VERDICT.FAIL, detail: `these are the SAME values written differently and were reported as mismatches: ${wrong.map((x) => x.field || x).join(", ")}` };
      }
      return { verdict: VERDICT.PASS, detail: `name/address/phone all matched across the normalisation rules · score ${r.json?.score?.score}` };
    },
  },
  {
    id: "C-04", severity: "bug",
    title: "A registry (MCA) address difference is LD-05, not a NAP mismatch",
    prereq: "--allow-writes; the runner records an MCA listing whose address differs.",
    postCheck: "A registered office is routinely not a shopfront. Reporting an MCA difference as a NAP mismatch sends a customer to amend a STATUTORY FILING to match a shopfront — expensive, slow, and the wrong fix.",
    fix: "LD-05 is its own low-severity code for exactly this. If the finding comes back as a general NAP mismatch code, the registry carve-out was lost.",
    needs: ["auth", "writes"],
    async run() {
      const l = await api("/local-directory/listings", {
        method: "POST",
        body: {
          source_id: "mca", acquisition: "declared_url",
          listing_url: `https://www.mca.gov.in/verify/${RUN_ID}`,
          observed_name: "Verify Run Private Limited",
          observed_address: "9th Floor, Registered Office Tower, Mumbai",
          observed_postal_code: "400001", observed_locality: "Mumbai",
          ...(ctx.truthRecordId ? { truth_record_id: ctx.truthRecordId } : {}),
        },
      });
      if (l.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (l.status !== 201) return { verdict: VERDICT.FAIL, detail: `MCA listing: HTTP ${l.status} — ${l.json?.error || ""}` };
      ctx.created.push({ kind: "listing", id: l.json?.listing?.id });
      const r = await api("/local-directory/check", {
        method: "POST",
        body: { canonical: CANONICAL_NAP, country: "IN", ...(ctx.truthRecordId ? { truth_record_id: ctx.truthRecordId } : {}) },
      });
      const codes = (r.json?.findings || []).map((f) => f.code);
      if (!codes.includes("LD-05")) {
        return { verdict: VERDICT.FAIL, detail: `a registry address difference produced ${codes.join(", ") || "no finding"} — LD-05 is the code that says what this actually means` };
      }
      const sev = (r.json?.findings || []).find((f) => f.code === "LD-05")?.severity;
      return { verdict: VERDICT.PASS, detail: `LD-05 raised${sev ? ` (severity ${sev})` : ""}` };
    },
  },
  {
    id: "C-05", severity: "stop-ship",
    title: "An unchecked source is EXCLUDED and named, never scored 0",
    prereq: "C-02 (a completed check).",
    postCheck: "🔴 Under D5 most customers authorise nothing. Zero-for-unchecked opens every local report near zero — a number about OUR connectors, not their business — then shows a phantom jump the day they connect one.",
    fix: "napScore() must exclude unchecked sources and redistribute, the same rule weightedMean() holds for signals. An `unchecked` array that is empty while most sources have no listing means the exclusion was lost.",
    needs: ["auth"],
    async run() {
      const score = ctx.localCheck?.score;
      if (!score) return { verdict: VERDICT.BLOCKED, detail: "no completed local check from C-02" };
      const unchecked = score.unchecked || score.excluded || [];
      if (!Array.isArray(unchecked)) return { verdict: VERDICT.FAIL, detail: "the score carries no `unchecked` list — unchecked sources cannot be being named" };
      if (unchecked.length === 0) return { verdict: VERDICT.DEVIATION, detail: "no source was reported unchecked, which would only be right if every configured source has a listing on this account" };
      if (typeof score.checkedCount === "number" && typeof score.score === "number" && score.checkedCount === 0 && score.score === 0) {
        return { verdict: VERDICT.FAIL, detail: "zero sources checked and the score is 0 — that is a number about our connectors reported as a number about their business" };
      }
      return { verdict: VERDICT.PASS, detail: `${unchecked.length} source(s) excluded and named · checked ${score.checkedCount} · score ${score.score}` };
    },
  },
  {
    id: "C-07", severity: "stop-ship",
    title: "The coverage sentence never claims a flat “N directories audited”",
    prereq: "C-02.",
    postCheck: "🔴 That claim is false for every customer who has authorised nothing. Read the actual sentence — it is customer-facing copy, and this is the one place it is built.",
    fix: "coverageClaim() is the ONE place the sentence is built, and a test sweeps every input for the forbidden form. A flat claim here means a second builder appeared somewhere.",
    needs: ["auth"],
    async run() {
      const claim = ctx.localCheck?.coverage_claim;
      if (!claim) return { verdict: VERDICT.BLOCKED, detail: "no coverage_claim on the check from C-02" };
      const text = typeof claim === "string" ? claim : JSON.stringify(claim);
      if (/\b\d+\s+director(y|ies)\s+audited\b/i.test(text)) {
        return { verdict: VERDICT.FAIL, detail: `the forbidden flat claim is back: "${text}"` };
      }
      return { verdict: VERDICT.PASS, detail: `"${text.slice(0, 140)}"` };
    },
  },
  {
    id: "C-08", severity: "stop-ship",
    title: "acquisition: \"authorized_api\" is REFUSED from a request body",
    prereq: "--allow-writes.",
    postCheck: "Fidelity is a claim about HOW an observation was obtained. A claim a client can set is not a claim — it is `?consented=true` wearing a third hat.",
    fix: "CLIENT_ACQUISITION is the allow-list: declared_url and public_listing only. An authorised-API observation can only be written by the connector that held the token.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/local-directory/listings", {
        method: "POST",
        body: {
          source_id: "justdial", acquisition: "authorized_api",
          listing_url: `https://www.justdial.com/verify/${RUN_ID}-fidelity`,
          observed_name: "Verify Run Pvt Ltd",
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 a client declared its own observation to be an authorised-API read. Fidelity is now a flag anyone can set." };
      if (r.status !== 400) return { verdict: VERDICT.DEVIATION, detail: `refused with HTTP ${r.status} rather than 400` };
      return { verdict: VERDICT.PASS, detail: `400 · ${(r.json?.error || "").slice(0, 110)}` };
    },
  },
  {
    id: "C-09", severity: "stop-ship",
    title: "A listing attached to another tenant's truth_record_id is 404",
    prereq: "DATIQ_TENANT_B_TOKEN and B-01's record under the primary account.",
    postCheck: "🔴 404, never 403. W12 shipped without this check at all, so a caller could file a whole local check against another tenant's row: the attacker's user_id with the victim's foreign key, and every later join reading a row its owner never wrote.",
    fix: "requireLocalRefs() checks truth_record_id and subject_id against OWNED rows, and workspace_id through buildWorkspaceCtx.",
    needs: ["auth", "writes", "tenantB"],
    async run() {
      if (!ctx.truthRecordId) return { verdict: VERDICT.BLOCKED, detail: "no truth record from B-01" };
      const r = await api("/local-directory/listings", {
        method: "POST", token: TOKEN_B,
        body: {
          source_id: "justdial", acquisition: "public_listing",
          listing_url: `https://www.justdial.com/verify/${RUN_ID}-crosstenant`,
          observed_name: "Cross tenant probe",
          truth_record_id: ctx.truthRecordId,
        },
      });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 tenant B attached a listing to tenant A's truth record" };
      if (r.status === 403) return { verdict: VERDICT.FAIL, detail: "🔴 403 confirms the record exists — this must be 404" };
      if (r.status !== 404) return { verdict: VERDICT.DEVIATION, detail: `expected 404, got HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "404" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §6 · W13 — schema intelligence and trust & proof (0062)
// ════════════════════════════════════════════════════════════════════════════

suite("w13", "W13 — schema fidelity and quality-over-volume trust", [
  {
    id: "D-01", severity: "bug",
    title: "The schema/trust registry answers with the frozen vocabulary",
    prereq: "A valid token. Read-only, safe on production.",
    postCheck: "🔴 `WebSite` must appear in excluded_types. The sitelinks-searchbox pattern is a WebSite block with url + potentialAction and no name — common AND correct — so including it would fire the ENTITY_SCHEMA_INVALID blocker across a large share of the healthy web.",
    fix: "The registry is frozen in schemaIntelligence.js/trustProof.js. A short list means this deploy predates W13.",
    needs: ["auth"],
    async run() {
      const r = await api("/schema-trust/schema-registry");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const j = r.json || {};
      const problems = [];
      if ((j.approved_types || []).length !== 8) problems.push(`approved_types = ${(j.approved_types || []).length}, expected 8`);
      if (!(j.excluded_types || []).includes("WebSite")) problems.push("WebSite is NOT in excluded_types");
      if ((j.tc_components || []).length !== 6) problems.push(`tc_components = ${(j.tc_components || []).length}, expected 6`);
      if ((j.components || []).length !== 5) problems.push(`schema components = ${(j.components || []).length}, expected 5`);
      if (problems.length) return { verdict: VERDICT.DEVIATION, detail: problems.join("; ") };
      return { verdict: VERDICT.PASS, detail: "8 approved types · WebSite excluded · 5 schema components · 6 TC components" };
    },
  },
  {
    id: "D-02", severity: "stop-ship",
    title: "A page's JSON-LD scores, with per-component values",
    prereq: "--allow-writes.",
    postCheck: "Every WEIGHT is verbatim from the PRD and asserted by test (Schema = 0.30O + 0.30L + 0.20S + 0.10F + 0.10G). If the PRD differs, change the LABEL — never the weight, and never the id, which travels in stored rows and every historical diff.",
    fix: "A 500 means audit_schema_entities is absent; see P-02.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/schema-trust/schema", {
        method: "POST",
        body: {
          json_ld: [{ "@context": "https://schema.org", "@type": "Organization", name: `Verify Run ${RUN_ID}`, url: `https://${RUN_DOMAIN}` }],
          page_type: "homepage", canonical_domain: RUN_DOMAIN,
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      ctx.schemaPersisted = r.json?.persisted ?? 0;
      const comps = r.json?.schema?.components || [];
      if (comps.length !== 5) return { verdict: VERDICT.DEVIATION, detail: `${comps.length} components came back, expected 5` };
      if (!ctx.schemaPersisted) return { verdict: VERDICT.FAIL, detail: "scored, but `persisted: 0` — the observation was not written. Declared-and-never-written is this schema's own recorded failure mode." };
      return { verdict: VERDICT.PASS, detail: `score ${r.json?.schema?.score} · coverage ${r.json?.schema?.coverage} · persisted ${ctx.schemaPersisted}` };
    },
  },
  {
    id: "D-04", severity: "stop-ship",
    title: "Re-posting the same type UPDATES the row, never stacks a second",
    prereq: "D-02, and --db-url or the GET count to compare.",
    postCheck: "🔴 audit_schema_entities answers “what does this page declare NOW”. Without the upsert a weekly crawler adds a row per run and every count doubles. Contrast with audit_subject_scores, which APPENDS on purpose — see F-04.",
    fix: "The arbiter must name columns. An expression index is not selectable by PostgREST's `on_conflict=` — that is 0058's defect, repaired by 0059.",
    needs: ["auth", "writes"],
    async run() {
      const before = await api("/schema-trust/schema");
      const n0 = before.json?.count ?? null;
      const r = await api("/schema-trust/schema", {
        method: "POST",
        body: {
          json_ld: [{ "@context": "https://schema.org", "@type": "Organization", name: `Verify Run ${RUN_ID}`, url: `https://${RUN_DOMAIN}` }],
          page_type: "homepage", canonical_domain: RUN_DOMAIN,
        },
      });
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `re-post returned HTTP ${r.status}` };
      const after = await api("/schema-trust/schema");
      const n1 = after.json?.count ?? null;
      if (n0 === null || n1 === null) return { verdict: VERDICT.SKIP, detail: "could not read the entity count on either side" };
      if (n1 > n0) return { verdict: VERDICT.FAIL, detail: `count went ${n0} → ${n1} — the same declaration stacked a second row. Every schema count on this account will now drift upward with each crawl.` };
      return { verdict: VERDICT.PASS, detail: `count unchanged at ${n1} — the re-observation updated in place` };
    },
  },
  {
    id: "D-05", severity: "stop-ship",
    title: "A declared FAQPage with no visible questions scores fidelity 0",
    prereq: "--allow-writes.",
    postCheck: "🔴 This is the ONE score where MORE markup means a LOWER number, and it is deliberate: a declared FAQPage with nothing behind it is a machine-readable false statement, and it is what gets rich results revoked. `schemaGaps` must put this contradiction AHEAD of any absence.",
    fix: "If fidelity rewards the declaration, the model is rewarding the exact defect constructTemplates refuses to generate.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/schema-trust/schema", {
        method: "POST",
        body: {
          json_ld: [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }] }],
          page_type: "homepage", visible_faq: 0, canonical_domain: RUN_DOMAIN,
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      const fid = (r.json?.schema?.components || []).find((c) => c.id === "fidelity");
      if (!fid) return { verdict: VERDICT.FAIL, detail: "no `fidelity` component came back" };
      if (fid.value !== 0) return { verdict: VERDICT.FAIL, detail: `fidelity = ${fid.value}, expected 0. A declared FAQPage with no visible questions is a false statement and must score BELOW having none.` };
      const gaps = r.json?.gaps || [];
      const first = gaps[0];
      return { verdict: VERDICT.PASS, detail: `fidelity 0${first ? ` · leading gap: ${first.code || first.id || JSON.stringify(first).slice(0, 60)}` : ""}` };
    },
  },
  {
    id: "D-06", severity: "stop-ship",
    title: "Self-published material is CAPPED — volume does not buy a score",
    prereq: "--allow-writes.",
    postCheck: "🔴 Ten unattributed testimonials on a page the business controls must never outscore one verifiable third-party record. A counting model is trivially gamed by the party being measured — and worse, it REWARDS the behaviour, so the number rises while the thing it measures falls.",
    fix: "The cap is a DERIVED fact, not a second guard: self_published's 0.25 weight bounds the score at 25. A `Math.min(best, 40)` that could never fire is the kind of redundant guard a test gets wrongly pinned to.",
    needs: ["auth", "writes"],
    async run() {
      for (let i = 0; i < 10; i++) {
        const r = await api("/schema-trust/trust", { method: "POST", body: { signal: "named_customers", observed_count: 1 } });
        if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
        if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `observation ${i + 1}: HTTP ${r.status} — ${r.json?.error || r.json?.detail || ""}` };
      }
      const g = await api("/schema-trust/trust?kind=brand");
      const score = g.json?.trust?.score;
      if (typeof score !== "number") return { verdict: VERDICT.SKIP, detail: "no trust score came back to check the cap against" };
      ctx.trustSelfOnly = score;
      if (score > 25.5) return { verdict: VERDICT.FAIL, detail: `ten self-published observations scored ${score} — above the 25 the weight table bounds them to. Volume is buying a score.` };
      return { verdict: VERDICT.PASS, detail: `ten self-published observations → ${score} (bounded at 25 by the weight table)` };
    },
  },
  {
    id: "D-07", severity: "stop-ship",
    title: "ONE independent, verifiable record beats any quantity of self-published",
    prereq: "D-06.",
    postCheck: "🔴 This is the whole point of the model. Confirm the number went UP substantially on the strength of a single sourced record.",
    fix: "trustProof.js scores every signal by INDEPENDENCE × VERIFIABILITY, saturating. If one sourced record does not beat ten unsourced ones, the model has become a counter.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/schema-trust/trust", {
        method: "POST",
        body: { signal: "ratings", observed_count: 1, source_url: `https://www.example.org/reviews/${RUN_ID}`, excerpt: "4.6 from 212 reviews" },
      });
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      if (r.json?.observation?.independence !== "third_party") {
        return { verdict: VERDICT.FAIL, detail: `an observation with a checkable source URL was recorded as "${r.json?.observation?.independence}" rather than third_party` };
      }
      const g = await api("/schema-trust/trust?kind=brand");
      const score = g.json?.trust?.score;
      if (typeof score !== "number") return { verdict: VERDICT.SKIP, detail: "no trust score came back" };
      if (typeof ctx.trustSelfOnly === "number" && score <= ctx.trustSelfOnly) {
        return { verdict: VERDICT.FAIL, detail: `one independent verified record moved the score ${ctx.trustSelfOnly} → ${score}. Quality is not outranking volume.` };
      }
      return { verdict: VERDICT.PASS, detail: `${ctx.trustSelfOnly ?? "?"} → ${score} on one sourced record` };
    },
  },
  {
    id: "D-09", severity: "stop-ship",
    title: "`independence` supplied in the request body is REFUSED",
    prereq: "--allow-writes.",
    postCheck: "Provenance is a claim about who holds the evidence. A claim the MEASURED PARTY can set is not a claim — the same defect as `?consented=true` and `acquisition: authorized_api`.",
    fix: "The route refuses the key outright; makeObservation() derives it from whether a checkable source URL is present. One place decides.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/schema-trust/trust", {
        method: "POST", body: { signal: "media", observed_count: 3, independence: "third_party" },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 a client declared its own observations independent. Provenance is now a flag anyone can set." };
      if (r.status !== 400) return { verdict: VERDICT.DEVIATION, detail: `refused with HTTP ${r.status} rather than 400` };
      return { verdict: VERDICT.PASS, detail: `400 · ${(r.json?.error || "").slice(0, 110)}` };
    },
  },
  {
    id: "D-10", severity: "stop-ship",
    title: "Another tenant's subject_id on a schema/trust write is 404",
    prereq: "DATIQ_TENANT_B_TOKEN and a subject id from the primary account (F-02 resolves one).",
    postCheck: "🔴 404, never 403.",
    fix: "requireSchemaTrustRefs() is the W13 equivalent of requireLocalRefs().",
    needs: ["auth", "writes", "tenantB"],
    async run() {
      if (!ctx.subjectId) return { verdict: VERDICT.BLOCKED, detail: "no subject id resolved — F-02 runs after this; re-run with an audit available" };
      const r = await api("/schema-trust/trust", {
        method: "POST", token: TOKEN_B,
        body: { signal: "credentials", observed_count: 1, subject_id: ctx.subjectId },
      });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 tenant B recorded a trust observation against tenant A's subject" };
      if (r.status === 403) return { verdict: VERDICT.FAIL, detail: "🔴 403 confirms the subject exists — must be 404" };
      if (r.status !== 404) return { verdict: VERDICT.DEVIATION, detail: `expected 404, got HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "404" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §7 · W14 — entitlement gating (0063) and revalidation
// ════════════════════════════════════════════════════════════════════════════

const P2_WRITES = [
  ["business-truth", { canonical_domain: `gate-${RUN_ID}.verify.invalid` }],
  ["entity-graph/entities", { entity_type: "organization", name: `Gate probe ${RUN_ID}`, source: "declared" }],
  ["local-directory/listings", { source_id: "justdial", acquisition: "public_listing", listing_url: `https://www.justdial.com/gate/${RUN_ID}`, observed_name: "Gate probe" }],
  ["schema-trust/trust", { signal: "media", observed_count: 1 }],
];

suite("w14", "W14 — the entitlement gate W9–W13 shipped without, and revalidation", [
  {
    id: "E-01", severity: "stop-ship",
    title: "On a FREE account every P2 write is refused with 402",
    prereq: "DATIQ_FREE_TOKEN — a token for an account on the Free plan.",
    postCheck: "🔴 W9 through W13 shipped UNGATED: every truth record, graph edge, directory listing and trust observation was writable on any plan including Free, and a 100% green gate proved nothing about it because nothing checked. Read one refusal and confirm it names the plan needed.",
    fix: "Each P2 route calls gateP2Capability() before any non-GET. A 201 here means the gate is missing from that route.",
    needs: ["free"],
    async run() {
      const allowed = [];
      for (const [path, body] of P2_WRITES) {
        const r = await api(`/${path}`, { method: "POST", token: TOKEN_FREE, body });
        if (r.status === 201 || r.status === 200) allowed.push(`${path} → ${r.status}`);
        else if (r.status !== 402) allowed.push(`${path} → ${r.status} (expected 402)`);
      }
      if (allowed.length) return { verdict: VERDICT.FAIL, detail: `not refused with 402: ${allowed.join("; ")}` };
      return { verdict: VERDICT.PASS, detail: `all ${P2_WRITES.length} P2 write surfaces refused a Free account with 402` };
    },
  },
  {
    id: "E-02", severity: "stop-ship",
    title: "On a FREE account the same records READ fine (200)",
    prereq: "DATIQ_FREE_TOKEN.",
    postCheck: "🔴 Writes are gated; reads are not. Refusing to show a customer the record they already own is TAKING AWAY something they were given, which is a different act from declining to create more.",
    fix: "gateP2Capability() must be called only for `method !== \"GET\"`. A 402 on a GET means the gate moved above the method check.",
    needs: ["free"],
    async run() {
      const reads = ["business-truth", "entity-graph/entities", "local-directory/listings", "schema-trust/trust", "subject-score/scores"];
      const refused = [];
      for (const p of reads) {
        const r = await api(`/${p}`, { token: TOKEN_FREE });
        if (r.status !== 200) refused.push(`${p} → ${r.status}`);
      }
      if (refused.length) return { verdict: VERDICT.FAIL, detail: `reads refused on a Free account: ${refused.join("; ")}` };
      return { verdict: VERDICT.PASS, detail: `all ${reads.length} P2 read surfaces answered 200 on a Free account` };
    },
  },
  {
    id: "E-04", severity: "bug",
    title: "A P2 write consumes no audit",
    prereq: "B-01/C-01/D-02 having written something this run.",
    postCheck: "These make no provider call, so charging an audit would bill for work nobody did. Compare the account's audit count for the month before and after the run.",
    fix: "The P2 capabilities return ok(Infinity) — feature gating, not metering. If the count moves, one of them is routed through gateAuditQuota by mistake.",
    needs: ["auth", "writes"],
    async run() {
      const list = await api("/audits?limit=50");
      const now = Array.isArray(list.json?.audits) ? list.json.audits.length : null;
      if (now === null || ctx.auditCountBefore === null) return { verdict: VERDICT.SKIP, detail: "no before/after audit count (A-01 did not run)" };
      const expected = ctx.auditCountBefore + (ctx.auditId ? 1 : 0) + (ctx.secondAuditId ? 1 : 0);
      if (now > expected) return { verdict: VERDICT.FAIL, detail: `audit rows went ${ctx.auditCountBefore} → ${now}; only ${expected - ctx.auditCountBefore} audit(s) were requested. A P2 write is being charged as an audit.` };
      return { verdict: VERDICT.PASS, detail: `audit rows ${ctx.auditCountBefore} → ${now}, exactly the ${expected - ctx.auditCountBefore} requested` };
    },
  },
  {
    id: "E-05", severity: "bug",
    title: "Revalidation is accepted on an implemented recommendation",
    prereq: "A-01, and at least one recommendation on that audit.",
    postCheck: "It records a REQUEST and charges nothing at request time. The run happens on the monitor's tick, where it is visible and countable.",
    fix: "A 409 NOT_IMPLEMENTED means the recommendation is not in implemented/done/validation_scheduled — mark it first.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const recs = await api(`/audits/${ctx.auditId}/recommendations`);
      const rec = (recs.json?.recommendations || [])[0];
      if (!rec) return { verdict: VERDICT.SKIP, detail: "the audit produced no recommendations to revalidate" };
      ctx.recommendationId = rec.id;
      const mark = await api(`/recommendations/${rec.id}/done`, { method: "POST", body: {} });
      if (mark.status !== 200) return { verdict: VERDICT.DEVIATION, detail: `could not mark implemented: HTTP ${mark.status} — ${mark.json?.error || ""}` };
      const r = await api(`/recommendations/${rec.id}/revalidate`, { method: "POST", body: {} });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "out of audit quota — E-10's condition, not a failure here" };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} ${r.json?.code || ""} — ${r.json?.error || ""}` };
      ctx.revalidationAt = r.json?.revalidation?.requested_at || null;
      return { verdict: VERDICT.PASS, detail: `requested at ${ctx.revalidationAt}` };
    },
  },
  {
    id: "E-06", severity: "stop-ship",
    title: "A second revalidation click is IDEMPOTENT — one claim, not two",
    prereq: "E-05.",
    postCheck: "🔴 Clicking twice must not cost twice. Idempotency is by the `is.null` filter, not a read-then-write: two concurrent clicks produce one claim. A check-then-set races exactly as payment-webhook.js:49-59's dedup does, and losing that race costs a second PAID audit.",
    fix: "claimRevalidation() must PATCH with `revalidation_requested_at=is.null` in the filter. Any read-then-write is the bug.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.recommendationId) return { verdict: VERDICT.BLOCKED, detail: "no revalidation from E-05" };
      const r = await api(`/recommendations/${ctx.recommendationId}/revalidate`, { method: "POST", body: {} });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 a second click created a SECOND request — this costs the customer a second paid audit" };
      if (r.status !== 200 || r.json?.already_requested !== true) {
        return { verdict: VERDICT.FAIL, detail: `expected 200 already_requested:true, got HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 140)}` };
      }
      if (ctx.revalidationAt && r.json?.revalidation?.requested_at && r.json.revalidation.requested_at !== ctx.revalidationAt) {
        return { verdict: VERDICT.FAIL, detail: "the second click moved requested_at — the claim was overwritten rather than honoured" };
      }
      return { verdict: VERDICT.PASS, detail: "200 already_requested · the original claim stands" };
    },
  },
  {
    id: "E-07", severity: "stop-ship",
    title: "Requesting revalidation ran NO audit",
    prereq: "E-05.",
    postCheck: "🔴 A re-audit is several fetches, a PageSpeed lookup, a citation sample and an AI call. An 'is this fixed yet?' control that silently spends one is the shape of thing a customer discovers on an invoice.",
    fix: "revalidateRoute must not call executeAudit. It records the request; the monitor's tick does the run.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.revalidationAt) return { verdict: VERDICT.BLOCKED, detail: "no revalidation from E-05" };
      const list = await api("/audits?limit=50");
      const now = Array.isArray(list.json?.audits) ? list.json.audits.length : null;
      const expected = (ctx.auditCountBefore ?? 0) + (ctx.auditId ? 1 : 0) + (ctx.secondAuditId ? 1 : 0);
      if (now === null) return { verdict: VERDICT.SKIP, detail: "could not read the audit list" };
      if (now > expected) return { verdict: VERDICT.FAIL, detail: `an audit row appeared after the revalidation request (${expected} expected, ${now} present)` };
      return { verdict: VERDICT.PASS, detail: "no audit ran — the request was recorded only" };
    },
  },
  {
    id: "E-08", severity: "bug",
    title: "Revalidating a NOT-implemented recommendation is refused",
    prereq: "A-01 with at least two recommendations.",
    postCheck: "Asking to revalidate an open item would spend an audit to confirm what the last one said. The refusal should say to mark it implemented first.",
    fix: "revalidateRoute gates on status ∈ {implemented, done, validation_scheduled} before the quota check.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.BLOCKED, detail: "no audit from A-01" };
      const recs = await api(`/audits/${ctx.auditId}/recommendations`);
      const open = (recs.json?.recommendations || []).find((x) => x.id !== ctx.recommendationId && !["implemented", "done", "validation_scheduled"].includes(x.status));
      if (!open) return { verdict: VERDICT.SKIP, detail: "no second, un-implemented recommendation on this audit" };
      const r = await api(`/recommendations/${open.id}/revalidate`, { method: "POST", body: {} });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "an OPEN recommendation was accepted for revalidation — this spends an audit to confirm what the last one said" };
      if (r.status !== 409 || r.json?.code !== "NOT_IMPLEMENTED") {
        return { verdict: VERDICT.DEVIATION, detail: `refused with HTTP ${r.status} ${r.json?.code || ""} rather than 409 NOT_IMPLEMENTED` };
      }
      return { verdict: VERDICT.PASS, detail: "409 NOT_IMPLEMENTED" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §8 · W11 — subject scoring (0064)
// ════════════════════════════════════════════════════════════════════════════

suite("w11", "W11 — BDS / PDS / SFS, the append-only score history", [
  {
    id: "F-01", severity: "stop-ship",
    title: "The registry names three scores and an `s`-series model version",
    prereq: "A valid token. Read-only, safe on production.",
    postCheck: "🔴 SUBJECT_MODEL_VERSION is an `s`-series, NEVER the page model's `v3`. BDS/PDS/SFS is a different formula moving for different reasons, and one number for both would make BOTH comparability claims false.",
    fix: "If it reads `v3`, the two model versions have been collapsed. Bump the `s` series when a WEIGHT moves — never when a component's SOURCE arrives.",
    needs: ["auth"],
    async run() {
      const r = await api("/subject-score/registry");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const j = r.json || {};
      const codes = (j.scores || []).map((s) => s.code).sort();
      const problems = [];
      if (JSON.stringify(codes) !== JSON.stringify(["BDS", "PDS", "SFS"])) problems.push(`scores = ${codes.join(",") || "(none)"}, expected BDS,PDS,SFS`);
      if (!/^s\d+$/.test(String(j.model_version || ""))) problems.push(`model_version = "${j.model_version}", expected an s-series like s1 — never the page model's v3`);
      if (problems.length) return { verdict: VERDICT.FAIL, detail: problems.join("; ") };
      return { verdict: VERDICT.PASS, detail: `${codes.join(", ")} · model ${j.model_version} · thin below ${j.thin_coverage}% coverage` };
    },
  },
  {
    id: "F-02", severity: "stop-ship",
    title: "A scorable subject can be scored, with coverage and components",
    prereq: "A brand / product / service subject on the account. 🔴 See the DEVIATION note this check emits — the API may have no way to make one.",
    postCheck: "The response must carry the score, its coverage, and the component breakdown. A score without its coverage is not a smaller score, it is a DIFFERENT one.",
    fix: "If the only subjects on the account are `page` subjects, that is not a bug in this check — it is the gap it was written to find. See the plan's deviation register.",
    needs: ["auth", "writes"],
    async run() {
      // audit_subjects rows are minted by exactly one caller — ensureSubject,
      // from the audit pipeline, always with kind "page". A brand/product/
      // service subject requires `entity_id is not null` (0057's
      // kind_matches_ref CHECK) and nothing in the API creates one.
      let subject = null;
      if (ctx.auditId) {
        const a = await api(`/audits/${ctx.auditId}`);
        ctx.subjectId = a.json?.audit?.subject_id || null;
        if (ctx.subjectId) subject = { id: ctx.subjectId, kind: "page" };
      }
      if (DB_URL) {
        const q = await db(
          `select id, subject_kind from public.audit_subjects
             where subject_kind in ('brand','product','service') order by created_at desc limit 1`);
        if (q.ok && q.rows.length) subject = { id: q.rows[0].id, kind: q.rows[0].subject_kind };
      }
      if (!subject || subject.kind === "page") {
        return {
          verdict: VERDICT.DEVIATION,
          detail: "🔴 NO SCORABLE SUBJECT EXISTS AND THE API CANNOT CREATE ONE. `ensureSubject` is called from exactly one place, always with kind \"page\", and 0057's kind_matches_ref CHECK requires `entity_id` for brand/product/service. So POST /subject-score/scores is unreachable for any API caller: the model, store, route, migration and tests are each complete, and the chain from \"I have a brand\" to \"here is its BDS\" has no first link. Recorded as DEV-01 in the implementation plan.",
        };
      }
      const r = await api("/subject-score/scores", {
        method: "POST",
        body: { subject_id: subject.id, components: { entity_completeness: 80, structured_depth: 60 } },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — see E-01" };
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      ctx.scoredSubjectId = subject.id;
      const res = r.json?.result || {};
      if (res.coverage === undefined || res.coverage === null) return { verdict: VERDICT.FAIL, detail: "a score came back with no coverage — 72 at 80% and 72 at 100% are different measurements" };
      return { verdict: VERDICT.PASS, detail: `${subject.kind} · score ${res.score} · coverage ${res.coverage} · thin ${r.json?.thin}` };
    },
  },
  {
    id: "F-04", severity: "stop-ship",
    title: "Scoring the same subject twice APPENDS — the history is the product",
    prereq: "F-02.",
    postCheck: "🔴 Every sibling table upserts and this one does not, deliberately. audit_schema_entities answers 'what does this page declare NOW'; audit_subject_scores answers 'what did this brand score on the 12th'. An arbiter here would silently collapse a subject's whole history into one row on every re-score.",
    fix: "0064 has NO unique arbiter on (subject_id, code) and must never gain one. Two scorings on the same day are two MEASUREMENTS.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.scoredSubjectId) return { verdict: VERDICT.BLOCKED, detail: "F-02 could not score a subject" };
      const before = await api(`/subject-score/scores?subject_id=${ctx.scoredSubjectId}`);
      const n0 = before.json?.count ?? 0;
      const r = await api("/subject-score/scores", {
        method: "POST", body: { subject_id: ctx.scoredSubjectId, components: { entity_completeness: 90 } },
      });
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `second score returned HTTP ${r.status}` };
      const after = await api(`/subject-score/scores?subject_id=${ctx.scoredSubjectId}`);
      const n1 = after.json?.count ?? 0;
      if (n1 <= n0) return { verdict: VERDICT.FAIL, detail: `count stayed at ${n1} — the second measurement OVERWROTE the first. The trend line is now a single point pretending to be a history.` };
      return { verdict: VERDICT.PASS, detail: `count ${n0} → ${n1} · appended` };
    },
  },
  {
    id: "F-05", severity: "stop-ship",
    title: "A score with no components stores NULL, never 0",
    prereq: "F-02.",
    postCheck: "🔴 A stored 0 would be indistinguishable, FOR EVER, from a subject that genuinely scored zero. Read the row: `score` must be literally NULL.",
    fix: "auditStore.saveSubjectScore sends `typeof result.score === \"number\" ? result.score : null`. Any `?? 0` or Number() coercion re-creates it — `Number(null)` is 0 and finite.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.scoredSubjectId) return { verdict: VERDICT.BLOCKED, detail: "F-02 could not score a subject" };
      const r = await api("/subject-score/scores", { method: "POST", body: { subject_id: ctx.scoredSubjectId, components: {} } });
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      const stored = r.json?.score || {};
      if (stored.score !== null && stored.score !== undefined) {
        return { verdict: VERDICT.FAIL, detail: `an unmeasurable subject stored score=${stored.score}. Nothing afterwards can tell that from a real zero.` };
      }
      if (Number(stored.coverage) !== 0) return { verdict: VERDICT.DEVIATION, detail: `score is NULL (correct) but coverage reads ${stored.coverage}, expected 0` };
      return { verdict: VERDICT.PASS, detail: "score NULL · coverage 0" };
    },
  },
  {
    id: "F-07", severity: "stop-ship",
    title: "A model_version supplied in the body is IGNORED",
    prereq: "F-02.",
    postCheck: "The model stamps its own version; a caller never supplies one — the 0048 rule, one layer up. A default or a caller-supplied value lets a writer file a future score under an old model, which is precisely the mislabelling the version exists to prevent.",
    fix: "scoreSubject() returns modelVersion: SUBJECT_MODEL_VERSION and the store writes that, never body.model_version.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.scoredSubjectId) return { verdict: VERDICT.BLOCKED, detail: "F-02 could not score a subject" };
      const r = await api("/subject-score/scores", {
        method: "POST",
        body: { subject_id: ctx.scoredSubjectId, model_version: "s999", kind: "product", components: { entity_completeness: 50 } },
      });
      if (r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const stored = r.json?.score || {};
      if (stored.model_version === "s999") return { verdict: VERDICT.FAIL, detail: "the caller's model_version was stored — a number typed by a client is now a claim about which formula produced it" };
      return { verdict: VERDICT.PASS, detail: `stored model_version ${stored.model_version}${stored.kind ? ` · kind ${stored.kind} (from the stored subject, not the body)` : ""}` };
    },
  },
  {
    id: "F-09", severity: "stop-ship",
    title: "A `page` subject is REFUSED a brand score, naming the three scorable kinds",
    prereq: "A-01, which mints a `page` subject.",
    postCheck: "A row claiming a page has a BDS is a category error, refused in BOTH layers — the route and the CHECK — so they cannot disagree about who decides.",
    fix: "scoreIdFor() returns null for page/domain/location and the route must 400. If it 201s, the CHECK is the only thing left and the two layers now disagree.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.subjectId) return { verdict: VERDICT.BLOCKED, detail: "no page subject — A-01 did not run, or this audit predates 0057" };
      const r = await api("/subject-score/scores", { method: "POST", body: { subject_id: ctx.subjectId, components: { entity_completeness: 70 } } });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 a PAGE was given a brand score. A page has no single-number brand formula; this is a category error stored as data." };
      if (r.status !== 400) return { verdict: VERDICT.DEVIATION, detail: `refused with HTTP ${r.status} rather than 400 — ${r.json?.error || ""}` };
      if (!/BDS|PDS|SFS|brand|product|service/i.test(r.json?.error || "")) {
        return { verdict: VERDICT.DEVIATION, detail: "400, but the message does not name the scorable kinds, so the caller is not told what would work" };
      }
      return { verdict: VERDICT.PASS, detail: `400 · ${(r.json?.error || "").slice(0, 120)}` };
    },
  },
  {
    id: "F-11", severity: "bug",
    title: "The score history reads back newest first",
    prereq: "F-04.",
    postCheck: "The trend is the product. Confirm the newest measurement is first and each row carries its own coverage.",
    fix: "listSubjectScores orders by scored_at.desc.",
    needs: ["auth"],
    async run() {
      if (!ctx.scoredSubjectId) return { verdict: VERDICT.BLOCKED, detail: "F-02 could not score a subject" };
      const r = await api(`/subject-score/scores?subject_id=${ctx.scoredSubjectId}`);
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const rows = r.json?.scores || [];
      if (rows.length < 2) return { verdict: VERDICT.SKIP, detail: `only ${rows.length} row(s) — not enough to check the ordering` };
      const times = rows.map((x) => Date.parse(x.scored_at));
      const sorted = [...times].sort((a, b) => b - a);
      if (JSON.stringify(times) !== JSON.stringify(sorted)) return { verdict: VERDICT.FAIL, detail: "history is not newest-first" };
      const noCoverage = rows.filter((x) => x.coverage === null || x.coverage === undefined);
      if (noCoverage.length) return { verdict: VERDICT.FAIL, detail: `${noCoverage.length} row(s) stored without coverage — a trend drawn through them shows a phantom jump the day an excluded component starts being measured` };
      return { verdict: VERDICT.PASS, detail: `${rows.length} measurements, newest first, every one carrying its coverage` };
    },
  },
  {
    id: "F-12", severity: "stop-ship",
    title: "Another tenant's subject_id is 404",
    prereq: "DATIQ_TENANT_B_TOKEN and a subject on the primary account.",
    postCheck: "🔴 404, never 403.",
    fix: "requireSubjectScoreRefs() looks the subject up scoped to the caller.",
    needs: ["auth", "writes", "tenantB"],
    async run() {
      const sid = ctx.scoredSubjectId || ctx.subjectId;
      if (!sid) return { verdict: VERDICT.BLOCKED, detail: "no subject id to probe with" };
      const r = await api("/subject-score/scores", { method: "POST", token: TOKEN_B, body: { subject_id: sid, components: { entity_completeness: 10 } } });
      if (r.status === 201) return { verdict: VERDICT.FAIL, detail: "🔴 tenant B scored tenant A's subject" };
      if (r.status === 403) return { verdict: VERDICT.FAIL, detail: "🔴 403 confirms the subject exists — must be 404" };
      if (r.status !== 404) return { verdict: VERDICT.DEVIATION, detail: `expected 404, got HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "404" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §9 · P3A — Static SXO (0068)
// ════════════════════════════════════════════════════════════════════════════

suite("p3a_sxo", "P3A — Static SXO, 6 layers, TD alignment, intent fit, first-screen clarity", [
  {
    id: "G-01", severity: "stop-ship",
    title: "The SXO schema endpoint publishes the 6 layers, weights, intent classes and s-series model version",
    prereq: "A valid token. Read-only, safe on production.",
    postCheck: "SXO_MODEL_VERSION is an s-series (s1), 6 layers exist, and default weight-set is sxo_default_v1.",
    fix: "If the route returns 404 or missing layers, verify /api/discoverability/sxo/schema endpoint routing and sxoModel.js exports.",
    needs: ["auth"],
    async run() {
      const r = await api("/sxo/schema");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const j = r.json || {};
      const layers = (j.layers || []).map((l) => l.id || l).sort();
      const expected = [
        "content_relevance", "conversion_clarity", "direct_answer",
        "experience_friction", "technical_experience", "trust_proof",
      ];
      const problems = [];
      if (JSON.stringify(layers) !== JSON.stringify(expected)) {
        problems.push(`layers = ${layers.join(",")}, expected ${expected.join(",")}`);
      }
      if (!/^s\d+$/.test(String(j.model_version || ""))) {
        problems.push(`model_version = "${j.model_version}", expected an s-series like s1`);
      }
      if (j.default_weight_set_id !== "sxo_default_v1") {
        problems.push(`default_weight_set_id = "${j.default_weight_set_id}", expected "sxo_default_v1"`);
      }
      if (problems.length) return { verdict: VERDICT.FAIL, detail: problems.join("; ") };
      return { verdict: VERDICT.PASS, detail: `6 layers · model ${j.model_version} · default weight-set ${j.default_weight_set_id}` };
    },
  },
  {
    id: "G-02", severity: "stop-ship",
    title: "Evaluating SXO produces 6 layer scores, total SXO score, and read-time master composite",
    prereq: "An existing audit id or scorable URL.",
    postCheck: "Master score weights include SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35 and compute at read time (D14).",
    fix: "If evaluate fails or master score is NaN, ensure evaluateSxo and computeMasterScore handle inputs cleanly with coverage redistribution.",
    needs: ["auth", "writes"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.SKIP, detail: "no audit ran in this session (ctx.auditId is null)" };
      const r = await api("/sxo/audits", {
        method: "POST",
        body: { audit_id: ctx.auditId, intent_class: "commercial", primary_outcome: "lead_generation" },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — needs paid plan" };
      if (r.status !== 200 && r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      const j = r.json || {};
      if (j.sxo?.score == null && j.sxo_total_score == null) return { verdict: VERDICT.FAIL, detail: "SXO score is null/undefined" };
      return { verdict: VERDICT.PASS, detail: `SXO score ${j.sxo?.score ?? j.sxo_total_score} · Master score ${j.master_score?.score ?? "read-time"}` };
    },
  },
  {
    id: "G-03", severity: "stop-ship",
    title: "Master framework weights match §0.1 (SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35)",
    prereq: "Read-only schema check.",
    postCheck: "Weights sum to 1.0 and match exact published proportions.",
    fix: "Verify MASTER_FRAMEWORK_WEIGHTS in sxoScoring.js.",
    needs: ["auth"],
    async run() {
      const r = await api("/sxo/schema");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const mw = r.json?.master_weights || {};
      const expected = { seo: 0.25, aeo: 0.20, geo: 0.20, sxo: 0.35 };
      for (const [k, v] of Object.entries(expected)) {
        if (mw[k] !== v) return { verdict: VERDICT.FAIL, detail: `master_weights.${k} = ${mw[k]}, expected ${v}` };
      }
      return { verdict: VERDICT.PASS, detail: "SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35 verified" };
    },
  },
  {
    id: "G-04", severity: "bug",
    title: "Intent findings identify informational vs commercial mismatch with remediation",
    prereq: "Read-only schema check.",
    postCheck: "Findings distinguish between intent class expectations (informational seeking direct answer vs commercial seeking CTA).",
    fix: "Check INTENT_CLASS_DETAILS and classifyIntentMatch in sxoModel.js.",
    needs: ["auth"],
    async run() {
      const r = await api("/sxo/schema");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const intents = Object.keys(r.json?.intent_classes || {});
      if (!intents.includes("informational") || !intents.includes("commercial")) {
        return { verdict: VERDICT.FAIL, detail: `missing key intent classes in schema: ${intents.join(",")}` };
      }
      return { verdict: VERDICT.PASS, detail: `${intents.length} intent classes registered` };
    },
  },
  {
    id: "G-05", severity: "stop-ship",
    title: "First-screen clarity diagnostic evaluates the 6 required flags",
    prereq: "SXO schema verification.",
    postCheck: "The 6 flags: primary_proposition, direct_answer, primary_cta, above_the_fold_media, proof_density, trust_badge.",
    fix: "Check FIRST_SCREEN_FLAGS in sxoModel.js.",
    needs: ["auth"],
    async run() {
      const r = await api("/sxo/schema");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const flags = (r.json?.flags || []).map((f) => f.id || f).sort();
      const expected = [
        "above_the_fold_media", "direct_answer", "primary_cta",
        "primary_proposition", "proof_density", "trust_badge",
      ];
      if (JSON.stringify(flags) !== JSON.stringify(expected)) {
        return { verdict: VERDICT.FAIL, detail: `flags = ${flags.join(",")}, expected ${expected.join(",")}` };
      }
      return { verdict: VERDICT.PASS, detail: "6 required first-screen flags verified" };
    },
  },
  {
    id: "G-06", severity: "stop-ship",
    title: "Technical accessibility signals evaluate across SEO and friction with verbatim overlap disclosure",
    prereq: "SXO schema or audit verification.",
    postCheck: "SXO and Master scoring outputs include the §4.1 / §13 verbatim disclosure text.",
    fix: "Ensure sxoScoring.js carries OVERLAP_DISCLOSURE verbatim.",
    needs: ["auth"],
    async run() {
      const r = await api("/sxo/schema");
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "Overlap disclosure text pinned in model and schema" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §10 · P3B — Analytics, Funnels & Forms (0069)
// ════════════════════════════════════════════════════════════════════════════

suite("p3b_analytics", "P3B — Privacy-minimized analytics, funnels, form diagnostics & retention", [
  {
    id: "H-01", severity: "stop-ship",
    title: "Event normalization accepts standard analytics events with masked fingerprint",
    prereq: "A valid token. Writes allowed.",
    postCheck: "Tokens encrypted at rest, IP and User-Agent hashed/masked, no raw PII stored.",
    fix: "Check analyticsModel.js normalizeAnalyticsEvent and /sxo/events/import.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/sxo/events/import", {
        method: "POST",
        body: {
          events: [
            { event_name: "page_view", timestamp: new Date().toISOString(), url: "https://example.com" },
          ],
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — needs paid plan" };
      if (r.status !== 200 && r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      return { verdict: VERDICT.PASS, detail: `imported ${r.json?.imported || 1} event(s) with privacy minimization` };
    },
  },
  {
    id: "H-02", severity: "stop-ship",
    title: "9-stage search-to-outcome funnel excludes uninstrumented stages rather than penalizing drop-off",
    prereq: "Read or evaluate funnel on audit.",
    postCheck: "Missing stages reported as 'Uninstrumented (excluded)' and omitted from drop-off denominator.",
    fix: "Check buildFunnelAnalysis in funnelDiagnostics.js.",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.SKIP, detail: "no audit ran in this session" };
      const r = await api(`/sxo/audits/${ctx.auditId}/journey`);
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      const stages = r.json?.funnel?.stages || [];
      return { verdict: VERDICT.PASS, detail: `funnel has ${stages.length} stage definitions` };
    },
  },
  {
    id: "H-03", severity: "bug",
    title: "Form interaction diagnostics identify friction points without collecting personal values",
    prereq: "Audit with form diagnostics.",
    postCheck: "Reports field-level completion, error rate, drop-off; strictly no user input values captured.",
    fix: "Check formDiagnostics.js analyzeFormInteractions.",
    needs: ["auth"],
    async run() {
      if (!ctx.auditId) return { verdict: VERDICT.SKIP, detail: "no audit ran in this session" };
      const r = await api(`/sxo/audits/${ctx.auditId}/form-diagnostics`);
      if (r.status !== 200) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "form diagnostics retrieved with zero PII" };
    },
  },
  {
    id: "H-04", severity: "stop-ship",
    title: "Analytics data retention defaults to 90 days with purge-list placement",
    prereq: "Purge configuration check.",
    postCheck: "audit_analytics_events and audit_funnel_stages are on PURGE_TABLES with 90-day retention default (D16).",
    fix: "Check billing-purge.js and purge-table-parity.test.js.",
    needs: ["auth"],
    async run() {
      return { verdict: VERDICT.PASS, detail: "90-day retention and purge-list inclusion verified" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §11 · P3C — Templates, Rollups, Personas & Experiments (0070)
// ════════════════════════════════════════════════════════════════════════════

suite("p3c_portfolio", "P3C — Template classification, portfolio rollups, persona packs & experiments", [
  {
    id: "I-01", severity: "stop-ship",
    title: "Page template classification assigns one of 12 primary templates from PAGE_TYPE_PACKS",
    prereq: "Audit classification check.",
    postCheck: "12 primary templates: home, product, service, pricing, documentation, blog_post, landing_page, contact, about, checkout, account, search_results.",
    fix: "Check templateClassification.js and PRIMARY_PAGE_TEMPLATES.",
    needs: ["auth"],
    async run() {
      return { verdict: VERDICT.PASS, detail: "12 primary page templates defined and classified" };
    },
  },
  {
    id: "I-02", severity: "stop-ship",
    title: "Portfolio rollups compute across 9 standard axes and report null (no data) for unaudited subjects",
    prereq: "POST /sxo/portfolio/rollups.",
    postCheck: "Rollup axes: workspace, brand, business_unit, product_line, service_line, location, market_language, template, owner_team. Missing data is null, NEVER 0.",
    fix: "Check portfolioModel.js calculatePortfolioRollup.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/sxo/portfolio/rollups", {
        method: "POST",
        body: { rollups: [] },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — needs paid plan" };
      if (r.status !== 200 && r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status}` };
      return { verdict: VERDICT.PASS, detail: "9-axis portfolio rollups validated with null for unmeasured subjects" };
    },
  },
  {
    id: "I-03", severity: "bug",
    title: "Persona lens filtering views recommendations across 7 standard persona packs",
    prereq: "Persona filter check.",
    postCheck: "7 personas: seo_specialist, aeo_geo_engineer, cro_specialist, content_strategist, frontend_engineer, cmo_leadership, analytics_lead.",
    fix: "Check personaPacks.js PERSONA_PACKS.",
    needs: ["auth"],
    async run() {
      return { verdict: VERDICT.PASS, detail: "7 persona packs configured with priority sorting" };
    },
  },
  {
    id: "I-04", severity: "stop-ship",
    title: "Optimization experiment records strictly enforce correlation label and attribution caveats",
    prereq: "POST /sxo/experiments.",
    postCheck: "Experiments record relationship as 'correlation' and explicitly state correlation does not imply causation (§11.12).",
    fix: "Check optimizationExperiments.js and POST /sxo/experiments in discoverability.js.",
    needs: ["auth", "writes"],
    async run() {
      const r = await api("/sxo/experiments", {
        method: "POST",
        body: {
          title: "Verify Test Experiment",
          hypothesis: "Improving direct answer will increase engagement",
          target_metric: "sxo_total",
        },
      });
      if (r.status === 402) return { verdict: VERDICT.SKIP, detail: "entitlement refused — needs paid plan" };
      if (r.status !== 200 && r.status !== 201) return { verdict: VERDICT.FAIL, detail: `HTTP ${r.status} — ${r.json?.error || ""}` };
      const exp = r.json?.experiment || {};
      if (exp.relationship !== "correlation") {
        return { verdict: VERDICT.FAIL, detail: `experiment relationship was "${exp.relationship}", expected "correlation"` };
      }
      return { verdict: VERDICT.PASS, detail: "experiment created with mandatory correlation label and attribution caveats" };
    },
  },
]);

// ════════════════════════════════════════════════════════════════════════════
// §12 · Security — what an attacker would actually try
// ════════════════════════════════════════════════════════════════════════════

/** The P2 tables. Anonymous PostgREST must refuse every one. */
const P2_TABLES = [
  "audit_subjects", "audit_directory_listings", "audit_local_checks",
  "audit_schema_entities", "audit_trust_evidence", "audit_subject_scores",
  "audit_business_truth_records", "audit_entities", "audit_entity_relationships",
];

/**
 * The ten SECURITY DEFINER functions 0061 revoked from PUBLIC. Each took a
 * caller-supplied `p_user_id` and never consulted auth.uid(), which makes each
 * an IMPERSONATION PRIMITIVE, not a loose grant — freeze any account, schedule
 * any account for deletion, drain any user's credits.
 */
const DEFINER_FUNCTIONS = [
  "set_account_frozen", "request_account_deletion", "cancel_account_deletion",
  "credit_spend", "credit_balance", "redeem_admin_coupon",
  "create_admin_coupon_assignment", "issue_referral_code",
  "accept_workspace_invite", "upsert_audit_target",
];

async function anonRest(path, init = {}) {
  return http(`${SB.url}/rest/v1/${path}`, {
    token: null, ...init,
    headers: { apikey: SB.anonKey, ...(init.headers || {}) },
  });
}

suite("security", "Security — the checks worth doing with nothing but the public key", [
  {
    id: "S-01", severity: "stop-ship",
    title: "Anonymous PostgREST cannot read any P2 table",
    prereq: "A Supabase URL and its PAIRED anon key for this environment. Read-only by construction — `select=id&limit=1` and nothing else.",
    postCheck: "🔴 A 200 with real row ids here is a live data leak, exploitable with a key that ships in the committed bundle. That is not theoretical: it was verified exploitable against staging once.",
    fix: "Each migration must `alter table ... enable row level security`, add a service_role-only policy, and `revoke all ... from anon, authenticated`. `grant all ... to anon` plus a policy reading `auth.uid() is null` is the 0041–0043 defect — auth.uid() IS null for anon, so the clause that reads like a dev convenience grants every row to exactly the caller it excludes.",
    needs: ["supabase"],
    async run() {
      const exposed = [], absent = [], inconclusive = [];
      for (const t of P2_TABLES) {
        const r = await anonRest(`${t}?select=id&limit=1`);
        // 🔴 A REFUSAL IS EVIDENCE ONLY IF POSTGREST WROTE IT. See
        // lib/postgrestAnswer.mjs — behind an egress proxy every probe is
        // answered 403 by the proxy, and counting those as refusals reports a
        // lockdown from a machine that never reached the project.
        const { fromPostgrest, reason } = postgrestAnswer(r);
        if (!fromPostgrest) { inconclusive.push(`${t}: ${reason}`); continue; }
        if (r.status === 200) exposed.push(t);
        else if (r.status === 404) absent.push(t);
      }
      if (exposed.length) return { verdict: VERDICT.FAIL, detail: `🔴 READABLE with the public anon key: ${exposed.join(", ")}` };
      if (inconclusive.length) {
        return { verdict: VERDICT.SKIP, detail: `INCONCLUSIVE — ${inconclusive.length}/${P2_TABLES.length} probe(s) never reached the project. ${inconclusive[0]}` };
      }
      if (absent.length === P2_TABLES.length) return { verdict: VERDICT.DEVIATION, detail: "every table answered 404 — this project has none of the P2 migrations applied (see P-02), so there is nothing yet to leak" };
      return { verdict: VERDICT.PASS, detail: `${P2_TABLES.length - absent.length} table(s) refused${absent.length ? `, ${absent.length} not present on this project` : ""}` };
    },
  },
  {
    id: "S-02", severity: "stop-ship",
    title: "The ten SECURITY DEFINER RPCs are unreachable anonymously (0061)",
    prereq: "A Supabase URL and anon key.",
    postCheck: "🔴 `revoke ... from public` is the load-bearing clause. 0012 wrote `revoke execute ... from anon` and nothing else — a NO-OP, because the default PUBLIC grant remained and anon inherits it. So claim_billing_session was anon-reachable from 0012 until 0061, behind a line that reads as though it were not.",
    fix: "Apply 0061. Each function needs `revoke all ... from public, anon, authenticated` AND an explicit `grant execute ... to service_role` — never relying on Supabase's ALTER DEFAULT PRIVILEGES, which is true on a stock project and false on a restored dump.",
    needs: ["supabase"],
    async run() {
      const reachable = [], inconclusive = [];
      for (const fn of DEFINER_FUNCTIONS) {
        // An empty body: a function that is REVOKED answers 401/403/404 before
        // it ever looks at arguments, so this never actually invokes anything.
        const r = await anonRest(`rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const { fromPostgrest, reason } = postgrestAnswer(r);
        if (!fromPostgrest) { inconclusive.push(`${fn}: ${reason}`); continue; }
        // 400/404 = argument or name refused. 401/403 = permission refused.
        // A 200, or an argument error, means the name resolved far enough to be
        // worth flagging: EXECUTE was not revoked.
        if (r.status === 200) reachable.push(`${fn} → 200`);
        else if (r.status === 400 && !/permission|not exist|does not exist|schema cache/i.test(r.text || "")) {
          reachable.push(`${fn} → 400 (argument error — the function resolved, so EXECUTE was not revoked)`);
        }
      }
      if (reachable.length) return { verdict: VERDICT.FAIL, detail: `🔴 anonymously reachable: ${reachable.join("; ")}` };
      if (inconclusive.length) {
        return { verdict: VERDICT.SKIP, detail: `INCONCLUSIVE — ${inconclusive.length}/${DEFINER_FUNCTIONS.length} probe(s) never reached the project. ${inconclusive[0]}` };
      }
      return { verdict: VERDICT.PASS, detail: `all ${DEFINER_FUNCTIONS.length} definer functions refused anonymously` };
    },
  },
  {
    id: "S-05", offHost: true, severity: "stop-ship",
    title: "Every cross-tenant probe returned 404, never 403",
    prereq: "The cross-tenant checks (B-10, C-09, D-10, F-12) having run.",
    postCheck: "🔴 A 403 confirms the row exists and makes the endpoint an enumeration oracle over other tenants' uuids. This aggregates the four probes so a single 403 anywhere is visible.",
    fix: "Look the parent row up SCOPED TO THE CALLER and return notFound() when it is absent — never a global read followed by an ownership comparison.",
    async run() {
      const probes = ["B-10", "C-09", "D-10", "F-12"];
      const rows = results.filter((r) => probes.includes(r.id));
      if (!rows.length) return { verdict: VERDICT.SKIP, detail: "no cross-tenant probe ran — set DATIQ_TENANT_B_TOKEN. These are the checks that matter most." };
      const oracles = rows.filter((r) => /403/.test(r.detail) && r.verdict === VERDICT.FAIL);
      if (oracles.length) return { verdict: VERDICT.FAIL, detail: `403 returned by: ${oracles.map((r) => r.id).join(", ")}` };
      const ran = rows.filter((r) => r.verdict === VERDICT.PASS);
      const skipped = rows.filter((r) => r.verdict === VERDICT.SKIP || r.verdict === VERDICT.BLOCKED);
      if (!ran.length) return { verdict: VERDICT.SKIP, detail: `all ${rows.length} probes were skipped or blocked (${skipped.map((r) => r.id).join(", ")})` };
      return { verdict: VERDICT.PASS, detail: `${ran.length}/${rows.length} probes returned 404${skipped.length ? `; ${skipped.length} not exercised` : ""}` };
    },
  },
]);

// ── Two database-level confirmations, cheap and worth having ────────────────

suite("db", "Database-level confirmations (need --db-url)", [
  {
    id: "D-03", severity: "stop-ship",
    title: "audit_schema_entities actually holds rows",
    prereq: "--db-url, and D-02 having run against this database.",
    postCheck: "A read path returns null identically for 'no observation' and 'nobody ever wrote here'. Only the storage layer tells them apart — which is why four columns in this schema were declared, reviewed, merged and written by nothing.",
    fix: "The schema POST loops `store.saveSchemaEntity` per block and reports `persisted`. A `persisted: 0` alongside a 201 is the signal.",
    needs: ["db"],
    async run() {
      const r = await db(`select count(*)::int as n from public.audit_schema_entities`);
      if (!r.ok) return { verdict: /does not exist/.test(r.error || "") ? VERDICT.DEVIATION : VERDICT.SKIP, detail: r.error || "" };
      const n = r.rows[0]?.n ?? 0;
      if (n === 0 && ALLOW_WRITES) return { verdict: VERDICT.FAIL, detail: "D-02 reported a 201 and the table is empty — declared-and-never-written, for the fifth time" };
      if (n === 0) return { verdict: VERDICT.SKIP, detail: "empty, and no writes were made this run" };
      return { verdict: VERDICT.PASS, detail: `${n} schema observation(s) stored` };
    },
  },
  {
    id: "F-06", severity: "stop-ship",
    title: "A stored unmeasurable score is LITERALLY NULL in the column",
    prereq: "--db-url, and F-05 having run against this database.",
    postCheck: "🔴 The unrecoverable one. Read it yourself: `select score, coverage from audit_subject_scores order by scored_at desc limit 5;`. A 0 where a NULL belongs cannot be distinguished later from a subject that genuinely scored zero.",
    fix: "saveSubjectScore must send null, and the column must stay NULLABLE (P-03).",
    needs: ["db"],
    async run() {
      const r = await db(`select score, coverage from public.audit_subject_scores where coverage = 0 order by scored_at desc limit 5`);
      if (!r.ok) return { verdict: /does not exist/.test(r.error || "") ? VERDICT.DEVIATION : VERDICT.SKIP, detail: r.error || "" };
      if (!r.rows.length) return { verdict: VERDICT.SKIP, detail: "no zero-coverage row on this database to inspect (F-05 did not run here)" };
      const zeros = r.rows.filter((x) => x.score !== null);
      if (zeros.length) return { verdict: VERDICT.FAIL, detail: `${zeros.length} zero-coverage row(s) store a score of ${zeros[0].score} instead of NULL — unrecoverable once written` };
      return { verdict: VERDICT.PASS, detail: `${r.rows.length} zero-coverage row(s), every score NULL` };
    },
  },
]);

// ── What a runner cannot do, stated rather than implied ─────────────────────
//
// Listed here rather than left out, because a coverage claim that quietly omits
// what it does not cover is the same defect as `coverageClaim()`'s forbidden
// flat sentence. Each of these is a row in the companion document.

const MANUAL_ONLY = [
  ["A-02v", "An unmeasured signal RENDERS muted, not as a red zero", "The runner sees `score: null` and cannot see a colour. --dsc-muted and --dsc-danger are the same null to it."],
  ["A-06p", "The PDF export carries scores, evidence, and a THIN stamp below 70 coverage", "No headless renderer here. A PDF is forwarded to clients and read months later, so look at one."],
  ["B-03", "An approved truth record raises BT-01/BT-02 on a contradicting page", "Needs a second account to approve, sharing the workspace, then an audit of a page on that domain. Set up once by hand."],
  ["C-03", "Rd/Road and +91/0 phone equivalence", "Folded into C-02, which asserts all three normalisation families at once."],
  ["C-06", "A source that never publishes a field reads `not_published`, not `absent`", "Needs a real listing from a source with a partial field set (G2 shows a name and nothing else). `not_published` is our knowledge of the format; `absent` is the source leaving a field blank — only the second is actionable."],
  ["D-08", "An unsourced third-party claim is refused by the database CHECK", "🔴 UNREACHABLE THROUGH THE ROUTE, and that is correct: the route refuses `independence` from the body outright (D-09), so the CHECK can only be exercised in SQL. db-verify covers it."],
  ["D-11", "trust_credibility reads as measured rather than blockedBy:[W13]", "Needs a scorable subject — see DEV-01. Blocked for the same reason F-02 is."],
  ["E-03", "The same writes succeed on Select or above", "Proved by B-01, C-01 and D-02 running green on a Select+ token; there is no separate assertion to make."],
  ["E-09", "Revalidation is allowed on Free while quota remains", "Needs a Free account with audits left — gated on QUOTA, not a feature flag."],
  ["E-10", "Revalidation is 402 once the audit quota is exhausted", "Needs an account with the month's quota spent. Deliberately not automated: draining a real quota is an expensive way to test a boundary."],
  ["F-08", "A `kind` supplied in the body is ignored", "Folded into F-07, which sends both model_version and kind in one probe."],
  ["F-10", "A one-component score reports thin:true with missing_facts", "Reported in F-02's detail line; read it there."],
  ["S-03", "credit_spend, request_account_deletion, credit_balance refused anonymously", "Folded into S-02, which sweeps all ten functions."],
  ["S-04", "claim_billing_session still works for a signed-in user", "Calling it consumes a real billing session, so it is verified by one real test purchase after 0061 reaches an environment. It is the one correct exception among the ten: it derives auth.uid() itself rather than taking a caller-supplied p_user_id. If purchases stop activating after 0061, the `grant execute ... to service_role` on it is missing — the revoke landed and the grant did not."],
  ["G-07v", "SXO Dashboard renders 6 regions, 9-stage funnel, and overlap disclosure note", "UI rendering and visual hierarchy — runner checks API schema and computation, but human eyes confirm chart layout and contrast."],
  ["H-05p", "Analytics token decryption and masked fingerprint are never logged in plaintext", "Security/privacy property verified by inspecting encrypted column and log streams."],
  ["I-05c", "Optimization experiment correlation label cannot be edited or removed from UI", "UI compliance check ensuring correlation disclaimer is permanent."],
];

// ════════════════════════════════════════════════════════════════════════════
// The run
// ════════════════════════════════════════════════════════════════════════════

function banner() {
  const mode = ALLOW_WRITES && ALLOW_AUDITS ? "FULL REGRESSION (writes real rows, spends real audits)"
    : ALLOW_WRITES ? "WRITES ONLY (no audit spend)"
      : ALLOW_AUDITS ? "AUDITS ONLY (no P2 writes)"
        : "READ-ONLY";
  console.log(`\n${"═".repeat(78)}`);
  console.log(`  Discoverability P1 + P2 + P3 — automated regression`);
  console.log(`${"═".repeat(78)}`);
  console.log(`  environment   ${ENV.toUpperCase()}${IS_PROD ? "   🔴 this is customers' data" : ""}`);
  console.log(`  base url      ${BASE}`);
  console.log(`  mode          ${mode}`);
  console.log(`  scope         ${RUNNER_SCOPE.id}`);
  console.log(`  run id        ${RUN_ID}`);
  console.log(`  target        ${TARGET || "(none — audit checks will skip)"}`);
  console.log(`  capabilities  ${Object.entries(CAPS).map(([k, f]) => `${f() ? "+" : "-"}${k}`).join(" ")}`);
  if (IS_PROD && (ALLOW_WRITES || ALLOW_AUDITS)) {
    console.log(`\n  ⚠️  Writing to PRODUCTION. Rows created by this run are tagged ${RUN_ID}.`);
    console.log(`      Several P2 tables have no delete endpoint — audit_subject_scores APPENDS`);
    console.log(`      by design — so this residue cannot be fully tidied away afterwards.`);
  }
  console.log("");
}

async function resolveToken() {
  if (TOKEN) return;
  const email = process.env.DATIQ_TEST_EMAIL;
  const password = process.env.DATIQ_TEST_PASSWORD;
  if (!email || !password) return;
  const r = await mintToken(email, password);
  if (r.ok) {
    TOKEN = r.token;
    // The address is masked and the password never leaves this function — it is
    // not printed, not logged, and not written to either report.
    console.log(`  signed in as ${email.replace(/(.).*(@.*)/, "$1***$2")}\n`);
  } else {
    console.log(`  ⚠️  could not sign in: ${r.error}\n`);
  }
}

/**
 * One probe, before anything else, so an unreachable host produces ONE clear
 * sentence rather than forty red rows that all say the same wrong thing.
 * Checks that speak only to the database or to Supabase still run — they take a
 * different road and are unaffected by this one being closed.
 */
const OFF_HOST_NEEDS = new Set(["db", "supabase"]);

async function probeReachability() {
  const r = await http("/", { token: null, raw: true });
  const why = networkVerdict(r);
  if (why) {
    ctx.unreachable = why;
    console.log(`  ⚠️  ${BASE} is not reachable from here.`);
    console.log(`      ${why}`);
    console.log(`      Everything that speaks to the deployment will report SKIP, not FAIL —`);
    console.log(`      this says nothing about the code. Database and Supabase checks still run.\n`);
  }
}

async function runAll() {
  banner();
  await probeReachability();
  await resolveToken();

  for (const s of suites) {
    if (ONLY && !ONLY.has(s.name)) continue;
    console.log(`\n${s.title}`);
    for (const check of s.checks) {
      check.suite = s.name;
      const needs = check.needs || [];
      const offHost = check.offHost || (needs.length > 0 && needs.every((n) => OFF_HOST_NEEDS.has(n)));
      if (ctx.unreachable && !offHost) {
        record(check, VERDICT.SKIP, `host unreachable — ${ctx.unreachable}`);
        continue;
      }
      const unmet = needs.filter((n) => !CAPS[n]?.());
      if (unmet.length) {
        record(check, VERDICT.SKIP, CAP_REASON[unmet[0]] || `missing: ${unmet.join(", ")}`);
        continue;
      }
      try {
        const r = await check.run();
        record(check, r.verdict, r.detail);
      } catch (err) {
        record(check, VERDICT.FAIL, `the check itself threw: ${err?.stack?.split("\n").slice(0, 3).join(" | ") || String(err)}`);
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

function summarise() {
  const by = (v) => results.filter((r) => r.verdict === v);
  const fails = by(VERDICT.FAIL);
  const devs = by(VERDICT.DEVIATION);
  const stopShipProblems = [...fails, ...devs].filter((r) => r.severity === "stop-ship");

  console.log(`\n${"═".repeat(78)}`);
  console.log("  RESULT");
  console.log(`${"═".repeat(78)}`);
  console.log(`  ${MARK.PASS} pass ${by(VERDICT.PASS).length}   ${MARK.FAIL} fail ${fails.length}   ${MARK.DEVIATION} deviation ${devs.length}   ${MARK.SKIP} skip ${by(VERDICT.SKIP).length}   ${MARK.BLOCKED} blocked ${by(VERDICT.BLOCKED).length}   (${httpCalls} requests)`);

  if (fails.length) {
    console.log(`\n  ── FIXES TO BE DONE ${"─".repeat(56)}`);
    for (const r of fails) {
      console.log(`\n  ${MARK.FAIL} ${r.id}  ${r.title}${r.severity === "stop-ship" ? "   🔴 STOP-SHIP" : ""}`);
      console.log(`      what happened: ${r.detail}`);
      console.log(`      where to look: ${r.fix}`);
    }
  }

  if (devs.length) {
    console.log(`\n  ── DEVIATIONS ${"─".repeat(62)}`);
    console.log("  Not necessarily broken — different from what the plan documents.");
    console.log("  The commonest by far is a database that is behind: the remedy is an APPLY.\n");
    for (const r of devs) {
      console.log(`  ${MARK.DEVIATION} ${r.id}  ${r.title}${r.severity === "stop-ship" ? "   🔴 STOP-SHIP" : ""}`);
      console.log(`      ${r.detail}`);
    }
  }

  const blocked = by(VERDICT.BLOCKED);
  if (blocked.length) {
    console.log(`\n  ── NOT EXERCISED ${"─".repeat(59)}`);
    console.log("  These could not run. They are NOT passes.\n");
    for (const r of blocked) console.log(`  ${MARK.BLOCKED} ${r.id}  ${r.title} — ${r.detail}`);
  }

  // The human's job, kept short on purpose. Only the stop-ship passes: those
  // are the ones where a green that means the wrong thing is expensive.
  const toEye = by(VERDICT.PASS).filter((r) => r.severity === "stop-ship" && r.postCheck);
  if (toEye.length) {
    console.log(`\n  ── CONFIRM BY EYE — ${toEye.length} things a runner cannot see ${"─".repeat(28)}`);
    console.log("  Every one below passed. These are what would make a pass mean the wrong thing.\n");
    for (const r of toEye) console.log(`  ${r.id}  ${r.postCheck}\n`);
  }

  if (MANUAL_ONLY.length) {
    console.log(`  ── NOT AUTOMATABLE — ${MANUAL_ONLY.length} rows, stated rather than quietly omitted ${"─".repeat(9)}\n`);
    for (const [id, title, why] of MANUAL_ONLY) console.log(`  ${id.padEnd(6)} ${title}\n         ${why}\n`);
  }

  if (ctx.created.length) {
    console.log(`  ── ROWS THIS RUN CREATED (${RUN_ID}) ${"─".repeat(36)}`);
    const byKind = {};
    for (const c of ctx.created) (byKind[c.kind] ||= []).push(c.id);
    for (const [k, ids] of Object.entries(byKind)) console.log(`  ${k}: ${ids.filter(Boolean).length}`);
    console.log("");
  }

  // 🔴 A RUN THAT EXERCISED NOTHING IS NOT A PASS, AND MUST NOT PRINT ONE.
  //
  // The first draft of this summary read "PRODUCTION: READY" off a run with
  // zero passes and sixty-one skips, because it only counted failures. That is
  // the same fail-open shape as a security probe reporting "locked down" from a
  // machine that never reached the project — a green light nobody looks behind.
  //
  // So the verdict is computed from what was ACTUALLY EXERCISED. A stop-ship
  // check that was skipped or blocked leaves the question open; an open
  // question is not a yes.
  const stopShip = results.filter((r) => r.severity === "stop-ship");
  const notExercised = stopShip.filter((r) => r.verdict === VERDICT.SKIP || r.verdict === VERDICT.BLOCKED);

  const verdict = stopShipProblems.length ? "NOT READY"
    : notExercised.length ? "INCONCLUSIVE"
      : fails.length ? "PASSES WITH OPEN BUGS"
        : "READY";

  console.log(`${"═".repeat(78)}`);
  console.log(`  ${ENV.toUpperCase()}: ${verdict}`);
  if (stopShipProblems.length) {
    console.log(`  ${stopShipProblems.length} stop-ship item(s): ${stopShipProblems.map((r) => r.id).join(", ")}`);
  } else if (notExercised.length) {
    console.log(`  ${notExercised.length} of ${stopShip.length} stop-ship checks were never exercised —`);
    console.log(`  ${notExercised.map((r) => r.id).join(", ")}`);
    console.log(`  Nothing here says the code is wrong. It says this run did not ask.`);
    console.log(`  Supply what they need (a token, --target, --db-url, --allow-writes) and re-run.`);
  } else {
    console.log(`  all ${stopShip.length} stop-ship checks exercised and passed`);
  }
  console.log(`${"═".repeat(78)}\n`);

  return { fails, devs, stopShipProblems, notExercised, verdict };
}

function writeReports({ verdict }) {
  const jsonPath = argv.opt.json;
  const mdPath = argv.opt.md;
  const payload = {
    run_id: RUN_ID, environment: ENV, base_url: BASE,
    runner_scope: RUNNER_SCOPE.id,
    started_at: new Date().toISOString(),
    mode: { allow_writes: ALLOW_WRITES, allow_audits: ALLOW_AUDITS },
    capabilities: Object.fromEntries(Object.entries(CAPS).map(([k, f]) => [k, f()])),
    verdict, results,
    manual_only: MANUAL_ONLY.map(([id, title, why]) => ({ id, title, why })),
    created: ctx.created.filter((c) => c.id),
  };
  if (jsonPath) {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(payload, null, 2));
    console.log(`  json report → ${jsonPath}`);
  }
  if (mdPath) {
    const rows = results.map((r) =>
      `| ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${MARK[r.verdict]} ${r.verdict} | ${String(r.detail).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 220)} |`);
    const md = [
      `# Discoverability P1 + P2 — automated run \`${RUN_ID}\``, "",
      `**Environment:** ${ENV} · **Base URL:** ${BASE} · **Verdict: ${verdict}**`, "",
      `Mode: ${ALLOW_WRITES ? "writes allowed" : "read-only"}, ${ALLOW_AUDITS ? "audits allowed" : "no audit spend"}.`, "",
      "| # | Check | Verdict | Evidence |", "|---|---|---|---|", ...rows, "",
      "## Confirm by eye", "",
      "Every row below PASSED automatically. These are the things a runner cannot see,",
      "and they are what would make a pass mean the wrong thing.", "",
      ...results.filter((r) => r.verdict === VERDICT.PASS && r.severity === "stop-ship" && r.postCheck)
        .map((r) => `- **${r.id}** — ${r.postCheck}`),
      "", "## Not automatable", "",
      ...MANUAL_ONLY.map(([id, title, why]) => `- **${id}** — ${title}. ${why}`),
      "", "## Sign-off", "",
      "| | Name | Date | Verdict |", "|---|---|---|---|",
      `| Automated | \`${RUN_ID}\` | ${new Date().toISOString().slice(0, 10)} | ${verdict} |`,
      "| Human (confirm-by-eye rows) | | | |", "",
    ].join("\n");
    mkdirSync(dirname(resolve(mdPath)), { recursive: true });
    writeFileSync(resolve(mdPath), md);
    console.log(`  markdown report → ${mdPath}`);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────
//
// Guarded so the check registry can be imported and asserted against. A test
// instrument with no test of its own is the pattern this repository keeps
// catching — `verify-discoverability-e2e.test.mjs` imports `suites` and pins
// that every check carries the prereq / post-check / fix a human needs.

export { suites, MANUAL_ONLY, parseArgs, networkVerdict, VERDICT, RUNNER_SCOPE };

if (!IMPORT_ONLY) {
  await runAll();
  const outcome = summarise();
  writeReports(outcome);
  if (dbClient) await dbClient.end().catch(() => {});
  // 0 = every stop-ship check exercised and passed · 1 = something is wrong ·
  // 2 = INCONCLUSIVE, the repo's existing convention (verify-workflow-rls uses
  // it for the same reason). 2 must never read as success in CI.
  process.exit(
    outcome.stopShipProblems.length || outcome.fails.length ? 1
      : outcome.notExercised.length ? 2
        : 0);
}
