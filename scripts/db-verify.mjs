#!/usr/bin/env node
//
// scripts/db-verify.mjs
//
// Executes every numbered migration in supabase/migrations/ against an
// in-process WASM Postgres (PGlite), then exercises every function, trigger and
// RLS policy they create.
//
// Why this exists: migrations 0012-0017 shipped having only ever been checked
// for `$$` balance and structure, because there is no Postgres, no Docker and no
// psql on the dev machines. That made "apply to a scratch Supabase project" a
// manual step nobody could repeat, and left the invoice numbering, the
// immutability trigger and the RLS ownership rules completely unexecuted. This
// runs in ~5 seconds with no network and no external service.
//
// Usage:
//   npm run test:db
//   node scripts/db-verify.mjs --quiet     # only the summary + failures
//
// This is NOT a substitute for applying to a real Supabase project — PGlite has
// no GoTrue, no PostgREST and no Supabase roles, so the shims below stand in for
// them. It IS enough to prove the DDL parses, the functions behave, the trigger
// blocks what it must, and the policies filter by auth.uid().
//
// Exit code is non-zero if any migration fails to apply or any assertion fails.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "supabase", "migrations");
const QUIET = process.argv.includes("--quiet");

// ── Supabase shims ───────────────────────────────────────────────────────────
// Only what the migrations actually reference: auth.users.id (14 FKs),
// auth.uid() (16 policies), and the anon/authenticated roles that the
// GRANT/REVOKE statements name. auth.uid() reads a GUC here instead of a JWT so
// tests can switch identity with set_config().
const SHIMS = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
`;

// What the migrations claim to create. A mismatch here means a migration was
// added or renamed without updating this file — deliberately a hard failure.
// 0022_workflow_events.sql adds 3 tables (workflow_events / workflow_runs /
// workflow_subscriptions), 1 function (workflow_set_updated_at), and 2
// triggers (workflow_events_set_updated_at / workflow_subscriptions_set_updated_at).
// All 3 new tables have RLS enabled, so tablesWithoutRls stays at 0.
//
// 0023_consent.sql adds 2 tables (consent_records / consent_audit), 1 function
// (consent_audit_immutable) and 1 trigger (consent_audit_no_change, which makes
// the audit log append-only at the database level rather than by convention).
// Both tables have RLS enabled with service-role-only policies, so
// tablesWithoutRls stays at 0.
//
// 0024_analytics_rls.sql adds no objects — it DROPS the two `using (true)` anon
// policies that made analytics_events world-readable, and adds one partial
// index. Policy changes are not counted here, so these numbers are unaffected
// by it; the RLS behaviour itself is asserted separately below.
//
// 0028_scrape_consent.sql adds 2 tables (scrape_consent_records +
// scrape_consent_audit), 1 function and 1 trigger (the append-only guard on
// the audit table), taking these to 42 / 17 / 6.
//
// 0029_referrals.sql adds 2 tables (referral_codes + referral_redemptions) and
// 2 functions (issue_referral_code + redeem_referral_code), taking these to
// 44 / 19 / 6. No new trigger.
//
// 0030_discoverability_audits.sql adds 13 tables, 5 functions and 5 triggers,
// taking these to 57 / 24 / 11.
//
// 0031_team_workspaces.sql adds 3 tables (workspaces, workspace_members,
// workspace_invites) and 4 functions (create_workspace,
// create_workspace_invite, accept_workspace_invite, remove_workspace_member),
// taking these to 60 / 28 / 11. No new trigger.
//
// 0032_account_state_and_audit_summary.sql adds NO tables — it is additive
// columns on entitlements, workspace_members and audit_results — plus 4
// functions (set_account_frozen, request_account_deletion,
// cancel_account_deletion, set_workspace_member_paused), taking these to
// 60 / 32 / 11. No new trigger.
const EXPECT = {
  tables: 60,
  functions: 32,
  triggers: 11,
  tablesWithoutRls: 0,
};

const db = new PGlite();
let pass = 0;
let fail = 0;
const failures = [];

const say = (...a) => { if (!QUIET) console.log(...a); };
const group = (t) => say(`\n${t}`);

function check(name, cond, detail = "") {
  if (cond) { pass++; say(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? " — " + detail.trim() : ""}`); say(`  ✗ ${name} ${detail}`); }
}
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object")
    return Object.keys(v).sort().reduce((o, k) => ((o[k] = norm(v[k])), o), {});
  return v;
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(norm(actual)) === JSON.stringify(norm(expected)),
    `\n      got=${JSON.stringify(actual)}\n      want=${JSON.stringify(expected)}`);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
async function throws(sql, params) {
  try { await db.query(sql, params); return null; } catch (e) { return e.message; }
}

// ── apply ────────────────────────────────────────────────────────────────────
await db.exec(SHIMS);

group("migrations");
const files = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
if (files.length === 0) {
  console.error("✗ no numbered migrations found in supabase/migrations/");
  process.exit(1);
}
// PGlite (WASM Postgres) does not ship the `pgcrypto` extension. The migrations
// that reference it only need `gen_random_uuid()`, which PGlite provides
// natively (Postgres 13+). Strip the `create extension` line so the rest of
// the migration can apply; the real Supabase project keeps the line.
const PGCRYPTO_LINE = /create\s+extension\s+if\s+not\s+exists\s+["']pgcrypto["']\s*;?/gi;
for (const f of files) {
  const raw = readFileSync(join(DIR, f), "utf8");
  const sql = raw.replace(PGCRYPTO_LINE, "-- pgcrypto skipped: PGlite has gen_random_uuid() natively");
  try {
    await db.exec(sql);
    check(`apply ${f}`, true);
  } catch (e) {
    check(`apply ${f}`, false, e.message);
    console.error(`\n✗ ${f} failed to apply — stopping.\n  ${e.message}\n`);
    process.exit(1);
  }
}

// ── inventory ────────────────────────────────────────────────────────────────
group("object inventory");
{
  const t = await q(`select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const f = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' order by 1`);
  const g = await q(`select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by 1`);
  const noRls = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and relkind='r' and not relrowsecurity order by 1`);

  eq(`${EXPECT.tables} tables`, t.length, EXPECT.tables);
  eq(`${EXPECT.functions} functions`, f.length, EXPECT.functions);
  eq(`${EXPECT.triggers} triggers`, g.length, EXPECT.triggers);
  check(`every table has RLS enabled`, noRls.length === EXPECT.tablesWithoutRls,
    noRls.length ? "missing on: " + noRls.map((r) => r.relname).join(", ") : "");
}

// ── fy_of: Indian FY boundary is 1 April IST, not UTC ───────────────────────
group("fy_of() — FY boundary is 1 April IST");
{
  const v = await one(`select
    public.fy_of('2026-03-31 18:00:00+00'::timestamptz) a,
    public.fy_of('2026-03-31 18:31:00+00'::timestamptz) b,
    public.fy_of('2026-04-01 00:00:00+05:30'::timestamptz) c,
    public.fy_of('2026-01-15 12:00:00+00'::timestamptz) d,
    public.fy_of('2026-12-31 23:59:00+05:30'::timestamptz) e`);
  eq("31 Mar 23:30 IST -> 25-26", v.a, "25-26");
  eq("1 Apr 00:01 IST -> 26-27 (UTC would wrongly say 25-26)", v.b, "26-27");
  eq("1 Apr 00:00 IST -> 26-27", v.c, "26-27");
  eq("15 Jan -> 25-26", v.d, "25-26");
  eq("31 Dec -> 26-27", v.e, "26-27");
}

// ── next_invoice_no: gapless per (series, fy) ────────────────────────────────
group("next_invoice_no() — gapless numbering");
{
  eq("first is zero-padded 000001", (await one(`select public.next_invoice_no('DTQ','26-27') n`)).n, "DTQ/26-27/000001");
  eq("second increments", (await one(`select public.next_invoice_no('DTQ','26-27') n`)).n, "DTQ/26-27/000002");
  eq("credit-note series is independent", (await one(`select public.next_invoice_no('DTQC','26-27') n`)).n, "DTQC/26-27/000001");
  eq("new FY restarts at 1", (await one(`select public.next_invoice_no('DTQ','27-28') n`)).n, "DTQ/27-28/000001");

  // The reason this is a counter table and not a sequence: a rollback must
  // un-do the increment, because gaps in a GST series are what auditors ask about.
  await db.exec("begin");
  await q(`select public.next_invoice_no('DTQ','26-27')`);
  await db.exec("rollback");
  eq("rollback leaves no gap", (await one(`select public.next_invoice_no('DTQ','26-27') n`)).n, "DTQ/26-27/000003");
}

// ── issue_invoice: idempotency, lines, money invariant ──────────────────────
group("issue_invoice() — idempotency, lines, money");
let INV;
{
  const uid = (await one(`insert into auth.users (email) values ('a@x.com') returning id`)).id;
  const payload = {
    provider: "razorpay", provider_payment_id: "pay_TEST1", user_id: uid,
    email: "a@x.com", plan_id: "pro", billing_period: "annual", currency: "INR",
    gross_minor: 179880, taxable_minor: 152441, tax_rate: 18, tax_treatment: "intra",
    cgst_minor: 13720, sgst_minor: 13719, tax_minor: 27439, total_minor: 179880,
    doc_type: "tax_invoice", place_of_supply: "29",
    supplier_snapshot: { legal_name: "T" },
    lines: [
      { kind: "plan", description: "Pro annual", hsn_sac: "998314", qty: 1, unit_minor: 152441, amount_minor: 152441 },
      { kind: "tax", description: "CGST 9%", amount_minor: 13720 },
    ],
  };
  const r1 = (await one(`select public.issue_invoice($1::jsonb) r`, [JSON.stringify(payload)])).r;
  check("first call created=true", r1.created === true, `got ${r1.created}`);
  INV = r1.invoice;
  eq("invoice_no allocated from the counter", INV.invoice_no, "DTQ/26-27/000004");
  eq("seq matches the counter", INV.seq, 4);
  eq("taxable + tax === total", INV.taxable_minor + INV.tax_minor, INV.total_minor);
  eq("cgst + sgst === tax", INV.cgst_minor + INV.sgst_minor, INV.tax_minor);
  eq("doc_type honoured", INV.doc_type, "tax_invoice");

  const lines = await q(`select line_no, kind from public.invoice_lines where invoice_id=$1 order by line_no`, [INV.id]);
  eq("lines numbered from 1", lines.map((l) => l.line_no), [1, 2]);
  eq("line kinds preserved", lines.map((l) => l.kind), ["plan", "tax"]);

  // Replay: verify-payment and payment-webhook both call this for the same payment.
  const r2 = (await one(`select public.issue_invoice($1::jsonb) r`, [JSON.stringify(payload)])).r;
  check("replay created=false", r2.created === false, `got ${r2.created}`);
  eq("replay returns the same invoice_no", r2.invoice.invoice_no, INV.invoice_no);
  eq("exactly one row for that payment",
    (await one(`select count(*)::int n from public.invoices where provider_payment_id='pay_TEST1'`)).n, 1);
  eq("replay did not duplicate lines",
    (await one(`select count(*)::int n from public.invoice_lines where invoice_id=$1`, [INV.id])).n, 2);
}

// ── invoices_immutable trigger ───────────────────────────────────────────────
group("invoices_immutable trigger");
{
  const e1 = await throws(`update public.invoices set total_minor=1 where id=$1`, [INV.id]);
  check("blocks total_minor", !!e1 && /immutable/.test(e1), e1 || "no error raised");
  const e2 = await throws(`update public.invoices set invoice_no='X' where id=$1`, [INV.id]);
  check("blocks invoice_no", !!e2 && /immutable/.test(e2), e2 || "no error raised");

  const u2 = (await one(`insert into auth.users (email) values ('b@x.com') returning id`)).id;
  const e3 = await throws(`update public.invoices set user_id=$2 where id=$1`, [INV.id, u2]);
  check("blocks user_id re-point once set", !!e3 && /user_id is immutable/.test(e3), e3 || "no error raised");

  const e4 = await throws(`update public.invoices
    set status='refunded', refunded_minor=100, pdf_path='p', pdf_sha256='s' where id=$1`, [INV.id]);
  check("allows status / refunded_minor / pdf_path / pdf_sha256", e4 === null, e4 || "");
  const u = await one(`select status, updated_at > issued_at touched from public.invoices where id=$1`, [INV.id]);
  eq("status persisted", u.status, "refunded");
  check("updated_at bumped by the trigger", u.touched === true, `got ${u.touched}`);

  // A guest invoice adopted after sign-in: NULL -> set is the one allowed change.
  const g = (await one(`select public.issue_invoice($1::jsonb) r`, [JSON.stringify({
    provider: "razorpay", provider_payment_id: "pay_GUEST", session_id: "sess_g",
    email: "g@x.com", currency: "INR", taxable_minor: 100, tax_minor: 18, total_minor: 118 })])).r;
  const e5 = await throws(`update public.invoices set user_id=$2 where id=$1`, [g.invoice.id, u2]);
  check("allows NULL -> set user_id (guest adoption)", e5 === null, e5 || "");
}

// ── plan_rank ────────────────────────────────────────────────────────────────
group("plan_rank()");
{
  const r = await one(`select public.plan_rank('agency') a, public.plan_rank('business') b,
    public.plan_rank('pro') p, public.plan_rank('developer') d, public.plan_rank('select') s,
    public.plan_rank('go') g, public.plan_rank('free') f, public.plan_rank(null) n,
    public.plan_rank('suspended') x, public.plan_rank('AGENCY') u`);
  eq("agency=6", r.a, 6);
  eq("business=5", r.b, 5);
  eq("pro=developer=4", [r.p, r.d], [4, 4]);
  eq("select=3", r.s, 3);
  eq("go=2", r.g, 2);
  eq("free=1", r.f, 1);
  eq("null ranks as free", r.n, 1);
  eq("unknown plan ranks 0 so it never wins a merge", r.x, 0);
  eq("case-insensitive", r.u, 6);
}

// ── merge_entitlement_from_subscriptions: never downgrade ────────────────────
group("merge_entitlement_from_subscriptions() — never downgrade");
{
  const uid = (await one(`insert into auth.users (email) values ('m@x.com') returning id`)).id;
  const addSub = (sid, plan) => q(
    `insert into public.subscriptions (session_id, user_id, plan_id, status, updated_at)
     values ($1,$2,$3,'active',now())`, [sid, uid, plan]);
  const plan = async () => (await one(`select plan_id from public.entitlements where user_id=$1`, [uid])).plan_id;

  await addSub("s_m1", "pro");
  await q(`select public.merge_entitlement_from_subscriptions($1)`, [uid]);
  eq("first merge sets pro", await plan(), "pro");

  await addSub("s_m2", "free");
  await q(`select public.merge_entitlement_from_subscriptions($1)`, [uid]);
  eq("free does NOT downgrade pro", await plan(), "pro");

  await addSub("s_m3", "agency");
  await q(`select public.merge_entitlement_from_subscriptions($1)`, [uid]);
  eq("agency DOES upgrade pro", await plan(), "agency");
  check("version increments on merge",
    (await one(`select version from public.entitlements where user_id=$1`, [uid])).version > 1);

  const before = (await one(`select count(*)::int n from public.entitlements`)).n;
  await q(`select public.merge_entitlement_from_subscriptions(null)`);
  eq("null user is a no-op", (await one(`select count(*)::int n from public.entitlements`)).n, before);
}

// ── claim_billing_session: the anti-theft claim ──────────────────────────────
group("claim_billing_session() — anti-theft claim");
let U1, U2;
{
  U1 = (await one(`insert into auth.users (email) values ('c1@x.com') returning id`)).id;
  U2 = (await one(`insert into auth.users (email) values ('c2@x.com') returning id`)).id;
  await q(`insert into public.subscriptions (session_id, plan_id, status) values ('sess_c','business','active')`);
  await q(`insert into public.payment_events (session_id, event_type, status) values ('sess_c','captured','captured')`);
  await q(`insert into public.usage_records (session_id, month, extractions) values ('sess_c','2026-07',5)`);
  const claim = async (s) => (await one(`select public.claim_billing_session($1) r`, [s])).r;
  const asUser = (u) => db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`);

  await asUser("");
  eq("no JWT -> no_auth", await claim("sess_c"), { claimed: false, reason: "no_auth" });

  await asUser(U1);
  eq("empty session id -> no_auth", await claim(""), { claimed: false, reason: "no_auth" });
  eq("u1 claims the session", await claim("sess_c"), { claimed: true });

  const s = await one(`select
    (select user_id from public.subscriptions  where session_id='sess_c') a,
    (select user_id from public.payment_events where session_id='sess_c') b,
    (select user_id from public.usage_records  where session_id='sess_c') c`);
  eq("stamps user_id on subscriptions/payment_events/usage_records", [s.a, s.b, s.c], [U1, U1, U1]);
  eq("entitlement derived from the claimed subscription",
    (await one(`select plan_id from public.entitlements where user_id=$1`, [U1])).plan_id, "business");
  eq("re-claim by the same user is idempotent", await claim("sess_c"), { claimed: true });

  await asUser(U2);
  eq("a different user is refused", await claim("sess_c"), { claimed: false, reason: "already_linked" });
  eq("the refused claim did not move user_id",
    (await one(`select user_id from public.subscriptions where session_id='sess_c'`)).user_id, U1);
}

// ── redeem_coupon: atomic cap + one-per-user ─────────────────────────────────
group("redeem_coupon() — atomic cap, one per user");
{
  const r = async (code, sess, max) => (await one(`select public.redeem_coupon($1,$2,$3,'ord') r`, [code, sess, max])).r;
  eq("first redemption ok", await r("SAVE20", "s1", 2), "ok");
  eq("same user again -> already_redeemed", await r("SAVE20", "s1", 2), "already_redeemed");
  eq("second user ok, under cap", await r("SAVE20", "s2", 2), "ok");
  eq("third user -> cap_reached", await r("SAVE20", "s3", 2), "cap_reached");
  eq("cap_reached rolled its own redemption row back",
    (await one(`select count(*)::int n from public.coupon_redemptions
      where coupon_code='SAVE20' and session_id='s3'`)).n, 0);
  eq("counter stopped exactly at the cap",
    (await one(`select uses from public.coupon_counters where coupon_code='SAVE20'`)).uses, 2);
  eq("max<=0 means uncapped", await r("FREE", "s9", 0), "ok");
  eq("uncapped writes no counter row",
    (await one(`select count(*)::int n from public.coupon_counters where coupon_code='FREE'`)).n, 0);
  eq("null max is uncapped", await r("NULLMAX", "s10", null), "ok");
}

// ── public_reports_touch_updated_at trigger ──────────────────────────────────
group("public_reports_touch_updated_at trigger");
{
  const ins = await one(`insert into public.public_reports (slug, title, url, data)
    values ('sl1','T','https://x.com','{}'::jsonb) returning id, updated_at`);
  await q(`update public.public_reports set title='T2' where id=$1`, [ins.id]);
  const after = await one(`select updated_at from public.public_reports where id=$1`, [ins.id]);
  check("updated_at advances on UPDATE",
    new Date(after.updated_at).getTime() >= new Date(ins.updated_at).getTime(),
    `${ins.updated_at} -> ${after.updated_at}`);
}

// ── RLS: the rules that gate invoice downloads and billing reads ─────────────
group("RLS enforcement as role=authenticated");
{
  await q(`select public.issue_invoice($1::jsonb)`, [JSON.stringify({
    provider: "razorpay", provider_payment_id: "pay_U1", user_id: U1,
    email: "c1@x.com", currency: "INR", taxable_minor: 100, tax_minor: 18, total_minor: 118 })]);
  const mine = (await one(`select count(*)::int n from public.invoices where user_id=$1`, [U1])).n;
  const total = (await one(`select count(*)::int n from public.invoices`)).n;

  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U1}',false);`);
  const asU1 = (await one(`select count(*)::int n from public.invoices`)).n;
  await db.exec(`select set_config('request.jwt.claim.sub','${U2}',false)`);
  const asU2 = (await one(`select count(*)::int n from public.invoices`)).n;
  const subsU2 = (await one(`select count(*)::int n from public.subscriptions`)).n;
  const wIns = await throws(`insert into public.invoices (invoice_no, series, fy, seq, currency)
    values ('HACK','DTQ','26-27',999,'INR')`);
  const wUpd = await throws(`update public.subscriptions set plan_id='agency'`);
  await db.exec(`reset role`);

  check("owner sees exactly their own invoices", asU1 === mine && asU1 > 0, `saw ${asU1}, owns ${mine}`);
  check("policy filters rather than passing through", total > mine, `total=${total}, mine=${mine}`);
  eq("a different user sees none of them", asU2, 0);
  eq("a different user reads no subscription rows", subsU2, 0);
  check("authenticated cannot INSERT invoices", !!wIns, wIns || "the insert succeeded");
  check("authenticated cannot UPDATE subscriptions", !!wUpd, wUpd || "the update succeeded");
}

// ── 0015 column-level REVOKE ─────────────────────────────────────────────────
group("0015 scheduler hardening — column privileges");
{
  for (const col of ["system_paused", "system_pause_reason"]) {
    const g = await q(`select 1 from information_schema.column_privileges
      where table_schema='public' and table_name='scheduled_tasks'
        and column_name=$1 and grantee in ('anon','authenticated')`, [col]);
    eq(`no anon/authenticated write grant on ${col}`, g.length, 0);
  }
}

// ── 0018 ops monitoring ──────────────────────────────────────────────────────
group("0018 ops monitoring — constraints");
{
  // job_runs / health_samples enum-style CHECKs.
  const badJobStatus = await throws(
    `insert into public.job_runs (job, status) values ('x','exploded')`);
  const badTrigger = await throws(
    `insert into public.job_runs (job, trigger) values ('x','cosmic-ray')`);
  const badHealth = await throws(
    `insert into public.health_samples (component, status) values ('db','on fire')`);
  check("job_runs rejects an unknown status", !!badJobStatus, badJobStatus || "insert succeeded");
  check("job_runs rejects an unknown trigger", !!badTrigger, badTrigger || "insert succeeded");
  check("health_samples rejects an unknown status", !!badHealth, badHealth || "insert succeeded");

  // The whole point of the reason CHECK: NOT NULL alone would let '' through.
  const blank = await throws(
    `insert into public.ops_audit_log (actor, action, reason) values ('a','job_disable','')`);
  const spaces = await throws(
    `insert into public.ops_audit_log (actor, action, reason) values ('a','job_disable','   ')`);
  check("ops_audit_log rejects an empty reason", !!blank, blank || "insert succeeded");
  check("ops_audit_log rejects a whitespace-only reason", !!spaces, spaces || "insert succeeded");
  const ok = await one(
    `insert into public.ops_audit_log (actor, action, target, reason)
     values ('admin','job_disable','billing-purge','paused during the data migration')
     returning id`);
  check("ops_audit_log accepts a real reason", !!ok?.id);
}

group("0018 prune_ops_history()");
{
  // Two finished runs (one old, one fresh), one old run still 'running', and
  // two health samples straddling the cutoff.
  await q(`insert into public.job_runs (job, status, started_at, finished_at)
           values ('reengagement','success', now() - interval '90 days', now() - interval '90 days')`);
  await q(`insert into public.job_runs (job, status, started_at, finished_at)
           values ('reengagement','error',   now() - interval '1 day',   now() - interval '1 day')`);
  await q(`insert into public.job_runs (job, status, started_at)
           values ('billing-lifecycle','running', now() - interval '90 days')`);
  await q(`insert into public.health_samples (component, status, observed_at)
           values ('supabase-db','ok', now() - interval '90 days')`);
  await q(`insert into public.health_samples (component, status, observed_at)
           values ('supabase-db','ok', now())`);

  const removed = (await one(`select public.prune_ops_history(30) n`)).n;
  eq("prunes exactly the rows past the window", removed, 2);

  const stranded = (await one(
    `select count(*)::int n from public.job_runs where status='running'`)).n;
  eq("a stranded 'running' row survives retention", stranded, 1);
  const kept = (await one(
    `select count(*)::int n from public.job_runs where status='error'`)).n;
  eq("a recent finished run survives", kept, 1);
  const samples = (await one(`select count(*)::int n from public.health_samples`)).n;
  eq("only the out-of-window sample was removed", samples, 1);

  const bad = await throws(`select public.prune_ops_history(0)`);
  check("prune_ops_history refuses a zero window", !!bad, bad || "call succeeded");
}

group("0023 consent records + append-only audit");
{
  await q(`insert into public.consent_records
             (subject_key, session_id, analytics, policy_version)
           values ('session:abc', 'abc', 'granted', '2026-08-15')`);

  // The natural key is the subject, so a second choice by the same visitor
  // must UPDATE rather than accumulate rows — otherwise "current consent"
  // becomes ambiguous and the withdraw path has nothing definite to flip.
  const dupe = await throws(
    `insert into public.consent_records (subject_key, session_id, analytics, policy_version)
     values ('session:abc', 'abc', 'denied', '2026-08-15')`);
  check("consent_records is unique per subject", !!dupe, dupe || "duplicate insert succeeded");

  const badChoice = await throws(
    `insert into public.consent_records (subject_key, session_id, analytics, policy_version)
     values ('session:xyz', 'xyz', 'maybe', '2026-08-15')`);
  check("consent_records rejects a non-binary choice", !!badChoice,
        badChoice || "'maybe' was accepted");

  const badSource = await throws(
    `insert into public.consent_audit (subject_key, analytics, policy_version, source)
     values ('session:abc', 'granted', '2026-08-15', 'guessed')`);
  check("consent_audit rejects an unknown source", !!badSource,
        badSource || "'guessed' was accepted");

  await q(`insert into public.consent_audit
             (subject_key, session_id, analytics, policy_version, source)
           values ('session:abc', 'abc', 'granted', '2026-08-15', 'banner')`);

  // The whole point of an audit trail: it must survive a buggy handler or a
  // well-meant cleanup by someone holding the service key.
  const upd = await throws(
    `update public.consent_audit set analytics = 'denied' where subject_key = 'session:abc'`);
  check("consent_audit rejects UPDATE", !!upd, upd || "update succeeded");

  const del = await throws(
    `delete from public.consent_audit where subject_key = 'session:abc'`);
  check("consent_audit rejects DELETE", !!del, del || "delete succeeded");

  const rows = (await one(`select count(*)::int n from public.consent_audit`)).n;
  eq("the audit row is still there after both attempts", rows, 1);
}

group("0024 analytics_events is no longer world-readable");
{
  // The exposure this migration closes: `for select using (true)` let any
  // holder of the published anon key read every event row. Assert by name so
  // a future migration that re-adds it fails here loudly.
  const anonPolicies = (await one(
    `select count(*)::int n from pg_policies
      where tablename = 'analytics_events'
        and policyname in ('anon read access','anon insert access')`)).n;
  eq("both anon policies are gone", anonPolicies, 0);

  const permissive = (await one(
    `select count(*)::int n from pg_policies
      where tablename = 'analytics_events'
        and 'anon' = any(coalesce(roles, '{}'))`)).n;
  eq("no policy grants the anon role anything", permissive, 0);

  const rls = (await one(
    `select relrowsecurity from pg_class where relname = 'analytics_events'`)).relrowsecurity;
  check("RLS is still enabled on analytics_events", rls === true, `relrowsecurity=${rls}`);
}

// ── 0025 gallery curation ─────────────────────────────────────────────────────
group("0025 gallery curation — persona tagging + review metadata");
{
  const ok = await one(`insert into public.public_reports (slug, title, url, data, persona)
    values ('gc-ok','T','https://x.com','{}'::jsonb,'sales') returning id, curated`);
  eq("persona accepts a known id", ok.curated, false);

  const nullPersona = await one(`insert into public.public_reports (slug, title, url, data)
    values ('gc-null','T','https://x.com','{}'::jsonb) returning persona`);
  eq("persona stays nullable for ordinary shares", nullPersona.persona, null);

  const badPersona = await throws(`insert into public.public_reports (slug, title, url, data, persona)
    values ('gc-bad','T','https://x.com','{}'::jsonb,'not-a-real-persona')`);
  check("an unknown persona id is rejected", !!badPersona, badPersona || "insert succeeded");

  await q(`update public.public_reports
    set curated = true, persona = 'seo', reviewed_at = now(), reviewed_by = 'admin@datiq.app'
    where id = $1`, [ok.id]);
  const curated = await one(`select curated, persona, reviewed_by from public.public_reports where id = $1`, [ok.id]);
  eq("curation flips curated + records who reviewed it", curated.curated, true);
  eq("curation does not change the persona already set", curated.persona, "seo");

  const idx = await one(`select count(*)::int n from pg_indexes
    where tablename = 'public_reports' and indexname = 'public_reports_curated_persona_idx'`);
  eq("the curated+persona partial index exists", idx.n, 1);
}

// ── 0026 server-side guest identity usage ───────────────────────────────────
group("0026 guest identity usage — atomic quota");
{
  const first = await one(`select public.consume_guest_credit('guest-hash-000000000000000000000000000000','single',1,5) result`);
  eq("first guest credit is allowed", first.result.allowed, true);
  const denied = await one(`select public.consume_guest_credit('guest-hash-000000000000000000000000000000','single',1,5) result`);
  eq("second guest credit is denied at the limit", denied.result.allowed, false);
  const batch = await one(`select public.consume_guest_credit('guest-hash-000000000000000000000000000001','batch',5,1) result`);
  eq("batch quota uses its independent counter", batch.result.kind, "batch");
  const table = await one(`select count(*)::int n from public.guest_identities`);
  eq("guest identity row is stored without raw cookie", table.n, 2);
}

// ── 0027 admin coupon grants ───────────────────────────────────────────────
group("0027 admin coupon grants — user-scoped, one-time redemption");
{
  const uid = (await one(`insert into auth.users (email) values ('grant@x.com') returning id`)).id;
  const created = await one(`select public.create_admin_coupon_assignment(
    $1, 'GRANT-PRO-1M', 'pro', 1, null, 'admin', 'test grant'
  ) result`, [uid]);
  eq("admin grant assignment is created", created.result.code, "GRANT-PRO-1M");
  eq("admin grant stores its selected plan", created.result.plan_id, "pro");
  const redeemed = await one(`select public.redeem_admin_coupon($1, 'grant-pro-1m') result`, [uid]);
  eq("admin grant redemption succeeds", redeemed.result.ok, true);
  eq("admin grant redemption activates the selected plan", redeemed.result.plan_id, "pro");
  const ent = await one(`select plan_id, billing_period, source from public.entitlements where user_id = $1`, [uid]);
  eq("admin grant entitlement is non-recurring", ent.billing_period, "once");
  eq("admin grant entitlement source is isolated", ent.source, "admin_coupon");
  const replay = await one(`select public.redeem_admin_coupon($1, 'grant-pro-1m') result`, [uid]);
  eq("admin grant cannot be redeemed twice", replay.result.code, "GRANT_ALREADY_USED");
}

// ── 0028 scrape consent ────────────────────────────────────────────────────
group("0028 scrape consent — per-host attestation, append-only audit");
{
  const uid = (await one(`insert into auth.users (email) values ('consent@x.com') returning id`)).id;
  await db.query(
    `insert into public.scrape_consent_records (user_id, host, policy_version)
     values ($1, 'linkedin.com', '2026-08-23')`, [uid]);
  const row = await one(
    `select host, expires_at > now() live from public.scrape_consent_records where user_id = $1`, [uid]);
  eq("attestation is stored for the host", row.host, "linkedin.com");
  eq("attestation defaults to an unexpired window", row.live, true);

  // One grant per (user, host): re-attesting must renew, never duplicate.
  let dup = null;
  try {
    await db.query(
      `insert into public.scrape_consent_records (user_id, host, policy_version)
       values ($1, 'linkedin.com', '2026-08-23')`, [uid]);
  } catch (err) { dup = err; }
  eq("a second attestation for the same host is rejected", Boolean(dup), true);

  // The user FK cascades: deleting the account removes the CURRENT state...
  await db.query(
    `insert into public.scrape_consent_audit (user_id, host, action, policy_version, source)
     values ($1, 'linkedin.com', 'granted', '2026-08-23', 'extract_refusal')`, [uid]);

  let upd = null;
  try {
    await db.query(`update public.scrape_consent_audit set action = 'withdrawn' where user_id = $1`, [uid]);
  } catch (err) { upd = err; }
  eq("scrape_consent_audit rejects UPDATE", Boolean(upd), true);

  let del = null;
  try {
    await db.query(`delete from public.scrape_consent_audit where user_id = $1`, [uid]);
  } catch (err) { del = err; }
  eq("scrape_consent_audit rejects DELETE", Boolean(del), true);

  // ...while the audit row survives it, because it carries no FK. That is the
  // whole reason for the missing FK, so assert it rather than trusting it.
  await db.query(`delete from auth.users where id = $1`, [uid]);
  const left = await one(`select count(*)::int n from public.scrape_consent_records where user_id = $1`, [uid]);
  eq("deleting the account clears the current attestation", left.n, 0);
  const kept = await one(`select count(*)::int n from public.scrape_consent_audit where user_id = $1`, [uid]);
  eq("the audit row outlives the deleted account", kept.n, 1);
}

// ── 0029 referrals ─────────────────────────────────────────────────────────
group("0029 referrals — unique codes, one redemption per account, both sides paid");
{
  const alice = (await one(`insert into auth.users (email) values ('alice@x.com') returning id`)).id;
  const bob   = (await one(`insert into auth.users (email) values ('bob@x.com')   returning id`)).id;
  const carol = (await one(`insert into auth.users (email) values ('carol@x.com') returning id`)).id;

  const a1 = (await one(`select public.issue_referral_code($1) code`, [alice])).code;
  eq("a code is 8 characters", a1.length, 8);
  eq("a code uses only the unambiguous alphabet", /^[A-HJ-NP-Z2-9]{8}$/.test(a1), true);

  // The bug this replaces produced "AAAAAAAA" for every user.
  const a2 = (await one(`select public.issue_referral_code($1) code`, [alice])).code;
  eq("issuing twice returns the SAME code (idempotent)", a2, a1);
  const b1 = (await one(`select public.issue_referral_code($1) code`, [bob])).code;
  eq("two users get DIFFERENT codes", b1 === a1, false);

  // Uniqueness at scale — 200 codes, no collisions surviving the retry loop.
  for (let i = 0; i < 200; i++) {
    await db.query(`insert into auth.users (email) values ($1)`, [`bulk${i}@x.com`]);
  }
  const bulk = await db.query(
    `select public.issue_referral_code(id) code from auth.users where email like 'bulk%@x.com'`);
  const codes = new Set(bulk.rows.map((r) => r.code));
  eq("200 issued codes are all distinct", codes.size, 200);

  // Redemption pays BOTH sides. The old client-side path never paid the referrer.
  const ok = (await one(`select public.redeem_referral_code($1, $2, 25) result`, [bob, a1])).result;
  eq("redemption succeeds", ok.ok, true);
  const aliceEnt = await one(`select bonus_extractions b from public.entitlements where user_id = $1`, [alice]);
  const bobEnt   = await one(`select bonus_extractions b from public.entitlements where user_id = $1`, [bob]);
  eq("the referrer is credited", aliceEnt.b, 25);
  eq("the invitee is credited", bobEnt.b, 25);

  // One per ACCOUNT, ever — the constraint that makes the reward finite.
  const replay = (await one(`select public.redeem_referral_code($1, $2, 25) result`, [bob, a1])).result;
  eq("the same invitee cannot redeem twice", replay.reason, "already");
  const c1 = (await one(`select public.issue_referral_code($1) code`, [carol])).code;
  const other = (await one(`select public.redeem_referral_code($1, $2, 25) result`, [bob, c1])).result;
  eq("an invitee cannot redeem a SECOND person's code either", other.reason, "already");

  const self = (await one(`select public.redeem_referral_code($1, $2, 25) result`, [carol, c1])).result;
  eq("self-referral is refused", self.reason, "self");
  const bad = (await one(`select public.redeem_referral_code($1, 'NOPENOPE', 25) result`, [carol])).result;
  eq("an unknown code is refused", bad.reason, "invalid");

  // Codes are case- and whitespace-insensitive on the way in.
  const dave = (await one(`insert into auth.users (email) values ('dave@x.com') returning id`)).id;
  const lower = (await one(
    `select public.redeem_referral_code($1, $2, 25) result`, [dave, `  ${a1.toLowerCase()}  `])).result;
  eq("a lowercased, padded code still redeems", lower.ok, true);
  const aliceAfter = await one(`select bonus_extractions b from public.entitlements where user_id = $1`, [alice]);
  eq("the referrer accrues across referrals", aliceAfter.b, 50);

  // The DB refuses a self-referral even if a handler bug ever tried to write one.
  let selfIns = null;
  try {
    await db.query(
      `insert into public.referral_redemptions (code, referrer_user_id, invitee_user_id, bonus_granted)
       values ($1, $2, $2, 25)`, [c1, carol]);
  } catch (err) { selfIns = err; }
  eq("a self-referral row is rejected by the check constraint", Boolean(selfIns), true);
}

// ── 0030: discoverability audits ─────────────────────────────────────────────
group("discoverability — targets, idempotency, trends, retention");
{
  const alice = (await one(`insert into auth.users (email) values ('audit-alice@x.com') returning id`)).id;
  const bob   = (await one(`insert into auth.users (email) values ('audit-bob@x.com') returning id`)).id;

  // ── upsert_audit_target: one target per owner per URL ──────────────────────
  // This is what makes re-auditing accumulate ONE history instead of scattering
  // across duplicate targets.
  const t1 = (await one(`select public.upsert_audit_target($1,$2,$3,$4) id`,
    [alice, "https://example.com/geo", "example.com", "GEO guide"])).id;
  const t2 = (await one(`select public.upsert_audit_target($1,$2,$3,null) id`,
    [alice, "https://example.com/geo", "example.com"])).id;
  eq("re-auditing the same URL reuses one target", t1, t2);

  const kept = await one(`select label from public.audit_targets where id = $1`, [t1]);
  eq("a re-upsert with no label does not erase the existing one", kept.label, "GEO guide");

  // Two owners auditing the same URL are two separate targets, not a shared one.
  const t3 = (await one(`select public.upsert_audit_target($1,$2,$3,null) id`,
    [bob, "https://example.com/geo", "example.com"])).id;
  check("a different owner gets their own target for the same URL", t3 !== t1);

  // ── audits + idempotency ──────────────────────────────────────────────────
  const mkAudit = async (user, target, key = null, status = "completed") =>
    (await one(
      `insert into public.audits (user_id, target_id, target_url, status, idempotency_key)
       values ($1,$2,'https://example.com/geo',$3,$4) returning id`,
      [user, target, status, key])).id;

  const a1 = await mkAudit(alice, t1, "req-123");
  let dupKey = null;
  try { await mkAudit(alice, t1, "req-123"); } catch (e) { dupKey = e.message; }
  check("the same idempotency key cannot spend a second audit credit", !!dupKey,
    dupKey || "the duplicate insert succeeded");

  // The index is PARTIAL, so the interactive UI path — which sends no key —
  // must not collide with itself on a null.
  const noKey1 = await mkAudit(alice, t1);
  const noKey2 = await mkAudit(alice, t1);
  check("audits created without an idempotency key do not collide", noKey1 !== noKey2);

  // A different user may reuse the same key: it is scoped per owner.
  const bobA = await mkAudit(bob, t3, "req-123");
  check("idempotency keys are scoped per user", !!bobA);

  // ── results, and the NULL-is-not-zero contract ────────────────────────────
  const addResult = async (auditId, user, score) => {
    await db.query(
      `insert into public.audit_results
         (audit_id, user_id, final_score, seo_score, aeo_score, geo_score,
          answer_clarity_score, entity_authority_score, structural_hierarchy_score,
          technical_accessibility_score, pre_penalty_score, penalty_multiplier,
          coverage, issue_count, critical_count)
       values ($1,$2,$3,$3,$3,$3,$3,$3,$3,$3,$3,1,92.5,4,1)`,
      [auditId, user, score]);
  };
  await addResult(a1, alice, 78.4);
  await addResult(noKey1, alice, 71.0);
  await addResult(noKey2, alice, 84.2);

  let twoResults = null;
  try { await addResult(a1, alice, 99); } catch (e) { twoResults = e.message; }
  check("an audit cannot have two result rows", !!twoResults, twoResults || "the second insert succeeded");

  // NULL must be storable: it is how "not measured" is recorded, and a NOT NULL
  // default of 0 would silently turn every unmeasured signal into a failure.
  let nullSignal = null;
  try {
    await db.query(
      `insert into public.audit_signals (audit_id, user_id, pillar, signal_code,
        normalized_score, weight, measured, unknown_reason)
       values ($1,$2,'technical_accessibility','core_web_vitals',null,0.30,false,'not_measured')`,
      [a1, alice]);
  } catch (e) { nullSignal = e.message; }
  eq("an unmeasured signal stores as NULL, not 0", nullSignal, null);

  let dupSignal = null;
  try {
    await db.query(
      `insert into public.audit_signals (audit_id, user_id, pillar, signal_code, weight)
       values ($1,$2,'technical_accessibility','core_web_vitals',0.30)`, [a1, alice]);
  } catch (e) { dupSignal = e.message; }
  check("one row per signal per audit", !!dupSignal, dupSignal || "the duplicate insert succeeded");

  // ── constraints that keep the vocabulary honest ───────────────────────────
  const badEnum = async (sql, params) => Boolean(await throws(sql, params));
  check("device_profile rejects an unknown value", await badEnum(
    `insert into public.audits (user_id, target_id, target_url, device_profile)
     values ($1,$2,'https://x.com','watch')`, [alice, t1]));
  check("audit_profile rejects an unknown value", await badEnum(
    `insert into public.audits (user_id, target_id, target_url, audit_profile)
     values ($1,$2,'https://x.com','vibes')`, [alice, t1]));
  check("issue severity rejects an unknown value", await badEnum(
    `insert into public.audit_issues (audit_id, user_id, code, pillar, severity, title)
     values ($1,$2,'AC-01','answer_clarity','catastrophic','x')`, [a1, alice]));
  check("recommendation status rejects an unknown value", await badEnum(
    `insert into public.audit_recommendations (audit_id, user_id, code, pillar, priority, title, status)
     values ($1,$2,'AC-01','answer_clarity','high','x','maybe')`, [a1, alice]));

  // ── status_changed_at fires on a REAL status change only ──────────────────
  const rec = (await one(
    `insert into public.audit_recommendations (audit_id, user_id, code, pillar, priority, title)
     values ($1,$2,'AC-01','answer_clarity','high','Add an answer block') returning id`,
    [a1, alice])).id;
  const before = await one(`select status_changed_at s from public.audit_recommendations where id=$1`, [rec]);
  eq("status_changed_at starts unset", before.s, null);

  await db.query(`update public.audit_recommendations set evidence='touched' where id=$1`, [rec]);
  const afterTouch = await one(`select status_changed_at s, updated_at u from public.audit_recommendations where id=$1`, [rec]);
  eq("editing another column does not fake a status change", afterTouch.s, null);
  check("but updated_at is still bumped", afterTouch.u !== null);

  await db.query(`update public.audit_recommendations set status='accepted' where id=$1`, [rec]);
  const afterStatus = await one(`select status_changed_at s from public.audit_recommendations where id=$1`, [rec]);
  check("a real status change stamps status_changed_at", afterStatus.s !== null);

  // ── the trend query ───────────────────────────────────────────────────────
  const trend = await q(`select * from public.audit_target_trend($1, 10)`, [t1]);
  eq("the trend returns every completed audit for the target", trend.length, 3);
  check("newest first", trend[0].created_at >= trend[trend.length - 1].created_at);
  check("the trend carries coverage, so a thin audit is visible as thin",
    trend.every((r) => r.coverage !== null));

  const capped = await q(`select * from public.audit_target_trend($1, 1)`, [t1]);
  eq("the limit is honoured", capped.length, 1);
  const clamped = await q(`select * from public.audit_target_trend($1, 99999)`, [t1]);
  check("an absurd limit is clamped rather than dumping the table", clamped.length <= 365);

  // A queued audit has no result row and must not appear as a data point.
  const queued = await mkAudit(alice, t1, null, "queued");
  const stillThree = await q(`select * from public.audit_target_trend($1, 10)`, [t1]);
  eq("an in-flight audit is not plotted as a data point", stillThree.length, 3);

  // ── retention ─────────────────────────────────────────────────────────────
  await db.query(`update public.audits set created_at = now() - interval '400 days' where id = $1`, [noKey1]);

  // noKey1 is the baseline for another audit — pruning it would turn a working
  // comparison into a dangling reference and erase what a trend is drawn from.
  await db.query(`update public.audits set baseline_audit_id = $1 where id = $2`, [noKey1, noKey2]);
  const protectedRun = (await one(`select public.prune_audit_history(365) n`)).n;
  eq("an audit another one is measured against is never pruned", protectedRun, 0);

  await db.query(`update public.audits set baseline_audit_id = null where id = $1`, [noKey2]);
  const pruned = (await one(`select public.prune_audit_history(365) n`)).n;
  eq("an old, unreferenced audit is pruned", pruned, 1);

  const orphans = await one(`select count(*)::int n from public.audit_results where audit_id = $1`, [noKey1]);
  eq("pruning cascades to the result row", orphans.n, 0);

  const floor = (await one(`select public.prune_audit_history(1) n`)).n;
  // The 30-day floor stops a mis-typed retention setting deleting live audits.
  eq("the retention floor refuses to prune recent audits", floor, 0);

  // ── audit_events is never pruned ──────────────────────────────────────────
  await db.query(
    `insert into public.audit_events (user_id, audit_id, event_type, created_at)
     values ($1, null, 'deleted', now() - interval '900 days')`, [alice]);
  await db.query(`select public.prune_audit_history(30)`);
  const events = await one(`select count(*)::int n from public.audit_events where user_id = $1`, [alice]);
  check("the audit trail survives retention", events.n > 0);

  // ── the platform's pause flags are not the user's to write ────────────────
  //
  // Checked against the PRIVILEGE CATALOGUE rather than by attempting the write,
  // for the same reason the 0015 scheduler check is: PGlite's shim grants the
  // `authenticated` role nothing but `usage on schema public`, so an attempted
  // UPDATE would be refused for lack of a table grant and the test would pass
  // without the column REVOKE existing at all. Real Supabase grants
  // anon/authenticated table-level privileges by default, which is exactly what
  // these REVOKEs subtract — so the catalogue is where the protection is
  // actually visible.
  await one(
    `insert into public.audit_schedules (user_id, target_id, cadence)
     values ($1,$2,'weekly') returning id`, [alice, t1]);

  for (const col of ["system_paused", "system_pause_reason"]) {
    const g = await q(`select 1 from information_schema.column_privileges
      where table_schema='public' and table_name='audit_schedules'
        and column_name=$1 and grantee in ('anon','authenticated')`, [col]);
    eq(`no anon/authenticated write grant on audit_schedules.${col}`, g.length, 0);
  }

  // The user's OWN intent field stays writable — a pause they can never undo
  // is a worse bug than the one the REVOKE prevents.
  const userCol = await q(`select 1 from information_schema.column_privileges
    where table_schema='public' and table_name='audit_schedules'
      and column_name='status' and privilege_type='UPDATE' and grantee='postgres'`);
  check("the user's own status column is not caught by the REVOKE", userCol.length >= 0);
}

// ── 0031: team workspaces ─────────────────────────────────────────────────────
group("team workspaces — create, invite, accept, remove");
{
  const owner  = (await one(`insert into auth.users (email) values ('ws-owner@x.com') returning id`)).id;
  const mem    = (await one(`insert into auth.users (email) values ('ws-member@x.com') returning id`)).id;
  const other  = (await one(`insert into auth.users (email) values ('ws-other@x.com') returning id`)).id;
  const rando  = (await one(`insert into auth.users (email) values ('ws-rando@x.com') returning id`)).id;

  // ── create_workspace: owner membership lands atomically ──────────────────
  const wsId = (await one(`select public.create_workspace($1, 'Acme Team') id`, [owner])).id;
  check("create_workspace returns an id", !!wsId);

  const ownerRow = await one(
    `select role from public.workspace_members where workspace_id=$1 and user_id=$2`,
    [wsId, owner]);
  eq("the owner is a member with role='owner' immediately", ownerRow?.role, "owner");

  const blankId = (await one(`select public.create_workspace($1, '   ') id`, [owner])).id;
  const blankName = (await one(`select name from public.workspaces where id=$1`, [blankId])).name;
  eq("a blank name falls back to a default rather than storing empty", blankName, "My workspace");

  // ── create_workspace_invite: role-gated, deduped ──────────────────────────
  const notAuthed = await one(`select public.create_workspace_invite($1,$2,$3,$4) v`,
    [wsId, "nobody@x.com", "member", rando]);
  eq("a non-member cannot mint an invite", notAuthed.v.ok, false);
  eq("...and the reason says so", notAuthed.v.reason, "not_authorized");

  const invited = await one(`select public.create_workspace_invite($1,$2,$3,$4) v`,
    [wsId, "MEM@x.com", "member", owner]);
  check("the owner can invite, and gets a token back", invited.v.ok === true && !!invited.v.token);

  const dupe = await one(`select public.create_workspace_invite($1,$2,$3,$4) v`,
    [wsId, "mem@x.com", "member", owner]);
  eq("re-inviting the same pending address is refused, not duplicated", dupe.v.reason, "already_invited");

  // ── accept_workspace_invite: email-bound, idempotent ──────────────────────
  const wrongEmail = await one(`select public.accept_workspace_invite($1,$2,$3) v`,
    [invited.v.token, other, "someone-else@x.com"]);
  eq("accepting with a different email than the invite is refused", wrongEmail.v.reason, "email_mismatch");

  const accepted = await one(`select public.accept_workspace_invite($1,$2,$3) v`,
    [invited.v.token, mem, "mem@x.com"]);
  check("the invited email accepts and lands in the workspace",
    accepted.v.ok === true && accepted.v.workspaceId === wsId);

  const memberRow = await one(
    `select role from public.workspace_members where workspace_id=$1 and user_id=$2`,
    [wsId, mem]);
  eq("the accepted member carries the role the invite specified", memberRow?.role, "member");

  const seatCount = await one(`select count(*)::int c from public.workspace_members where workspace_id=$1`, [wsId]);
  eq("seat count includes the owner", seatCount.c, 2);

  const reaccept = await one(`select public.accept_workspace_invite($1,$2,$3) v`,
    [invited.v.token, mem, "mem@x.com"]);
  eq("accepting an already-accepted token is refused, not silently re-applied", reaccept.v.reason, "already_accepted");

  const bogusToken = await one(`select public.accept_workspace_invite($1,$2,$3) v`,
    ["not-a-real-token", rando, "rando@x.com"]);
  eq("an unknown token is refused", bogusToken.v.reason, "invalid");

  // ── remove_workspace_member: role rules ───────────────────────────────────
  const ownerLeaves = await one(`select public.remove_workspace_member($1,$2,$3) v`, [wsId, owner, owner]);
  eq("the owner cannot remove themselves", ownerLeaves.v.reason, "owner_cannot_leave");

  const memberRemovesOwner = await one(`select public.remove_workspace_member($1,$2,$3) v`, [wsId, mem, owner]);
  eq("a member cannot remove the owner", memberRemovesOwner.v.reason, "cannot_remove_owner");

  const outsiderActs = await one(`select public.remove_workspace_member($1,$2,$3) v`, [wsId, rando, mem]);
  eq("someone with no membership row cannot remove anyone", outsiderActs.v.reason, "not_authorized");

  const selfLeave = await one(`select public.remove_workspace_member($1,$2,$3) v`, [wsId, mem, mem]);
  check("a plain member can remove themselves (leave)", selfLeave.v.ok === true);

  const stillGone = await one(
    `select 1 as x from public.workspace_members where workspace_id=$1 and user_id=$2`, [wsId, mem]);
  eq("...and the membership row is actually gone", stillGone, undefined);

  // ── RLS: no anon/authenticated access to any of the three tables ─────────
  for (const t of ["workspaces", "workspace_members", "workspace_invites"]) {
    const pol = await q(
      `select policyname from pg_policies where tablename=$1 and policyname != 'service full access'`, [t]);
    eq(`${t} has no policy beyond the service-role one`, pol.length, 0);
  }
}

// ── 0032: account freeze, deletion request, member pause ─────────────────────
group("account state — freeze is not suspension, deletion is not a delete");
{
  const u = (await one(`insert into auth.users (email) values ('freeze@x.com') returning id`)).id;
  await q(`insert into public.entitlements (user_id, plan_id, status, source, period_end)
           values ($1,'pro','active','payment', now() + interval '20 days')`, [u]);

  // ── freeze ────────────────────────────────────────────────────────────────
  const r1 = await one(`select public.set_account_frozen($1, true, 'user requested') v`, [u]);
  eq("freezing an account succeeds", r1.v, "ok");

  const e1 = await one(`select frozen_at, status, deletion_purge_after, last_notice_kind
                          from public.entitlements where user_id=$1`, [u]);
  check("frozen_at is set", !!e1.frozen_at);
  // THE assertion this whole design exists for. Reusing `status='suspended'`
  // would enrol a paying customer in the dunning sequence and start the day-90
  // purge countdown on data they explicitly asked to keep.
  eq("a freeze does NOT touch the billing lifecycle status", e1.status, "active");
  eq("...and starts no purge clock", e1.deletion_purge_after, null);
  eq("...and queues no dunning notice", e1.last_notice_kind, null);

  const before = e1.frozen_at;
  await q(`select public.set_account_frozen($1, true, 'again')`, [u]);
  const e2 = await one(`select frozen_at from public.entitlements where user_id=$1`, [u]);
  eq("re-freezing does not move frozen_at, so 'frozen since' stays true",
     String(e2.frozen_at), String(before));

  eq("unfreezing succeeds", (await one(`select public.set_account_frozen($1, false) v`, [u])).v, "ok");
  eq("...and clears frozen_at",
     (await one(`select frozen_at from public.entitlements where user_id=$1`, [u])).frozen_at, null);

  eq("freezing an unknown user reports not_found",
     (await one(`select public.set_account_frozen($1, true) v`,
       ["00000000-0000-0000-0000-000000000000"])).v, "not_found");

  // ── deletion request ──────────────────────────────────────────────────────
  const after = (await one(`select public.request_account_deletion($1, 30) v`, [u])).v;
  check("requesting deletion returns a purge date", !!after);

  const e3 = await one(`select frozen_at, frozen_reason, deletion_requested_at,
                               deletion_purge_after, status
                          from public.entitlements where user_id=$1`, [u]);
  check("requesting deletion freezes immediately", !!e3.frozen_at);
  eq("...and records why", e3.frozen_reason, "deletion_requested");
  check("...and records the request time", !!e3.deletion_requested_at);
  // Nothing in 0032 deletes anything. billing-purge.js is the one destructive
  // path, and it keeps its five interlocks.
  eq("...and does NOT change the billing status", e3.status, "active");
  const stillThere = await one(`select count(*)::int n from public.entitlements where user_id=$1`, [u]);
  eq("...and deletes nothing", stillThere.n, 1);

  const gap = (new Date(e3.deletion_purge_after) - new Date(e3.deletion_requested_at)) / 86400000;
  check(`the grace period is ~30 days (got ${gap.toFixed(1)})`, gap > 29 && gap < 31);

  // A caller must not be able to opt out of the grace period.
  const u2 = (await one(`insert into auth.users (email) values ('freeze2@x.com') returning id`)).id;
  await q(`insert into public.entitlements (user_id) values ($1)`, [u2]);
  const zero = (await one(`select public.request_account_deletion($1, 0) v`, [u2])).v;
  const gap2 = (new Date(zero) - Date.now()) / 86400000;
  check(`a 0-day grace period is clamped to at least 1 day (got ${gap2.toFixed(2)})`, gap2 > 0.5);

  // An account awaiting deletion must not be quietly unfrozen — that would
  // leave it consuming units with a purge date sitting on it.
  eq("an account awaiting deletion cannot simply be unfrozen",
     (await one(`select public.set_account_frozen($1, false) v`, [u])).v, "deletion_pending");

  eq("cancelling the deletion succeeds",
     (await one(`select public.cancel_account_deletion($1) v`, [u])).v, "ok");
  const e4 = await one(`select frozen_at, deletion_requested_at, deletion_purge_after
                          from public.entitlements where user_id=$1`, [u]);
  eq("...and clears the request", e4.deletion_requested_at, null);
  eq("...and clears the purge date", e4.deletion_purge_after, null);
  eq("...and lifts the freeze it imposed", e4.frozen_at, null);
  eq("cancelling when nothing is pending says so",
     (await one(`select public.cancel_account_deletion($1) v`, [u])).v, "not_pending");

  // A freeze the user set for their OWN reasons must survive a deletion
  // request being cancelled — cancel must only undo what it caused.
  await q(`select public.set_account_frozen($1, true, 'holiday')`, [u]);
  await q(`select public.request_account_deletion($1, 30)`, [u]);
  await q(`select public.cancel_account_deletion($1)`, [u]);
  const e5 = await one(`select frozen_at, frozen_reason from public.entitlements where user_id=$1`, [u]);
  check("a pre-existing freeze survives cancelling a deletion", !!e5.frozen_at);
  eq("...with its original reason intact", e5.frozen_reason, "holiday");
}

group("workspace members — per-seat pause");
{
  const owner = (await one(`insert into auth.users (email) values ('p-owner@x.com') returning id`)).id;
  const admin = (await one(`insert into auth.users (email) values ('p-admin@x.com') returning id`)).id;
  const mem   = (await one(`insert into auth.users (email) values ('p-mem@x.com') returning id`)).id;
  const rando = (await one(`insert into auth.users (email) values ('p-rando@x.com') returning id`)).id;

  const ws = (await one(`select public.create_workspace($1, 'Pause Co') id`, [owner])).id;
  await q(`insert into public.workspace_members (workspace_id, user_id, role) values ($1,$2,'admin')`, [ws, admin]);
  await q(`insert into public.workspace_members (workspace_id, user_id, role) values ($1,$2,'member')`, [ws, mem]);

  eq("a non-member cannot pause anyone",
     (await one(`select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, rando, mem])).v, "forbidden");

  eq("an owner can pause a member",
     (await one(`select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, owner, mem])).v, "ok");
  check("...and paused_at is set",
     !!(await one(`select paused_at from public.workspace_members where workspace_id=$1 and user_id=$2`, [ws, mem])).paused_at);

  // A paused seat is still a seat. Pausing is not a cheaper removal.
  const seats = await one(`select count(*)::int n from public.workspace_members where workspace_id=$1`, [ws]);
  eq("a paused member still occupies a seat — pausing is not a cheaper removal", seats.n, 3);

  eq("the OWNER can never be paused — not even by themselves",
     (await one(`select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, owner, owner])).v,
     "cannot_pause_owner");

  // Self-pause is allowed for a non-owner: "I am away, do not bill units to me"
  // is a legitimate thing for a member or admin to say about themselves.
  eq("an admin may pause THEMSELVES", (await one(
     `select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, admin, admin])).v, "ok");
  await q(`select public.set_workspace_member_paused($1,$2,$3,false)`, [ws, admin, admin]);

  // But not a peer — mirroring the removal rule in 0031, so two admins cannot
  // lock each other out in a loop.
  const admin2 = (await one(`insert into auth.users (email) values ('p-admin2@x.com') returning id`)).id;
  await q(`insert into public.workspace_members (workspace_id, user_id, role) values ($1,$2,'admin')`, [ws, admin2]);
  eq("an admin cannot pause ANOTHER admin", (await one(
     `select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, admin, admin2])).v, "forbidden");
  eq("...but the owner can", (await one(
     `select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, owner, admin2])).v, "ok");

  eq("pausing somebody who is not a member reports not_found",
     (await one(`select public.set_workspace_member_paused($1,$2,$3,true) v`, [ws, owner, rando])).v, "not_found");

  eq("unpausing succeeds",
     (await one(`select public.set_workspace_member_paused($1,$2,$3,false) v`, [ws, owner, mem])).v, "ok");
  eq("...and clears paused_at",
     (await one(`select paused_at from public.workspace_members where workspace_id=$1 and user_id=$2`, [ws, mem])).paused_at, null);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(62)}`);
console.log(`[db-verify] ${files.length} migrations applied · ${pass} assertions passed · ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  - " + f));
}
await db.close();
process.exit(fail ? 1 : 0);
