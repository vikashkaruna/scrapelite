#!/usr/bin/env node
// scripts/seed-staging-test-account.mjs
//
// Grants an EXISTING Supabase auth user the entitlement needed to exercise the
// full Intelligence Workflows surface on staging, and seeds a minimal fixture
// (one list, one watchlist, one signal rule) so the engines have something to
// act on within one cron tick.
//
// ⚠️ THIS SCRIPT DOES NOT CREATE THE USER, BY DESIGN.
// Creating an auth account needs the Auth Admin API and a password. Both are
// operator territory: the credential must never pass through a repository, a
// CI log, or an agent transcript. Create the account yourself — Supabase
// Dashboard → Authentication → Users → Add user (confirm the email) — then run
// this to grant the plan.
//
// ── NOTHING SECRET IS READ FROM, OR WRITTEN TO, THIS REPOSITORY ─────────────
// Every value comes from the environment:
//
//   STAGING_SUPABASE_URL          https://<ref>.supabase.co
//   STAGING_SUPABASE_SERVICE_KEY  the service key (server-side only, never VITE_)
//   STAGING_TEST_EMAIL            the address you created
//
// There is no default for any of them and none is ever printed. The email is
// masked in output, so a pasted terminal log does not disclose the account.
//
// Usage:
//   STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_KEY=… STAGING_TEST_EMAIL=… \
//     node scripts/seed-staging-test-account.mjs
//
//   …add --dry-run to see what it would do and touch nothing.
//   …add --plan=pro to grant a different plan (default: agency).

const DRY = process.argv.includes("--dry-run");
const PLAN = (process.argv.find((a) => a.startsWith("--plan=")) || "--plan=agency").split("=")[1];

const URL_ = process.env.STAGING_SUPABASE_URL;
const KEY = process.env.STAGING_SUPABASE_SERVICE_KEY;
const EMAIL = process.env.STAGING_TEST_EMAIL;

function die(msg) { console.error(`\n[seed] ${msg}\n`); process.exit(2); }

if (!URL_ || !KEY || !EMAIL) {
  die(
    "Missing environment. This script never falls back to a default, because a\n" +
    "default here would be a credential in a repository.\n\n" +
    "  STAGING_SUPABASE_URL=https://<ref>.supabase.co\n" +
    "  STAGING_SUPABASE_SERVICE_KEY=<service key>\n" +
    "  STAGING_TEST_EMAIL=<the address you created in the dashboard>"
  );
}

/** Masked for logs: `e2*****@datiq.app`. Enough to confirm, useless to reuse. */
const masked = (() => {
  const [user, domain] = String(EMAIL).split("@");
  return `${user.slice(0, 2)}${"*".repeat(Math.max(3, user.length - 2))}@${domain || "?"}`;
})();

const rest = (path, init = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });

console.log(`\n[seed] staging · plan=${PLAN} · user=${masked}${DRY ? " · DRY RUN" : ""}\n`);

// ── 1. Find the user. We do not create one. ─────────────────────────────────
const listRes = await fetch(
  `${URL_}/auth/v1/admin/users?per_page=200`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
if (!listRes.ok) die(`could not list auth users: HTTP ${listRes.status}. Is this the SERVICE key?`);
const payload = await listRes.json();
const users = payload.users || payload || [];
const user = users.find((u) => String(u.email).toLowerCase() === String(EMAIL).toLowerCase());

if (!user) {
  die(
    `no auth user matches ${masked}.\n\n` +
    "Create it first — Supabase Dashboard → Authentication → Users → Add user,\n" +
    "with 'Auto Confirm User' ticked. This script deliberately cannot create it:\n" +
    "an account password must not pass through a script, a log, or a transcript."
  );
}
console.log(`  ✓ found auth user (id ${user.id.slice(0, 8)}…)`);

if (DRY) {
  console.log("\n  DRY RUN — would grant the entitlement and seed fixtures. Nothing written.\n");
  process.exit(0);
}

// ── 2. Entitlement ──────────────────────────────────────────────────────────
// Upsert rather than insert: re-running must be safe, and a test account that
// already has a row should be corrected, not duplicated.
const periodEnd = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const entRes = await rest("entitlements?on_conflict=user_id", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify([{
    user_id: user.id,
    plan_id: PLAN,
    status: "active",
    source: "admin_grant",
    period_end: periodEnd,
  }]),
});
console.log(entRes.ok
  ? `  ✓ entitlement: ${PLAN}, active until ${periodEnd.slice(0, 10)}`
  : `  ✗ entitlement failed: HTTP ${entRes.status} ${(await entRes.text()).slice(0, 200)}`);

// ── 3. Fixtures the engines can act on within one tick ──────────────────────
// Deliberately tiny. The point is to prove the crons do something, not to load
// the database — and every row here costs a real crawl.
const fixtures = [];

const listRes2 = await rest("lists", {
  method: "POST",
  body: JSON.stringify([{
    user_id: user.id,
    name: "E2E — bulk enrichment",
    description: "Seeded by scripts/seed-staging-test-account.mjs",
    status: "pending",
    total_records: 2,
  }]),
});
if (listRes2.ok) {
  const [list] = await listRes2.json();
  fixtures.push(`list ${list.id.slice(0, 8)}…`);
  await rest("list_records", {
    method: "POST",
    body: JSON.stringify(
      ["example.com", "stripe.com"].map((d) => ({
        list_id: list.id, raw_input: d, canonical_domain: d, status: "queued",
      })),
    ),
  });
  const jobRes = await rest("enrichment_jobs", {
    method: "POST",
    body: JSON.stringify([{ list_id: list.id, user_id: user.id, status: "queued", total_items: 2 }]),
  });
  if (jobRes.ok) {
    const [job] = await jobRes.json();
    const recs = await (await rest(`list_records?list_id=eq.${list.id}&select=id`)).json();
    await rest("enrichment_job_items", {
      method: "POST",
      body: JSON.stringify(recs.map((r) => ({ job_id: job.id, record_id: r.id, status: "queued" }))),
    });
    fixtures.push(`enrichment job ${job.id.slice(0, 8)}…`);
  }
}

const wlRes = await rest("watchlists", {
  method: "POST",
  body: JSON.stringify([{
    user_id: user.id, name: "E2E — competitor watchlist", cadence: "hourly", status: "active",
  }]),
});
if (wlRes.ok) {
  const [wl] = await wlRes.json();
  fixtures.push(`watchlist ${wl.id.slice(0, 8)}…`);
  const tRes = await rest("watchlist_targets", {
    method: "POST",
    body: JSON.stringify([{ watchlist_id: wl.id, domain: "example.com", company_name: "Example", status: "active" }]),
  });
  if (tRes.ok) {
    const [target] = await tRes.json();
    await rest("monitored_pages", {
      method: "POST",
      body: JSON.stringify([{ target_id: target.id, url: "https://example.com/", category: "positioning" }]),
    });
  }
}

// A rule with a webhook destination the operator supplies. If none is given the
// rule is created inactive, so a seeded fixture can never POST somewhere the
// operator did not choose.
const hook = process.env.STAGING_TEST_WEBHOOK_URL;
const ruleRes = await rest("signal_rules", {
  method: "POST",
  body: JSON.stringify([{
    user_id: user.id,
    name: "E2E — alert on critical competitor change",
    status: hook ? "active" : "paused",
    trigger_source: "watchlist",
    conditions: [{ field: "materiality", operator: "in", value: ["critical", "high"] }],
    action_type: "webhook",
    action_config: hook ? { url: hook } : {},
  }]),
});
if (ruleRes.ok) fixtures.push(`signal rule (${hook ? "active" : "paused — set STAGING_TEST_WEBHOOK_URL to arm it"})`);

console.log(`  ✓ fixtures: ${fixtures.join(", ") || "none"}`);
console.log(`
[seed] done. Next:
  1. npm run verify:rls                     → must be all 401 before testing
  2. Sign in on staging as ${masked}
  3. Walk docs/TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md
`);
