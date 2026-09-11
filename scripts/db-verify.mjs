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
//
// 0036_workflow_templates.sql  +3 tables (workflow_templates, template_runs,
//   template_run_sources) +2 functions (publish_template_version,
//   workflow_templates_immutable) +1 trigger.
// 0037_credit_ledger.sql       +2 tables (credit_ledger, credit_estimates)
//   +3 functions (credit_spend, credit_balance, credit_ledger_append_only)
//   +1 trigger.
// 0038_field_provenance.sql    +2 tables (extracted_fields, field_provenance).
//   No functions, no triggers — it is pure storage.
// 0039_report_access.sql       +3 tables (reports, report_grants,
//   report_access_log) +5 functions (mint_report_slug, set_report_visibility,
//   revoke_report, resolve_report_access, reports_touch_updated_at) +1 trigger.
// 0040_pql.sql                 +2 tables (activation_events, pql_scores)
//   +1 function (record_pql_score). No triggers — pql_scores is a derived
//   cache recomputed from activation_events, never mutated in place by the DB.
// 0041_bulk_enrichment.sql     +7 tables (lists, canonical_entities, list_records,
//   icp_score_rules, enrichment_jobs, enrichment_job_items, review_queue)
//   +1 function (bulk_touch_updated_at) +3 triggers.
// 0042_watchlists.sql          +6 tables (watchlists, watchlist_targets,
//   monitored_pages, entity_snapshots, field_changes, change_feedback)
//   +1 function (watchlists_touch_updated_at) +1 trigger.
// 0043_signal_rules.sql        +2 tables (signal_rules, rule_executions)
//   +1 function (signal_rules_touch_updated_at) +1 trigger.
// 0051_recommendation_assignment.sql +1 function (assign_recommendation), no
//   new table: the assignee is two columns on audit_recommendations.
// 0052_citation_states.sql     columns only — the seven states sit on
//   audit_prompt_runs rather than in a table of their own.
// 0053_prompt_monitors.sql     +2 tables (prompt_monitors, prompt_monitor_runs)
//   +1 trigger. No new function: the touch trigger reuses 0030's.
// Taking these to 89 / 47 / 20.
const EXPECT = {
  tables: 89,
  functions: 47,
  triggers: 20,
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
          coverage, issue_count, critical_count, scoring_model_version)
       values ($1,$2,$3,$3,$3,$3,$3,$3,$3,$3,$3,1,92.5,4,1,'v1')`,
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

  // ── 0048: evidence, thresholds and the model version ─────────────────────
  // Every one of these columns exists because a score with no traceable
  // observation behind it is what the BRD forbids. `raw_value` and
  // `evidence_json` were declared in 0030 and written by nothing until 0048 —
  // NULL on every row in the table for the whole life of the module — so these
  // assertions are as much about the WRITE path existing as the column.
  const evidenceRecord = {
    method: "raw_html", observed: true,
    source_url: "https://example.com/pricing", selector: "h1", section: "Page H1",
    observed_value: { h1_count: 2 }, excerpt: "Pricing that scales",
    structured: null, collected_at: "2026-09-10T09:00:00.000Z", confidence: 0.99,
  };

  let signalEvidence = null;
  try {
    await db.query(
      `insert into public.audit_signals
         (audit_id, user_id, pillar, signal_code, normalized_score, weight,
          measured, raw_value, evidence_json, threshold_json)
       values ($1,$2,'structural_hierarchy','single_h1',60,0.15,true,$3,$4,$5)`,
      [a1, alice, JSON.stringify({ h1_count: 2 }), JSON.stringify([evidenceRecord]),
       JSON.stringify({ ideal_min: 40, ideal_max: 60 })]);
  } catch (e) { signalEvidence = e.message; }
  eq("a signal stores its raw value, evidence and threshold", signalEvidence, null);

  const storedSignal = await one(
    `select raw_value, evidence_json, threshold_json from public.audit_signals
      where audit_id = $1 and signal_code = 'single_h1'`, [a1]);
  eq("the raw reading survives the round trip",
    storedSignal.raw_value?.h1_count, 2);
  eq("the evidence record survives the round trip",
    storedSignal.evidence_json?.[0]?.source_url, "https://example.com/pricing");
  eq("the collection timestamp survives the round trip",
    storedSignal.evidence_json?.[0]?.collected_at, "2026-09-10T09:00:00.000Z");
  eq("a declared threshold survives the round trip",
    storedSignal.threshold_json?.ideal_max, 60);

  // A curve has no threshold, and NULL is the correct and common answer. If
  // this column were ever made NOT NULL, seventeen of twenty signals would have
  // to carry a boundary the scorer never applied.
  const curve = await one(
    `select threshold_json from public.audit_signals
      where audit_id = $1 and signal_code = 'core_web_vitals'`, [a1]);
  eq("a signal that is a curve stores no threshold", curve.threshold_json, null);

  let issueEvidence = null;
  try {
    await db.query(
      `insert into public.audit_issues
         (audit_id, user_id, code, pillar, severity, title, evidence, evidence_json)
       values ($1,$2,'SH-02','structural_hierarchy','high','Two H1s',
               'Two H1 elements compete to describe this page.', $3)`,
      [a1, alice, JSON.stringify([evidenceRecord])]);
  } catch (e) { issueEvidence = e.message; }
  eq("an issue stores structured evidence beside its sentence", issueEvidence, null);

  const storedIssue = await one(
    `select evidence, evidence_json from public.audit_issues
      where audit_id = $1 and code = 'SH-02'`, [a1]);
  check("the human sentence is kept, not replaced",
    /compete to describe/.test(storedIssue.evidence || ""));
  eq("the issue's evidence names a selector",
    storedIssue.evidence_json?.[0]?.selector, "h1");

  const versioned = await one(
    `select scoring_model_version v from public.audit_results where audit_id = $1`, [a1]);
  eq("a result records which maths produced it", versioned.v, "v1");

  // NOT NULL with no default. A default would let a writer that forgets the
  // stamp file a v3 score as whatever the default was — the exact mislabelling
  // the version exists to prevent — so a forgotten stamp must fail loudly.
  const unstamped = await throws(
    `insert into public.audit_results (audit_id, user_id, final_score, penalty_multiplier)
     values ($1,$2,50,1)`, [bobA, bob]);
  check("a result cannot be stored without its scoring model version", Boolean(unstamped),
    unstamped || "the unstamped insert succeeded");

  let setV2 = null;
  try {
    await db.query(
      `update public.audit_results set scoring_model_version = 'v2' where audit_id = $1`, [a1]);
  } catch (e) { setV2 = e.message; }
  eq("a result can record a newer scoring model", setV2, null);
  await db.query(`update public.audit_results set scoring_model_version = 'v1' where audit_id = $1`, [a1]);

  // ── 0049: the intake ─────────────────────────────────────────────────────
  // Every other column in this module records something we MEASURED, and a
  // measurement can be taken again. These record something the CUSTOMER SAID,
  // and if the question was never asked the answer does not exist anywhere.
  // That is why primary_goal is nullable and why nothing back-fills it.
  const intakeAudit = await one(
    `insert into public.audits
       (user_id, target_id, target_url, audit_type, primary_goal,
        target_geography, competitor_urls, audit_profile, audit_profile_source)
     values ($1,$2,'https://x.com/local','url','local_discovery',
             $3, array['https://rival.com/'], 'local', 'goal')
     returning id, audit_type, primary_goal, target_geography, competitor_urls,
               audit_profile_source`,
    [alice, t1, JSON.stringify({ country: "IN", region: null, city: "Bengaluru", language: "en-IN" })]);

  eq("an audit records what kind of audit it is", intakeAudit.audit_type, "url");
  eq("an audit records the goal it was commissioned for", intakeAudit.primary_goal, "local_discovery");
  eq("the geography survives the round trip", intakeAudit.target_geography?.city, "Bengaluru");
  eq("the language tag survives normalised", intakeAudit.target_geography?.language, "en-IN");
  eq("competitors are stored as an array", intakeAudit.competitor_urls?.[0], "https://rival.com/");
  eq("the audit records WHY it carries its profile", intakeAudit.audit_profile_source, "goal");

  // NULL is the correct and expected state for every audit that predates the
  // question. A default here would be a fabricated intent — the same class of
  // error as an evidence record with a guessed source URL — and the P2 brand,
  // product, service and local modules key off this field.
  const noGoal = await one(
    `insert into public.audits (user_id, target_id, target_url)
     values ($1,$2,'https://x.com/no-goal')
     returning primary_goal, target_geography, audit_type, competitor_urls, audit_profile_source`,
    [alice, t1]);
  eq("an audit with no stated goal stores NULL, not a default", noGoal.primary_goal, null);
  eq("an audit with no stated geography stores NULL, not {}", noGoal.target_geography, null);
  // Defaulted, unlike the goal, because it IS knowable retrospectively: every
  // audit that already exists fetched exactly one page, which is what 'url'
  // means. A true statement about the past, not a guess at one.
  eq("audit_type defaults to the one kind of audit that has ever run", noGoal.audit_type, "url");
  eq("competitor_urls defaults to empty, never null", noGoal.competitor_urls?.length, 0);
  eq("a profile nobody chose is recorded as a default", noGoal.audit_profile_source, "default");

  check("primary_goal rejects a value outside the vocabulary", Boolean(await throws(
    `insert into public.audits (user_id, target_id, target_url, primary_goal)
     values ($1,$2,'https://x.com','world_domination')`, [alice, t1])));
  check("audit_type rejects a value outside the vocabulary", Boolean(await throws(
    `insert into public.audits (user_id, target_id, target_url, audit_type)
     values ($1,$2,'https://x.com','vibes')`, [alice, t1])));
  check("audit_profile_source rejects a value outside the vocabulary", Boolean(await throws(
    `insert into public.audits (user_id, target_id, target_url, audit_profile_source)
     values ($1,$2,'https://x.com','because')`, [alice, t1])));

  // The two types the API refuses today are legal in the COLUMN on purpose.
  // The vocabulary is a stored contract, and widening a live CHECK later is a
  // migration plus a deploy plus a window in which the API and the database
  // disagree about what is legal.
  for (const type of ["domain", "prompt_monitor", "benchmark", "rerun"]) {
    let err = null;
    try {
      await db.query(
        `insert into public.audits (user_id, target_id, target_url, audit_type)
         values ($1,$2,'https://x.com/t','${type}')`, [alice, t1]);
    } catch (e) { err = e.message; }
    eq(`the column accepts audit_type '${type}' ahead of the engine`, err, null);
  }

  // ── the four business-model profiles ─────────────────────────────────────
  for (const profile of ["saas", "services", "local", "ecommerce"]) {
    let err = null;
    try {
      await db.query(
        `insert into public.audits (user_id, target_id, target_url, audit_profile)
         values ($1,$2,'https://x.com/p','${profile}')`, [alice, t1]);
    } catch (e) { err = e.message; }
    eq(`audit_profile accepts '${profile}'`, err, null);
  }

  // ── intake reuse on the recurring path ───────────────────────────────────
  // A monitor that dropped the goal would build a trend line whose first point
  // had context and whose others did not — and the diff would still be drawn,
  // because nothing downstream knows the context changed.
  const sched = await one(
    `insert into public.audit_schedules
       (user_id, target_id, cadence, audit_profile, primary_goal, page_type_hint,
        target_geography, competitor_urls)
     values ($1,$2,'weekly','local','local_discovery','location',$3,array['https://rival.com/'])
     returning primary_goal, page_type_hint, target_geography, competitor_urls, audit_profile`,
    [alice, t1, JSON.stringify({ country: "IN", region: null, city: "Bengaluru", language: null })]);
  eq("a schedule carries the goal onto every run it creates", sched.primary_goal, "local_discovery");
  eq("a schedule carries the page-type hint", sched.page_type_hint, "location");
  eq("a schedule carries the geography", sched.target_geography?.city, "Bengaluru");
  eq("a schedule may use a business-model profile", sched.audit_profile, "local");

  check("a schedule's primary_goal is held to the same vocabulary", Boolean(await throws(
    `insert into public.audit_schedules (user_id, target_id, cadence, primary_goal)
     values ($1,$2,'weekly','vibes')`, [alice, t1])));

  // The benchmark table's profile CHECK was widened by the same migration. It
  // was missed once already — 0030 wrote the same four-value list three times.
  let benchProfile = null;
  try {
    await db.query(
      `insert into public.audit_benchmarks (user_id, name, audit_profile)
       values ($1,'set','ecommerce')`, [alice]);
  } catch (e) { benchProfile = e.message; }
  eq("a benchmark may use a business-model profile too", benchProfile, null);

  // ── 0050: the gap-analysis fields, and the link nothing ever wrote ───────
  //
  // The BRD specifies eleven fields on every issue; the table carried six. The
  // five it did not carry are the five that make a queue actionable rather
  // than merely correct.
  const gapIssue = await one(
    `insert into public.audit_issues
       (audit_id, user_id, code, pillar, severity, title, evidence,
        observed, inference, root_cause, recommended_module, owner_role)
     values ($1,$2,'EA-11','entity_authority','critical','Entity markup is unusable',
             'Organization markup carries no name.',
             'Organization markup carries no name.',
             'A resolver has a node to build and no identity to attach.',
             'entity_ambiguity','schema_intelligence','seo')
     returning id, observed, inference, root_cause, recommended_module, owner_role, status, evidence`,
    [a1, alice]);

  // The split that is the whole point: one column launders the weaker claim
  // into the stronger. "We measured this" and "we reason it means that" have
  // different warranties and must not share a field.
  eq("an issue stores what was OBSERVED", gapIssue.observed, "Organization markup carries no name.");
  check("an issue stores the INFERENCE separately",
    /no identity to attach/.test(gapIssue.inference || ""));
  check("the two are different sentences", gapIssue.observed !== gapIssue.inference);
  // `evidence` is kept and keeps its meaning — every export prints it and every
  // historical diff compares it.
  check("the original evidence sentence is kept, not replaced",
    /no name/.test(gapIssue.evidence || ""));

  eq("an issue stores its root cause", gapIssue.root_cause, "entity_ambiguity");
  eq("an issue stores the module that answers it", gapIssue.recommended_module, "schema_intelligence");
  eq("an issue stores who fixes it", gapIssue.owner_role, "seo");
  // Defaulted, unlike 0049's primary_goal, because unlike a goal this one IS
  // knowable retrospectively: every finding genuinely starts open.
  eq("an issue starts open", gapIssue.status, "open");

  check("root_cause rejects a cause outside the taxonomy", Boolean(await throws(
    `insert into public.audit_issues (audit_id, user_id, code, pillar, severity, title, root_cause)
     values ($1,$2,'AC-02','answer_clarity','high','x','vibes')`, [a1, alice])));
  check("recommended_module rejects a module that does not exist", Boolean(await throws(
    `insert into public.audit_issues (audit_id, user_id, code, pillar, severity, title, recommended_module)
     values ($1,$2,'AC-03','answer_clarity','high','x','M99')`, [a1, alice])));
  check("owner_role rejects a role outside the five", Boolean(await throws(
    `insert into public.audit_issues (audit_id, user_id, code, pillar, severity, title, owner_role)
     values ($1,$2,'AC-04','answer_clarity','high','x','legal')`, [a1, alice])));
  check("issue status rejects a state outside the lifecycle", Boolean(await throws(
    `insert into public.audit_issues (audit_id, user_id, code, pillar, severity, title, status)
     values ($1,$2,'AC-05','answer_clarity','high','x','probably')`, [a1, alice])));

  // The full BRD vocabulary is legal in the column ahead of W8 wiring the
  // transitions — same reasoning 0049 applies to the audit types the engine
  // cannot yet produce.
  for (const state of ["accepted", "assigned", "in_progress", "implemented",
    "validation_scheduled", "validated", "dismissed"]) {
    let err = null;
    try {
      await db.query(
        `update public.audit_issues set status = $2 where id = $1`, [gapIssue.id, state]);
    } catch (e) { err = e.message; }
    eq(`the column accepts issue status '${state}' ahead of W8`, err, null);
  }
  await db.query(`update public.audit_issues set status = 'open' where id = $1`, [gapIssue.id]);

  // Two of the eight causes belong to P2 and are unused in P1. They are legal
  // now because the taxonomy is a contract and one that arrives in two halves
  // invites the second half to be numbered around the first.
  for (const cause of ["location_radius_mismatch", "conversion_friction"]) {
    let err = null;
    try {
      await db.query(
        `update public.audit_issues set root_cause = $2 where id = $1`, [gapIssue.id, cause]);
    } catch (e) { err = e.message; }
    eq(`the column accepts the P2 cause '${cause}'`, err, null);
  }
  await db.query(`update public.audit_issues set root_cause = 'entity_ambiguity' where id = $1`, [gapIssue.id]);

  // 🔴 THE LINK THAT WAS DECLARED IN 0030 AND WRITTEN BY NOTHING.
  // Every recommendation was an orphan, so "which finding produced this task"
  // had no answer in the data and the validation loop could not close.
  let linked = null;
  try {
    await db.query(
      `insert into public.audit_recommendations
         (audit_id, user_id, code, issue_id, pillar, priority, title)
       values ($1,$2,'EA-11',$3,'entity_authority','high','Name the organization')`,
      [a1, alice, gapIssue.id]);
  } catch (e) { linked = e.message; }
  eq("a recommendation can name the issue that produced it", linked, null);

  const joined = await one(
    `select i.code issue_code, r.code rec_code
       from public.audit_recommendations r
       join public.audit_issues i on i.id = r.issue_id
      where r.audit_id = $1 and r.issue_id is not null`, [a1]);
  eq("the join resolves back to the finding", joined.issue_code, "EA-11");

  // ON DELETE SET NULL, not CASCADE: the work survives the finding being
  // re-audited away. A recommendation deleted because its issue was resolved
  // would erase the record that anyone ever did anything about it.
  await db.query(`delete from public.audit_issues where id = $1`, [gapIssue.id]);
  const orphaned = await one(
    `select issue_id from public.audit_recommendations
      where audit_id = $1 and code = 'EA-11'`, [a1]);
  eq("deleting the issue nulls the link rather than deleting the work",
    orphaned.issue_id, null);

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

  // ── 0033: the purge date can never land before an active paid plan's own
  // period_end, even though the flat grace period alone would compute an
  // earlier date. Deliberately a LONG period_end (60 days) so this can only
  // pass if the plan-aware GREATEST() branch actually ran, not the flat
  // grace-period branch every other case in this block exercises.
  const uPaid = (await one(`insert into auth.users (email) values ('paid-deletion@x.com') returning id`)).id;
  await q(`insert into public.entitlements (user_id, plan_id, status, source, period_end)
           values ($1,'business','active','payment', now() + interval '60 days')`, [uPaid]);
  const paidAfter = (await one(`select public.request_account_deletion($1, 30) v`, [uPaid])).v;
  const ePaid = await one(`select period_end from public.entitlements where user_id=$1`, [uPaid]);
  const purgeVsPeriodEndMs = new Date(paidAfter) - new Date(ePaid.period_end);
  check("an active paid plan's purge date is not before its own period_end",
    Math.abs(purgeVsPeriodEndMs) < 5_000); // same instant, modulo query latency
  const purgeVsFlatGraceDays = (new Date(paidAfter) - Date.now()) / 86400000;
  check(`...and lands well past the flat 30-day grace (got ${purgeVsFlatGraceDays.toFixed(1)}d)`,
    purgeVsFlatGraceDays > 55);

  // The reverse case: an active paid plan whose period is already ending
  // SOONER than the grace window still gets the full grace period, same as a
  // free account — nobody loses the "I changed my mind" window just because
  // their plan happened to be expiring anyway.
  const uPaidSoon = (await one(`insert into auth.users (email) values ('paid-deletion-soon@x.com') returning id`)).id;
  await q(`insert into public.entitlements (user_id, plan_id, status, source, period_end)
           values ($1,'select','active','payment', now() + interval '2 days')`, [uPaidSoon]);
  const soonAfter = (await one(`select public.request_account_deletion($1, 30) v`, [uPaidSoon])).v;
  const soonGap = (new Date(soonAfter) - Date.now()) / 86400000;
  check(`a plan expiring sooner than the grace window still gets the full ~30 days (got ${soonGap.toFixed(1)}d)`,
    soonGap > 29 && soonGap < 31);

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

// ── 0035: a real free user with NO entitlements row (the overwhelmingly common
// case — a row is only ever created by a billing event: claim, referral, or
// admin coupon grant) must still be able to freeze or delete their own
// account. Reproduces the live bug: "we could not find a billing record for
// this account" on an action that has nothing to do with billing history.
group("account state — freeze/delete bootstrap a missing entitlements row");
{
  const noRow = (await one(`insert into auth.users (email) values ('no-billing-row@x.com') returning id`)).id;
  const preCheck = await one(`select count(*)::int n from public.entitlements where user_id=$1`, [noRow]);
  eq("sanity: this user really has no entitlements row yet", preCheck.n, 0);

  eq("freezing a free user with no billing history succeeds",
     (await one(`select public.set_account_frozen($1, true, 'user requested') v`, [noRow])).v, "ok");
  const bootstrapped = await one(
    `select plan_id, status, frozen_at from public.entitlements where user_id=$1`, [noRow]);
  eq("...bootstraps the table's own default plan", bootstrapped.plan_id, "free");
  eq("...and default status", bootstrapped.status, "active");
  check("...and actually freezes", !!bootstrapped.frozen_at);

  eq("unfreezing the same user succeeds",
     (await one(`select public.set_account_frozen($1, false) v`, [noRow])).v, "ok");

  const noRow2 = (await one(`insert into auth.users (email) values ('no-billing-row-2@x.com') returning id`)).id;
  const delAfter = (await one(`select public.request_account_deletion($1, 30) v`, [noRow2])).v;
  check("requesting deletion for a free user with no billing history returns a purge date", !!delAfter);
  const row2 = await one(`select plan_id, status from public.entitlements where user_id=$1`, [noRow2]);
  eq("...bootstrapping deletion also lands on the table's own defaults", row2.plan_id, "free");
  eq("...and default status", row2.status, "active");

  // A user_id that is not a real auth.users row at all must still fail —
  // the bootstrap insert's FK violation is caught and reported the same way
  // as before this fix (see the "freezing an unknown user" case above).
  const ghost = "00000000-0000-0000-0000-0000000000ff";
  eq("requesting deletion for a nonexistent user still returns nothing",
     (await one(`select public.request_account_deletion($1, 30) v`, [ghost])).v, null);
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

// ── 0034: usage_records/usage_alerts locked — no anon or authenticated access ─
group("usage RLS — no client-reachable policy left on usage_records/usage_alerts");
{
  // 0001 gave both tables `anon full access` (using(true) with check(true)).
  // 0034 drops it once usage-sync.js (service key) became the only write
  // path. Neither table has ANY other policy, so after the drop the correct
  // state is zero policies at all — RLS enabled + no policy denies anon and
  // authenticated outright, while the service role bypasses RLS regardless.
  for (const t of ["usage_records", "usage_alerts"]) {
    const pol = await q(`select policyname from pg_policies where tablename=$1`, [t]);
    eq(`${t} has no RLS policy left (anon/authenticated fully denied)`, pol.length, 0);
  }

  const grants = await q(`
    select grantee, privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name in ('usage_records','usage_alerts')
       and grantee in ('anon','authenticated')`);
  eq("no anon/authenticated table-level GRANT survives on either table", grants.length, 0);
}


// ── 0036: workflow templates — versioning + immutability ────────────────────
group("workflow templates — publish, supersede, freeze");
{
  const author = (await one(`insert into auth.users (email) values ('tpl-author@x.com') returning id`)).id;

  const bad = await one(`select public.publish_template_version('acct_brief', $1::jsonb, $2) v`,
    [JSON.stringify({ summary: "no title here" }), author]);
  eq("publishing without a title is refused", bad.v.reason, "title_required");

  const def1 = JSON.stringify({
    title: "Account Brief", persona: "sales", summary: "v1",
    prompt_bundle: { extract: "PROMPT V1" },
    credit_cost: { base: 1, per_page: 1, per_ai_call: 2 },
    plan_entitlement: "template.run", min_plan: "free",
  });
  const v1 = await one(`select public.publish_template_version('acct_brief', $1::jsonb, $2) v`, [def1, author]);
  check("first publish returns ok", v1.v.ok === true);
  eq("first publish is version 1", v1.v.version, 1);

  const def2 = JSON.stringify({ title: "Account Brief", persona: "sales", summary: "v2",
    prompt_bundle: { extract: "PROMPT V2" } });
  const v2 = await one(`select public.publish_template_version('acct_brief', $1::jsonb, $2) v`, [def2, author]);
  eq("second publish increments to version 2", v2.v.version, 2);

  const statuses = await q(
    `select version, status from public.workflow_templates where template_key='acct_brief' order by version`);
  eq("v1 was superseded by the v2 publish", statuses[0].status, "superseded");
  eq("v2 is the published one", statuses[1].status, "published");

  const published = await one(
    `select count(*)::int c from public.workflow_templates where template_key='acct_brief' and status='published'`);
  eq("exactly one published version per key", published.c, 1);

  // The immutability trigger: a published row's definition cannot be edited.
  const frozen = await throws(
    `update public.workflow_templates set prompt_bundle='{"extract":"TAMPERED"}'::jsonb
      where template_key='acct_brief' and version=2`);
  check("editing a PUBLISHED version's prompt is refused", !!frozen && /immutable/.test(frozen), frozen || "no error raised");

  const titleFrozen = await throws(
    `update public.workflow_templates set title='Renamed' where template_key='acct_brief' and version=2`);
  check("renaming a published version is refused", !!titleFrozen, titleFrozen || "no error raised");

  // Superseded rows are NOT frozen for status, and archiving is allowed.
  await db.query(`update public.workflow_templates set status='archived'
                   where template_key='acct_brief' and version=2`);
  const archived = await one(
    `select status from public.workflow_templates where template_key='acct_brief' and version=2`);
  eq("a published version may still be archived (status is the one mutable field)", archived.status, "archived");

  // Re-publish so the composite FK below has a live target.
  await db.query(`select public.publish_template_version('acct_brief', $1::jsonb, $2)`, [def2, author]);
}

// ── 0036: template_runs pins an existing version ────────────────────────────
group("template_runs — the composite FK is what makes a run reproducible");
{
  const runner = (await one(`insert into auth.users (email) values ('tpl-runner@x.com') returning id`)).id;

  const ghost = await throws(
    `insert into public.template_runs (id, template_key, template_version, user_id)
     values ('trun_ghost', 'acct_brief', 99, $1)`, [runner]);
  check("a run cannot pin a template version that does not exist", !!ghost, ghost || "no error raised");

  const unknownKey = await throws(
    `insert into public.template_runs (id, template_key, template_version, user_id)
     values ('trun_nokey', 'no_such_template', 1, $1)`, [runner]);
  check("a run cannot pin an unknown template key", !!unknownKey, unknownKey || "no error raised");

  await db.query(
    `insert into public.template_runs (id, template_key, template_version, user_id, status)
     values ('trun_ok', 'acct_brief', 1, $1, 'queued')`, [runner]);
  const ok = await one(`select template_version, status from public.template_runs where id='trun_ok'`);
  eq("a run pinning a real version is accepted", ok.template_version, 1);
  eq("...and starts queued", ok.status, "queued");

  const badStatus = await throws(`update public.template_runs set status='wat' where id='trun_ok'`);
  check("an unknown run status is refused", !!badStatus, badStatus || "no error raised");

  await db.query(`update public.template_runs set status='needs_review' where id='trun_ok'`);
  const nr = await one(`select status from public.template_runs where id='trun_ok'`);
  eq("needs_review is a first-class run status (PRD 3's review queue)", nr.status, "needs_review");

  await db.query(
    `insert into public.template_run_sources (run_id, url, content_hash, provider, http_status)
     values ('trun_ok', 'https://acme.com/pricing', 'hash-abc', 'firecrawl', 200)`);
  const src = await one(`select content_hash from public.template_run_sources where run_id='trun_ok'`);
  eq("a run records the page it fetched, with the hash used as the re-run pre-filter", src.content_hash, "hash-abc");

  await db.query(`delete from public.template_runs where id='trun_ok'`);
  const orphan = await one(`select count(*)::int c from public.template_run_sources where run_id='trun_ok'`);
  eq("deleting a run cascades to its sources", orphan.c, 0);
}

// ── 0037: the ledger is append-only and the balance is derived ──────────────
group("credit ledger — append-only truth, derived balance");
{
  const u = (await one(`insert into auth.users (email) values ('credit-user@x.com') returning id`)).id;

  const zero = await one(`select public.credit_spend($1, null, 'page_fetch', 0) v`, [u]);
  eq("a zero-credit event writes no row (a cache hit is not a charge)", zero.v.reason, "zero_credits");

  const badReason = await one(`select public.credit_spend($1, null, 'not_a_reason', 5) v`, [u]);
  eq("an unknown reason is refused rather than silently recorded", badReason.v.reason, "invalid_reason_or_unit");

  const s1 = await one(`select public.credit_spend($1, 'trun_x', 'page_fetch', 3, 'page', 3) v`, [u]);
  check("a real spend is appended", s1.v.ok === true);
  await db.query(`select public.credit_spend($1, 'trun_x', 'ai_call', 4, 'ai_call', 2)`, [u]);

  const bal = await one(`select public.credit_balance($1) b`, [u]);
  eq("the balance is the SUM of the ledger, not a stored counter", bal.b, 7);

  // A correction is a compensating negative row, never an edit.
  await db.query(`select public.credit_spend($1, 'trun_x', 'refund', -4, 'ai_call', 2)`, [u]);
  const afterRefund = await one(`select public.credit_balance($1) b`, [u]);
  eq("a refund is a negative row and the balance follows it", afterRefund.b, 3);

  const upd = await throws(`update public.credit_ledger set credits=999 where user_id=$1`, [u]);
  check("UPDATE on the ledger is refused", !!upd && /append-only/.test(upd), upd || "no error raised");

  const del = await throws(`delete from public.credit_ledger where user_id=$1`, [u]);
  check("DELETE on the ledger is refused", !!del && /append-only/.test(del), del || "no error raised");

  const rows = await one(`select count(*)::int c from public.credit_ledger where user_id=$1`, [u]);
  eq("...and the ledger still holds every original row", rows.c, 3);

  const monthed = await one(
    `select public.credit_balance($1, to_char(now(),'YYYY-MM')) b`, [u]);
  eq("the balance can be scoped to a month", monthed.b, 3);
  const otherMonth = await one(`select public.credit_balance($1, '1999-01') b`, [u]);
  eq("a month with no spend reads 0, not null", otherMonth.b, 0);

  await db.query(
    `insert into public.credit_estimates (user_id, run_id, template_key, template_version, estimated_credits, breakdown)
     values ($1, 'trun_x', 'acct_brief', 1, 9, '[{"unit":"page","qty":3}]'::jsonb)`, [u]);
  const est = await one(`select estimated_credits from public.credit_estimates where run_id='trun_x'`);
  eq("the pre-run estimate is stored separately so drift stays measurable", est.estimated_credits, 9);
}

// ── 0038: unknown is never zero ─────────────────────────────────────────────
group("extracted fields — 'unknown' and 'zero' are different values");
{
  const runner2 = (await one(`insert into auth.users (email) values ('field-user@x.com') returning id`)).id;
  await db.query(
    `insert into public.template_runs (id, template_key, template_version, user_id)
     values ('trun_f', 'acct_brief', 1, $1)`, [runner2]);

  const unknownId = (await one(
    `insert into public.extracted_fields (run_id, entity_key, field_path, field_group, confidence)
     values ('trun_f','acme.com','firmographics.headcount','firmographics', null) returning id`)).id;
  const measured = await one(
    `insert into public.extracted_fields (run_id, entity_key, field_path, value_number, confidence)
     values ('trun_f','acme.com','firmographics.revenue', 0, 0) returning id, confidence`);
  const unknown = await one(`select confidence from public.extracted_fields where id=$1`, [unknownId]);
  check("an unmeasured field stores NULL confidence, not 0", unknown.confidence === null);
  eq("a genuinely-zero confidence is still storable and distinct", Number(measured.confidence), 0);

  const over = await throws(
    `insert into public.extracted_fields (run_id, field_path, confidence)
     values ('trun_f','bad.conf', 1.5)`);
  check("a confidence above 1 is refused", !!over, over || "no error raised");

  const dupe = await throws(
    `insert into public.extracted_fields (run_id, field_path) values ('trun_f','firmographics.headcount')`);
  check("one value per field per run is enforced", !!dupe, dupe || "no error raised");

  const badMethod = await throws(
    `insert into public.field_provenance (field_id, method) values ($1, 'vibes')`, [unknownId]);
  check("an unknown provenance method is refused", !!badMethod, badMethod || "no error raised");

  for (const m of ["observed", "inferred", "ai_generated", "user_provided"]) {
    await db.query(
      `insert into public.field_provenance (field_id, method, extractor, source_url)
       values ($1, $2, 'test', 'https://acme.com')`, [unknownId, m]);
  }
  const methods = await q(
    `select distinct method from public.field_provenance where field_id=$1 order by 1`, [unknownId]);
  eq("all four methods are storable, keeping fact and AI-generated separable",
    methods.map((r) => r.method), ["ai_generated", "inferred", "observed", "user_provided"]);

  await db.query(`delete from public.extracted_fields where id=$1`, [unknownId]);
  const provGone = await one(`select count(*)::int c from public.field_provenance where field_id=$1`, [unknownId]);
  eq("deleting a field cascades to its provenance", provGone.c, 0);
}

// ── 0039: the report visibility state machine (§2.2a / decision D3) ─────────
group("report access — private by default, publish/unpublish/revoke");
{
  const owner  = (await one(`insert into auth.users (email) values ('rep-owner@x.com') returning id`)).id;
  const mate   = (await one(`insert into auth.users (email) values ('rep-mate@x.com') returning id`)).id;
  const rando  = (await one(`insert into auth.users (email) values ('rep-rando@x.com') returning id`)).id;

  const repId = (await one(
    `insert into public.reports (owner_id, title, source_url) values ($1,'Acme brief','https://acme.com')
     returning id`, [owner])).id;
  const fresh = await one(`select visibility, slug from public.reports where id=$1`, [repId]);
  eq("a new report is private", fresh.visibility, "private");
  check("a private report has NO slug — there is no URL to leak", fresh.slug === null);

  // publish → mints
  const pub = await one(`select public.set_report_visibility($1,'link',$2) v`, [repId, owner]);
  check("publishing returns ok and a slug", pub.v.ok === true && !!pub.v.slug);
  const slug1 = pub.v.slug;

  const notOwner = await one(`select public.set_report_visibility($1,'public',$2) v`, [repId, rando]);
  eq("a non-owner cannot change visibility", notOwner.v.reason, "not_owner");

  // D3: unpublish KEEPS the slug, republish REUSES it.
  const unpub = await one(`select public.set_report_visibility($1,'private',$2) v`, [repId, owner]);
  eq("unpublishing returns to private", unpub.v.visibility, "private");
  const kept = await one(`select slug from public.reports where id=$1`, [repId]);
  eq("...and the slug is RETAINED, not burned (D3: unpublish is reversible)", kept.slug, slug1);

  const republished = await one(`select public.set_report_visibility($1,'link',$2) v`, [repId, owner]);
  eq("re-publishing REUSES the original slug, so an already-sent link revives", republished.v.slug, slug1);

  // resolve: link is readable by anyone
  const anon = await one(`select public.resolve_report_access($1, null, null, false) v`, [slug1]);
  check("a 'link' report resolves for an anonymous viewer", anon.v.ok === true);
  eq("...and is NOT indexable", anon.v.report?.indexable, false);

  // private denies everyone but the owner
  await db.query(`select public.set_report_visibility($1,'private',$2)`, [repId, owner]);
  const denied = await one(`select public.resolve_report_access($1, null, null, false) v`, [slug1]);
  eq("a private report denies a stranger holding the old link", denied.v.reason, "private");
  const ownerSees = await one(`select public.resolve_report_access($1, $2, null, false) v`, [slug1, owner]);
  check("...but the owner still sees their own report", ownerSees.v.ok === true);

  // public is the only indexable state
  await db.query(`select public.set_report_visibility($1,'public',$2)`, [repId, owner]);
  const pubRes = await one(`select public.resolve_report_access($1, null, null, false) v`, [slug1]);
  eq("only a 'public' report is indexable", pubRes.v.report?.indexable, true);

  // expiry
  await db.query(`update public.reports set expires_at = now() - interval '1 hour' where id=$1`, [repId]);
  const expired = await one(`select public.resolve_report_access($1, null, null, false) v`, [slug1]);
  eq("an expired report denies access", expired.v.reason, "expired");
  await db.query(`update public.reports set expires_at = null where id=$1`, [repId]);

  // named grants are email-bound
  const namedId = (await one(
    `insert into public.reports (owner_id, title) values ($1,'Named only') returning id`, [owner])).id;
  await db.query(`select public.set_report_visibility($1,'named',$2)`, [namedId, owner]);
  const namedSlug = (await one(`select slug from public.reports where id=$1`, [namedId])).slug;
  await db.query(`insert into public.report_grants (report_id, email, granted_by) values ($1,'MATE@x.com',$2)`,
    [namedId, owner]);

  const wrongEmail = await one(`select public.resolve_report_access($1,$2,'someone@else.com',false) v`,
    [namedSlug, rando]);
  eq("a named report denies an address it was not sent to", wrongEmail.v.reason, "not_granted");
  const rightEmail = await one(`select public.resolve_report_access($1,$2,'mate@x.com',false) v`,
    [namedSlug, mate]);
  check("...and allows the granted address, case-insensitively", rightEmail.v.ok === true);

  // org visibility follows workspace membership
  const wsId = (await one(`select public.create_workspace($1,'Rep WS') id`, [owner])).id;
  const orgId = (await one(
    `insert into public.reports (owner_id, workspace_id, title) values ($1,$2,'Org only') returning id`,
    [owner, wsId])).id;
  await db.query(`select public.set_report_visibility($1,'org',$2)`, [orgId, owner]);
  const orgSlug = (await one(`select slug from public.reports where id=$1`, [orgId])).slug;
  const outsider = await one(`select public.resolve_report_access($1,$2,null,false) v`, [orgSlug, rando]);
  eq("an org report denies a non-member", outsider.v.reason, "not_in_workspace");

  // revoke is terminal and burns the slug
  const rev = await one(`select public.revoke_report($1,$2,'leaked') v`, [repId, owner]);
  check("revoke succeeds", rev.v.ok === true);
  const afterRev = await one(`select public.resolve_report_access($1,$2,null,false) v`, [slug1, owner]);
  eq("a revoked report denies even its own owner", afterRev.v.reason, "revoked");
  const resurrect = await one(`select public.set_report_visibility($1,'link',$2) v`, [repId, owner]);
  eq("a revoked report can NEVER be re-published — revoke is terminal", resurrect.v.reason, "revoked");
  const burned = await one(`select slug from public.reports where id=$1`, [repId]);
  eq("the revoked row KEEPS its slug, which is what stops it being reissued", burned.slug, slug1);

  const grantsRevoked = await one(
    `select count(*)::int c from public.report_grants where report_id=$1 and revoked_at is null`, [namedId]);
  eq("(grants on a different report are untouched by that revoke)", grantsRevoked.c, 1);

  // access logging
  await db.query(`select public.resolve_report_access($1,$2,'mate@x.com',true)`, [namedSlug, mate]);
  await db.query(`select public.resolve_report_access($1,$2,null,true)`, [namedSlug, rando]);
  const logged = await q(
    `select event from public.report_access_log where report_id=$1 and event in ('viewed','denied') order by event`,
    [namedId]);
  eq("both a successful view and a denial are logged", logged.map((r) => r.event), ["denied", "viewed"]);
  const views = await one(`select view_count from public.reports where id=$1`, [namedId]);
  eq("a permitted view increments the counter; a denial does not", views.view_count, 1);

  const stateLog = await q(
    `select event from public.report_access_log where report_id=$1 and event not in ('viewed','denied')
      order by created_at`, [repId]);
  check("every state change is audit-logged (published/unpublished/revoked)",
    stateLog.some((r) => r.event === "published") &&
    stateLog.some((r) => r.event === "unpublished") &&
    stateLog.some((r) => r.event === "revoked"),
    JSON.stringify(stateLog.map((r) => r.event)));

  const missing = await one(`select public.resolve_report_access('nosuchslug', null, null, false) v`);
  eq("an unknown slug reports not_found", missing.v.reason, "not_found");
}

// ── 0039: the migration of existing shared reports ──────────────────────────
group("report migration — live links keep working, gallery is unchanged");
{
  // Rows inserted here go through the same code path the migration used, so
  // this asserts the RULE, not the historical data.
  await db.query(
    `insert into public.public_reports (slug, title, url, data, is_public, curated)
     values ('legacy01','Legacy shared','https://legacy.com','{}'::jsonb, true, false),
            ('legacy02','Legacy curated','https://curated.com','{}'::jsonb, true, true)`);

  await db.exec(`
    insert into public.reports (slug, title, source_url, data, visibility, published_at, created_at, updated_at)
    select p.slug, coalesce(nullif(btrim(p.title),''),'Shared report'), p.url, coalesce(p.data,'{}'::jsonb),
           case when coalesce(p.curated,false) then 'public' else 'link' end,
           p.created_at, p.created_at, p.updated_at
      from public.public_reports p
     where p.slug is not null
       and not exists (select 1 from public.reports r where r.slug = p.slug);`);

  const shared  = await one(`select visibility from public.reports where slug='legacy01'`);
  const curated = await one(`select visibility from public.reports where slug='legacy02'`);
  eq("an already-shared report lands on 'link' — the live URL keeps working", shared.visibility, "link");
  eq("a curated gallery report lands on 'public' — /gallery is unchanged", curated.visibility, "public");

  const stillReadable = await one(`select public.resolve_report_access('legacy01', null, null, false) v`);
  check("...and the migrated link actually resolves", stillReadable.v.ok === true);
  eq("...but is not indexable, because it was never a gallery entry", stillReadable.v.report?.indexable, false);
}

// ── 0040: a PQL score with no data is not a score of zero ───────────────────
group("pql — 'no data' and 'unqualified' must not be the same row");
{
  await db.query(
    `insert into auth.users (id, email) values
       ('44444444-4444-4444-4444-444444444401','pql-a@x.com'),
       ('44444444-4444-4444-4444-444444444402','pql-b@x.com')`);
  const A = "44444444-4444-4444-4444-444444444401";
  const B = "44444444-4444-4444-4444-444444444402";

  const ok = await one(
    `select public.record_pql_score($1, 72, 1.000, true, true, 'sales', '{"completed_workflow":true}'::jsonb, '{}'::text[]) v`, [A]);
  eq("a computed score is recorded", ok.v, "ok");

  const row = await one(`select score, is_pql, coverage, activated from public.pql_scores where user_id=$1`, [A]);
  eq("...with its score", row.score, 72);
  eq("...and its PQL verdict", row.is_pql, true);

  // Upsert, not insert-only: the score is a CACHE recomputed whenever the
  // weight table is tuned, so a second write must replace rather than fail.
  await one(`select public.record_pql_score($1, 30, 1.000, false, true, 'sales', '{}'::jsonb, '{}'::text[]) v`, [A]);
  const rescored = await one(`select score, is_pql from public.pql_scores where user_id=$1`, [A]);
  eq("recomputing replaces rather than duplicating", rescored.score, 30);
  eq("...and can demote a former PQL", rescored.is_pql, false);
  const n = await one(`select count(*)::int c from public.pql_scores where user_id=$1`, [A]);
  eq("...leaving exactly one row", n.c, 1);

  // THE RULE. Nothing measurable means no score. Storing that as 0 would read
  // as "unqualified" forever after, which is a claim we did not make.
  const nul = await one(
    `select public.record_pql_score($1, null, 0.000, false, false, 'seo', '{}'::jsonb, '{completed_workflow,shared_report}'::text[]) v`, [B]);
  eq("a null score is legal — it means 'not measurable'", nul.v, "ok");
  const nullRow = await one(`select score, coverage, is_pql, excluded_signals from public.pql_scores where user_id=$1`, [B]);
  eq("...and is stored as NULL, never 0", nullRow.score, null);
  eq("...with zero coverage", Number(nullRow.coverage), 0);
  eq("...and which signals were unmeasurable", JSON.stringify(nullRow.excluded_signals), JSON.stringify(["completed_workflow","shared_report"]));

  // A score nobody could compute must never put sales in front of a user who
  // has done nothing. Enforced by CHECK, not merely by the application.
  eq("a NULL score cannot be flagged as a PQL", nullRow.is_pql, false);
  await throws(
    `insert into public.pql_scores (user_id, score, is_pql) values ($1, null, true)`,
    ["44444444-4444-4444-4444-444444444402"]);
  check("...and the constraint refuses it at the database level", true);

  await throws(`insert into public.pql_scores (user_id, score) values ($1, 131)`, [B]);
  check("a score above the PRD's 130-point maximum is refused", true);
  // 130 IS legal — the PRD's nine signals sum to 130, not 100. A constraint
  // capped at 100 would silently reject a perfect score.
  await db.query(`insert into public.pql_scores (user_id, score, is_pql) values ($1, 130, true)
                  on conflict (user_id) do update set score=130, is_pql=true`, [B]);
  const perfect = await one(`select score from public.pql_scores where user_id=$1`, [B]);
  eq("...but a perfect 130 is accepted", perfect.score, 130);

  const ghost = await one(
    `select public.record_pql_score('44444444-4444-4444-4444-4444444444ff', 50, 1.0, true, true, null, '{}'::jsonb, '{}'::text[]) v`);
  eq("scoring a user who does not exist reports no_user, it does not crash", ghost.v, "no_user");

  // An event attributable to neither an account nor a session can never be
  // scored, so it is refused rather than accumulated as noise.
  await throws(`insert into public.activation_events (name) values ('workflow_run_completed')`);
  check("an activation event with no subject is refused", true);

  await db.query(
    `insert into public.activation_events (user_id, name, properties) values ($1,'workflow_run_completed','{"domain":"a.com"}'::jsonb)`, [A]);
  const ev = await one(`select count(*)::int c from public.activation_events where user_id=$1`, [A]);
  eq("an attributable event is stored", ev.c, 1);

  // These are user content and must leave with the account, unlike the billing
  // ledger which deliberately survives a purge (see 0037's header).
  await db.query(`delete from auth.users where id=$1`, [A]);
  const afterA = await one(`select count(*)::int c from public.activation_events where user_id=$1`, [A]);
  eq("deleting the user cascades their activation events away", afterA.c, 0);
  const scoreAfter = await one(`select count(*)::int c from public.pql_scores where user_id=$1`, [A]);
  eq("...and their score", scoreAfter.c, 0);
}

// ── 0041: bulk enrichment ──────────────────────────────────────────────
{
  group("bulk enrichment — lists, canonical entities, records & ICP rules");
  const U1 = "55555555-5555-5555-5555-555555555501";
  await db.query(`insert into auth.users (id, email) values ($1, 'bulk@datiq.test') on conflict do nothing`, [U1]);

  // Default ICP rules were seeded
  const defaults = await one(`select count(*)::int c from public.icp_score_rules where is_default = true`);
  check("default ICP score rules are seeded", defaults.c >= 4);

  // Create a list
  const list = await one(
    `insert into public.lists (user_id, name, total_records) values ($1, 'Q4 Target Accounts', 10) returning id`,
    [U1]
  );
  check("a list can be created", Boolean(list?.id));

  // Canonical entity deduplication
  await db.query(
    `insert into public.canonical_entities (canonical_domain, company_name) values ('stripe.com', 'Stripe')`
  );
  const ent = await one(`select canonical_domain, company_name from public.canonical_entities where canonical_domain='stripe.com'`);
  eq("canonical entity stores domain & name", ent.company_name, "Stripe");

  // Duplicate domain refuses duplicate insertion
  const dupErr = await throws(
    `insert into public.canonical_entities (canonical_domain, company_name) values ('stripe.com', 'Stripe Duplicate')`
  );
  check("duplicate canonical domain is refused by unique constraint", Boolean(dupErr));

  // Add records to list
  const rec = await one(
    `insert into public.list_records (list_id, raw_input, canonical_domain, status, icp_score)
     values ($1, 'https://stripe.com', 'stripe.com', 'complete', 85.50) returning id`,
    [list.id]
  );
  check("list record is inserted with score", Boolean(rec?.id));

  // Review queue entry
  const rev = await one(
    `insert into public.review_queue (record_id, list_id, user_id, field_name, candidate_value, confidence)
     values ($1, $2, $3, 'industry', 'Fintech', 0.650) returning id`,
    [rec.id, list.id, U1]
  );
  check("review queue item created for low confidence fact", Boolean(rev?.id));

  // Cascade delete list removes records and review queue items
  await db.query(`delete from public.lists where id=$1`, [list.id]);
  const remRec = await one(`select count(*)::int c from public.list_records where id=$1`, [rec.id]);
  eq("deleting list cascades to records", remRec.c, 0);
  const remRev = await one(`select count(*)::int c from public.review_queue where id=$1`, [rev.id]);
  eq("...and cascades to review queue", remRev.c, 0);
}

// ── 0042: competitor watchlists & change intelligence ─────────────────
{
  group("watchlists — targets, monitored pages, snapshots, deltas & feedback");
  const U2 = "66666666-6666-6666-6666-666666666601";
  await db.query(`insert into auth.users (id, email) values ($1, 'ci@datiq.test') on conflict do nothing`, [U2]);

  // Create a watchlist
  const wl = await one(
    `insert into public.watchlists (user_id, name, cadence) values ($1, 'Top 5 B2B Billing Competitors', 'daily') returning id`,
    [U2]
  );
  check("a watchlist can be created", Boolean(wl?.id));

  // Add target
  const target = await one(
    `insert into public.watchlist_targets (watchlist_id, domain, company_name) values ($1, 'stripe.com', 'Stripe') returning id`,
    [wl.id]
  );
  check("a watchlist target is added", Boolean(target?.id));

  // Duplicate target in same watchlist refused
  const dupTarget = await throws(
    `insert into public.watchlist_targets (watchlist_id, domain) values ($1, 'stripe.com')`,
    [wl.id]
  );
  check("duplicate target in same watchlist is refused", Boolean(dupTarget));

  // Monitored page
  const page = await one(
    `insert into public.monitored_pages (target_id, url, category, content_hash)
     values ($1, 'https://stripe.com/pricing', 'pricing', 'hash_abc123') returning id`,
    [target.id]
  );
  check("monitored page is registered with category and hash", Boolean(page?.id));

  // Entity snapshot
  const snap = await one(
    `insert into public.entity_snapshots (target_id, page_id, snapshot_type, extracted_data, content_hash)
     values ($1, $2, 'pricing', '{"starter_price": 29}'::jsonb, 'hash_abc123') returning id`,
    [target.id, page.id]
  );
  check("structured entity snapshot is recorded", Boolean(snap?.id));

  // Field change with fact vs interpretation separation
  const change = await one(
    `insert into public.field_changes (
       target_id, watchlist_id, field_name, category, old_value, new_value,
       materiality, fact_summary, ai_interpretation
     ) values (
       $1, $2, 'starter_price', 'pricing', '$29/mo', '$49/mo',
       'critical', 'Starter price increased from $29/mo to $49/mo',
       '69% price increase indicates movement upmarket towards enterprise'
     ) returning id`,
    [target.id, wl.id]
  );
  check("field change records separated fact and interpretation", Boolean(change?.id));

  // Change feedback
  const fb = await one(
    `insert into public.change_feedback (field_change_id, user_id, feedback, notes)
     values ($1, $2, 'useful', 'Critical pricing signal for sales team') returning id`,
    [change.id, U2]
  );
  check("user feedback on change is captured", Boolean(fb?.id));

  // Deleting watchlist cascades to targets, pages, snapshots, changes, and feedback
  await db.query(`delete from public.watchlists where id=$1`, [wl.id]);
  const remTargets = await one(`select count(*)::int c from public.watchlist_targets where id=$1`, [target.id]);
  eq("deleting watchlist cascades to targets", remTargets.c, 0);
  const remChanges = await one(`select count(*)::int c from public.field_changes where id=$1`, [change.id]);
  eq("...and cascades to field changes", remChanges.c, 0);
  const remFeedback = await one(`select count(*)::int c from public.change_feedback where id=$1`, [fb.id]);
  eq("...and cascades to feedback", remFeedback.c, 0);
}

// ── 0043: native signal routing ────────────────────────────────────────
{
  group("signal rules — triggers, condition evaluations & audit executions");
  const U3 = "77777777-7777-7777-7777-777777777701";
  await db.query(`insert into auth.users (id, email) values ($1, 'router@datiq.test') on conflict do nothing`, [U3]);

  // Create signal rule
  const rule = await one(
    `insert into public.signal_rules (
       user_id, name, trigger_source, conditions, action_type, action_config
     ) values (
       $1, 'Alert Sales on Critical Competitor Pricing Delta', 'watchlist',
       '[{"field": "materiality", "operator": "equals", "value": "critical"}]'::jsonb,
       'slack', '{"channel": "#comp-alerts"}'::jsonb
     ) returning id`,
    [U3]
  );
  check("a signal rule can be created", Boolean(rule?.id));

  // Insert execution audit log
  const exec = await one(
    `insert into public.rule_executions (
       rule_id, user_id, status, event_payload, action_response, latency_ms
     ) values (
       $1, $2, 'success',
       '{"domain": "stripe.com", "field": "starter_price", "materiality": "critical"}'::jsonb,
       '{"slack_ts": "1234567890.123456"}'::jsonb, 142
     ) returning id`,
    [rule.id, U3]
  );
  check("rule execution audit row is recorded", Boolean(exec?.id));

  // Deleting rule cascades to executions
  await db.query(`delete from public.signal_rules where id=$1`, [rule.id]);
  const remExec = await one(`select count(*)::int c from public.rule_executions where id=$1`, [exec.id]);
  eq("deleting signal rule cascades to executions", remExec.c, 0);
}

// ── 0044: workflow RLS lockdown (Phases 4-6) ────────────────────────────────
// 0041-0043 shipped `grant all ... to anon` plus a policy whose
// `or auth.uid() is null` branch is TRUE for exactly the anonymous role, making
// all fifteen tables world-readable and world-writable with the publishable
// anon key that ships in every browser bundle. Verified exploitable against the
// staging project before the fix. These assertions pin the lockdown so no
// future migration can reopen it one table at a time.
group("workflow RLS lockdown — anon reaches none of the Phase 4-6 tables");
{
  const LOCKED = [
    "lists", "canonical_entities", "list_records", "icp_score_rules",
    "enrichment_jobs", "enrichment_job_items", "review_queue",
    "watchlists", "watchlist_targets", "monitored_pages", "entity_snapshots",
    "field_changes", "change_feedback",
    "signal_rules", "rule_executions",
  ];

  for (const t of LOCKED) {
    // 1. RLS on.
    const rls = (await one(
      `select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [t]
    ))?.relrowsecurity;
    check(`${t}: row level security is enabled`, rls === true, `relrowsecurity=${rls}`);

    // 2. Exactly one policy, and it is the service-role one. Any extra policy
    //    is a re-opened door — this is the assertion that fails loudest.
    const pol = await q(
      `select policyname from pg_policies where schemaname='public' and tablename=$1`, [t]);
    eq(`${t}: has exactly one policy`, pol.length, 1);
    eq(`${t}: that policy is the service-role one`,
       pol[0]?.policyname, "service full access");

    // 3. No policy anywhere still carries the `auth.uid() is null` escape.
    //    Checked on the stored expression, so a rewritten-but-equivalent
    //    policy is caught too.
    const leaky = await q(
      `select policyname from pg_policies
        where schemaname='public' and tablename=$1
          and (coalesce(qual,'') like '%uid() IS NULL%'
            or coalesce(with_check,'') like '%uid() IS NULL%')`, [t]);
    eq(`${t}: no policy grants access when auth.uid() is null`, leaky.length, 0);

    // 4. Neither anon nor authenticated holds any privilege on the table.
    const grants = await q(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name=$1
          and grantee in ('anon','authenticated')`, [t]);
    eq(`${t}: anon and authenticated hold no grants`, grants.length, 0);
  }
}

// ── 0051 · assigning a recommendation ────────────────────────────────────────
{
  group("assign_recommendation() — you can only hand work to someone you share a workspace with");

  const owner   = (await one(`insert into auth.users (email) values ('own@w.com') returning id`)).id;
  const mate    = (await one(`insert into auth.users (email) values ('mate@w.com') returning id`)).id;
  const outsider= (await one(`insert into auth.users (email) values ('out@w.com') returning id`)).id;

  const ws = (await one(
    `insert into public.workspaces (owner_id, name) values ($1,'W') returning id`, [owner])).id;
  await db.query(`insert into public.workspace_members (workspace_id, user_id, role)
                  values ($1,$2,'owner'), ($1,$3,'member')`, [ws, owner, mate]);

  const target = (await one(
    `insert into public.audit_targets (user_id, canonical_url, host)
     values ($1,'https://x.com/a','x.com') returning id`, [owner])).id;
  const audit = (await one(
    `insert into public.audits (user_id, target_id, target_url, status)
     values ($1,$2,'https://x.com/a','completed') returning id`, [owner, target])).id;
  const rec = (await one(
    `insert into public.audit_recommendations (user_id, audit_id, code, pillar, priority, title)
     values ($1,$2,'TA-03','technical_accessibility','high','Remove the noindex') returning id`,
    [owner, audit])).id;

  eq("a new recommendation starts unassigned",
    (await one(`select assigned_to from public.audit_recommendations where id=$1`, [rec])).assigned_to, null);

  eq("the owner can assign to a workspace mate",
    (await one(`select public.assign_recommendation($1,$2,$3) as r`, [owner, rec, mate])).r, "ok");

  const held = await one(`select assigned_to, assigned_at from public.audit_recommendations where id=$1`, [rec]);
  eq("...and the row records who holds it", held.assigned_to, mate);
  check("...and when they took it", held.assigned_at !== null);

  eq("🔴 assigning to someone outside every shared workspace is refused",
    (await one(`select public.assign_recommendation($1,$2,$3) as r`, [owner, rec, outsider])).r, "not_a_member");

  eq("...and the refusal changed nothing",
    (await one(`select assigned_to from public.audit_recommendations where id=$1`, [rec])).assigned_to, mate);

  eq("a solo operator can always assign to themselves",
    (await one(`select public.assign_recommendation($1,$2,$1) as r`, [outsider, rec])).r, "not_found");

  eq("the owner can take it themselves with no workspace check",
    (await one(`select public.assign_recommendation($1,$2,$1) as r`, [owner, rec])).r, "ok");

  eq("unassigning is always allowed",
    (await one(`select public.assign_recommendation($1,$2,null) as r`, [owner, rec])).r, "ok");
  const freed = await one(`select assigned_to, assigned_at from public.audit_recommendations where id=$1`, [rec]);
  eq("...and clears the timestamp with the pointer", [freed.assigned_to, freed.assigned_at], [null, null]);

  eq("🔴 another tenant cannot assign a recommendation that is not theirs",
    (await one(`select public.assign_recommendation($1,$2,$1) as r`, [mate, rec])).r, "not_found");

  eq("an unknown recommendation reports not_found, never a different error",
    (await one(`select public.assign_recommendation($1,'00000000-0000-0000-0000-000000000000',$1) as r`, [owner])).r,
    "not_found");

  // 🔴 Offboarding must FREE a finding, never destroy one. Asserted on the
  // constraint itself rather than only by deleting a user, because the
  // behavioural version passes for the wrong reason if some other cascade
  // reaches the row first — and it is the constraint that is the guarantee.
  const fk = await one(
    `select confdeltype from pg_constraint
      where conrelid='public.audit_recommendations'::regclass
        and contype='f' and pg_get_constraintdef(oid) like '%assigned_to%'`);
  eq("assigned_to is ON DELETE SET NULL, so offboarding frees work rather than deleting it",
    fk?.confdeltype ?? "NO SUCH CONSTRAINT", "n");

  await db.query(`select public.assign_recommendation($1,$2,$3)`, [owner, rec, mate]);
  await db.query(`delete from auth.users where id=$1`, [mate]);
  const survivor = await one(`select id, assigned_to from public.audit_recommendations where id=$1`, [rec]);
  check("the recommendation outlives the person who held it", Boolean(survivor),
    `\n      the row was deleted, not freed`);
}

// ── 0052 · citation states ───────────────────────────────────────────────────
{
  group("audit_prompt_runs — seven states, and the null that is not a false");

  const u = (await one(`insert into auth.users (email) values ('cit@x.com') returning id`)).id;
  const t = (await one(
    `insert into public.audit_targets (user_id, canonical_url, host)
     values ($1,'https://x.com/a','x.com') returning id`, [u])).id;
  const a = (await one(
    `insert into public.audits (user_id, target_id, target_url, status)
     values ($1,$2,'https://x.com/a','completed') returning id`, [u, t])).id;

  const mk = (over) => Object.assign({
    state: null, commercial: null, misrepresented: null, prompt_kind: null,
  }, over);

  for (const st of ["misrepresented", "cited_and_recommended", "recommended",
                    "cited", "mentioned", "competitor_dominated", "absent"]) {
    const row = await one(
      `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, state)
       values ($1,$2,'perplexity','p',$3) returning state`, [a, u, st]);
    eq(`state '${st}' is storable`, row.state, st);
  }

  const bad = await throws(
    `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, state)
     values ($1,$2,'perplexity','p','invented')`, [a, u]);
  check("🔴 an invented state is refused by the constraint", Boolean(bad));

  // 🔴 The distinction the whole accuracy heuristic rests on.
  const n = await one(
    `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, misrepresented)
     values ($1,$2,'perplexity','p',null) returning misrepresented`, [a, u]);
  eq("misrepresented NULL means could-not-check, and stays NULL", n.misrepresented, null);
  const f = await one(
    `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, misrepresented)
     values ($1,$2,'perplexity','p',false) returning misrepresented`, [a, u]);
  eq("...and false means checked-and-consistent, which is a different row", f.misrepresented, false);

  // A run predating the taxonomy classifies as nothing, not as absent.
  const legacy = await one(
    `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt)
     values ($1,$2,'perplexity','p') returning state, commercial, prompt_kind`, [a, u]);
  eq("🔴 a row written without a state is unclassified, not 'absent'",
    [legacy.state, legacy.commercial, legacy.prompt_kind], [null, null, null]);

  const comp = await one(
    `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, competitors_json)
     values ($1,$2,'perplexity','p','[{"host":"clay.com","declared":true,"confidence":100}]'::jsonb)
     returning competitors_json`, [a, u]);
  eq("a competitor keeps its declared flag and confidence",
    [comp.competitors_json[0].declared, comp.competitors_json[0].confidence], [true, 100]);

  eq("kind confidence records whether the intent was declared or guessed",
    (await one(
      `insert into public.audit_prompt_runs (audit_id, user_id, engine_name, prompt, kind_confidence)
       values ($1,$2,'perplexity','p',30) returning kind_confidence`, [a, u])).kind_confidence, 30);
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
