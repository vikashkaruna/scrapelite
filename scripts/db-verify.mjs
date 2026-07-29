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
const EXPECT = {
  tables: 29,
  functions: 10,
  triggers: 2,
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
for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
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
    public.plan_rank('free') f, public.plan_rank(null) n, public.plan_rank('suspended') x,
    public.plan_rank('AGENCY') u`);
  eq("agency=5", r.a, 5);
  eq("business=4", r.b, 4);
  eq("pro=developer=3", [r.p, r.d], [3, 3]);
  eq("select=2", r.s, 2);
  eq("free=1", r.f, 1);
  eq("null ranks as free", r.n, 1);
  eq("unknown plan ranks 0 so it never wins a merge", r.x, 0);
  eq("case-insensitive", r.u, 5);
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

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(62)}`);
console.log(`[db-verify] ${files.length} migrations applied · ${pass} assertions passed · ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  - " + f));
}
await db.close();
process.exit(fail ? 1 : 0);
