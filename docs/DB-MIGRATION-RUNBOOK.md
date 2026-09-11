# DB migration runbook — `supabase/migrations/` → a Supabase project

> Operational reference for `scripts/migrate-prod.mjs` (`npm run migrate:prod`).
> Covers migrations `0001`–`0017`, the staged-apply path for `0012`–`0017`, and
> the post-apply verification queries.
>
> Companion docs: `docs/SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md` §6
> (why the ordering matters), `NETLIFY-ENVIRONMENTS.md` §17 (where this sits in
> the cutover sequence).

---

## 0. Prerequisites

- `npm install` has run in this worktree — the runner needs the `pg`
  devDependency. There is no `psql` requirement (that was removed in `a57cde5`).
- The **Direct** connection string: Supabase → Project Settings → Database →
  Connection string → **Direct**. Port **5432**, not the pooler.
- URL-encode any `@ # / ? :` in the password, or the connection string parses
  into the wrong host.

Keep the password out of shell history — prefix the command with a space (with
`HISTCONTROL=ignorespace`), or source it from an untracked file. `env.*` is
already in `.gitignore`.

---

## 1. List what will run — makes no connection

```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXXX.supabase.co:5432/postgres" npm run migrate:prod -- --list
```

Expect **17 files**, `0001` → `0017`. `run-all.sql` and `rollback.sql` are
excluded by the runner (the first is the generated concatenation, the second is
destructive).

`PROD_SUPABASE_DB_URL` must still be *set* for `--list` — the env check runs
before argument handling — but its value is never dialled.

## 2. Dry run — connects, verifies the target, applies nothing

```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXXX.supabase.co:5432/postgres" npm run migrate:prod -- --dry-run
```

This is the safety check. It prints `current_database`, server host and Postgres
version, and **aborts if `current_database != "postgres"`** — which catches a
connection string pointed at the wrong project before anything is written.

## 3. Apply

```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXXX.supabase.co:5432/postgres" npm run migrate:prod
```

Semantics:

- `SET statement_timeout = 0` — index creation on populated tables can take
  minutes.
- Each file runs in **its own transaction**. A failure rolls that file back,
  prints the file + Postgres error (+ position/hint), and **stops without
  attempting the rest**.
- Every migration is idempotent (`IF NOT EXISTS` / `OR REPLACE`), so re-running
  after a fix is safe.

---

## 4. ⚠️ The runner has no stop-at-N flag

Its only flags are `--list`, `--dry-run` and `--include=<path>`. A bare
`npm run migrate:prod` applies **`0001` → `0017` in one pass, including `0014`
(the RLS flip)**.

That is correct for a **scratch or fresh** project. It is *not* the documented
sequence for a database with real users, where `0012` must ship and run for a
release cycle before `0013`/`0014` — the reasoning is in
[`SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md`](SESSION-HANDOFF-2026-07-27-INVOICING-AND-LIFECYCLE.md)
§6.2 and in `0012`'s own header comment.

To apply a chosen subset with the same transaction-per-file semantics:

```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXXX.supabase.co:5432/postgres" node -e '
const fs=require("fs"), {Client}=require("pg");
(async()=>{
  const c=new Client({connectionString:process.env.PROD_SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await c.connect(); await c.query("SET statement_timeout = 0");
  for(const f of process.argv.slice(1)){
    try{ await c.query("BEGIN"); await c.query(fs.readFileSync(f,"utf8")); await c.query("COMMIT"); console.log("OK  ",f); }
    catch(e){ await c.query("ROLLBACK").catch(()=>{}); console.error("FAIL",f,e.message); process.exitCode=1; break; }
  }
  await c.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
' supabase/migrations/0012_billing_identity.sql
```

Name as many files as you want, in order. Add `0013`, then `0014`, then
`0015`–`0017` as separate invocations when each step is due.

---

## 4b. Applying `0055` + `0056` (P2 · W9 + W10) to dev / stage

> ✅ **APPLIED to dev / stage, 2026-09-11, by the owner.** Kept here because the
> same procedure is what production will need, and because §4c's `0057`/`0058`
> depend on both being present first.
>
> ⚠️ **PRODUCTION STILL NEEDS THEM**, along with everything from `0050` up.

### What they add

| Migration | Objects |
|---|---|
| `0055_business_truth.sql` | 3 tables (`audit_business_truth_records`, `_versions`, `_conflicts`) · 1 function `promote_business_truth_version` · 2 triggers |
| `0056_entity_graph.sql` | 4 tables (`audit_entities`, `audit_entity_relationships`, `_evidence`, `_conflicts`) · 1 function `approve_entity_relationship` · 2 triggers |

Together they take a clean build to **96 tables / 49 functions / 24 triggers**,
which `npm run test:db` asserts.

### ✅ Both are safely RE-RUNNABLE — proven, not assumed

Every `create table`, `create index`, `create policy` and `create trigger` is
guarded (`if not exists` / `drop … if exists`), both functions are
`create or replace`, and the one `alter table … add constraint` is preceded by
its own `drop constraint if exists`. Applying both a **second** time against a
database that already has them changes nothing:

```
after 1st apply : {"tables":96,"funcs":49,"trigs":24,"pols":93,"idx":311}
after 2nd apply : {"tables":96,"funcs":49,"trigs":24,"pols":93,"idx":311}
```

So a retried or duplicated apply is safe — but see the ordering note below.

### Apply

`0055` **must** run before `0056`: `audit_entities.truth_record_id` and
`audit_entity_conflicts.truth_record_id` both reference
`audit_business_truth_records`. Use the subset runner from §4 — a bare
`npm run migrate:prod` replays **all 56** migrations, which is wrong for a
database that already has `0001`–`0054`.

```bash
# DEV / STAGE project ref (see public/runtime-config.js — do NOT use the prod ref)
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.<dev-ref>.supabase.co:5432/postgres" node -e '
const fs=require("fs"), {Client}=require("pg");
(async()=>{
  const c=new Client({connectionString:process.env.PROD_SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await c.connect(); await c.query("SET statement_timeout = 0");
  const {rows}=await c.query("select current_database() db, current_user u");
  console.log("target:",rows[0].db,"as",rows[0].u);
  for(const f of process.argv.slice(1)){
    try{ await c.query("BEGIN"); await c.query(fs.readFileSync(f,"utf8")); await c.query("COMMIT"); console.log("OK  ",f); }
    catch(e){ await c.query("ROLLBACK").catch(()=>{}); console.error("FAIL",f,e.message); process.exitCode=1; break; }
  }
  await c.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
' supabase/migrations/0055_business_truth.sql supabase/migrations/0056_entity_graph.sql
```

⚠️ Use the **Direct** connection string (port **5432**), not the pooler, and
URL-encode special characters in the password.

### Verify after applying

```sql
-- 1. All seven tables exist. Expect 7 rows.
select table_name from information_schema.tables
 where table_schema = 'public'
   and (table_name like 'audit_business_truth%' or table_name like 'audit_entit%')
 order by table_name;

-- 2. Both functions exist and are SECURITY DEFINER.
select p.proname, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('promote_business_truth_version','approve_entity_relationship');
-- Expect 2 rows, prosecdef = t for both.

-- 3. 🔴 RLS IS ON AND anon/authenticated HAVE NOTHING. Expect 0 rows.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon','authenticated')
   and (table_name like 'audit_business_truth%' or table_name like 'audit_entit%');

-- 4. …and RLS is enabled on all seven. Expect every relrowsecurity = true.
select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and (c.relname like 'audit_business_truth%' or c.relname like 'audit_entit%')
 order by c.relname;

-- 5. The self-approval CHECK is present on both approval paths. Expect 2 rows.
select conname from pg_constraint
 where conname in ('audit_btv_no_self_approval','audit_rel_no_self_approval');
```

### 🔴 The one thing PGlite could not prove

`promote_business_truth_version` and `approve_entity_relationship` are
**`security definer`** and have only ever run under PGlite, which has **shimmed
roles** — no real `service_role`, no GoTrue. The first live call is the first
real test of the `revoke all … grant execute to service_role` pair at the foot
of each migration. After applying, confirm a non-service role genuinely cannot
call them:

```sql
set local role authenticated;
select public.promote_business_truth_version(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid);
-- EXPECT: ERROR permission denied for function promote_business_truth_version
reset role;
```

A result of `not_found` instead of a permission error means the grant did not
take, and the function is callable by any signed-in user.

---

## 4c. Applying `0057` + `0058` (D7 + P2 · W12) and `0059` (W12 upsert repair) to dev / stage

> ✅ **`0057` and `0058` were applied to dev/stage offline, owner-reported on
> 2026-09-12.** This code review found a forward-only W12 repair in `0059`;
> **`0059` still needs applying** to those environments before the normal
> PostgREST listing upsert can work. All three still need their first real
> PostgREST verification; PGlite proves the SQL shape, not a deployed API.

### What they add

| Migration | Objects |
|---|---|
| `0057_audit_subjects.sql` | 1 table (`audit_subjects`) · 1 function `upsert_audit_subject` · 1 trigger · 1 column `audits.subject_id` |
| `0058_local_directory.sql` | 4 tables (`audit_directory_listings`, `audit_local_checks`, `audit_directory_matches`, `audit_local_findings`) · 2 triggers · no new function |
| `0059_local_directory_listing_upsert.sql` | replaces 0058's expression unique index with a `NULLS NOT DISTINCT` column constraint; no new table/function/trigger |

Together they take a clean build to **101 tables / 50 functions / 27 triggers**,
which `npm run test:db` asserts (729 assertions).

### Ordering

`0055` and `0056` **must** already be applied: `audit_subjects` carries real
foreign keys to `audit_business_truth_records` (0055) and `audit_entities`
(0056), and `0058`'s check table references `audit_subjects`. `0059` must run
after `0058`. The numbering is the ordering; apply them in it.

### `0057` runs a BACKFILL, and it is re-runnable

Unlike `0055`/`0056`, `0057` writes data as well as schema: one `page` subject
per existing `audit_targets` row, then `update audits set subject_id = …` for
every audit that has none.

🔴 **Both statements are written to be safely re-applied** (`on conflict do
nothing`, plus `where a.subject_id is null`), and `npm run test:db` proves it by
running them a second time and asserting the row count does not move. A
migration that is only correct once cannot be re-applied after a partial
failure, which is exactly when you most need to.

⚠️ **`audits.subject_id` stays NULLABLE and NULL is valid.** Every audit written
before this migration has none, and the readers fall back to `target_id`. Do not
"tidy" it to `not null` later — that is the backward-compatibility contract, and
`audits.target_id` must never be dropped (see the migration header).

### Apply

Same subset path §4b uses — `npm run migrate:prod` has no stop-at-N flag and a
bare run replays everything from `0001`:

```bash
PGPASSWORD=... psql "$DEV_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/0057_audit_subjects.sql \
  -f supabase/migrations/0058_local_directory.sql \
  -f supabase/migrations/0059_local_directory_listing_upsert.sql
```

For a dev/stage project already carrying `0057` and `0058`, run **only** the
last file above. It is idempotent and preserves the existing unique invariant.

⚠️ Use the **Direct** connection string (port 5432), not the pooler, and
URL-encode special characters in the password.

### Verify

```sql
-- 1. The table and the column exist.
select count(*) from public.audit_subjects;
select column_name from information_schema.columns
 where table_schema='public' and table_name='audits' and column_name='subject_id';

-- 2. The backfill adopted every existing audit that had a target.
select count(*) as orphans
  from public.audits a
 where a.target_id is not null and a.subject_id is null;
-- Expect 0. A non-zero count means the second backfill statement did not run.

-- 3. No subject carries more or fewer than one reference.
select count(*) as malformed from public.audit_subjects
 where (target_id is not null)::int
     + (entity_id is not null)::int
     + (truth_record_id is not null)::int <> 1;
-- Expect 0. The CHECK makes this impossible; run it anyway after a backfill.

-- 4. The W12 tables are locked down like every other module table.
select tablename, rowsecurity from pg_tables
 where schemaname='public'
   and tablename in ('audit_subjects','audit_directory_listings',
                     'audit_local_checks','audit_directory_matches',
                     'audit_local_findings');
-- Expect rowsecurity = true on all five.

-- 5. Nothing is granted to anon or authenticated.
select table_name, grantee from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated')
   and table_name like 'audit_%';
-- Expect zero rows.

-- 6. The column-based upsert arbiter exists. `connullsnotdistinct = true`
-- means two NULL truth_record_id values conflict, so PostgREST can use
-- on_conflict=user_id,truth_record_id,source_id.
select conname, connullsnotdistinct
  from pg_constraint
 where conname = 'audit_dir_listing_unique';
-- Expect one row with connullsnotdistinct = true.
```

### The SECURITY DEFINER grant

`upsert_audit_subject` is `security definer` and is revoked from `public`,
`anon` and `authenticated`, granted only to `service_role` — the same posture as
`promote_business_truth_version` and `approve_entity_relationship`. Confirm:

```sql
select proname, proacl from pg_proc
 where proname = 'upsert_audit_subject';
-- proacl must NOT contain =X/ for anon or authenticated.
```

🔴 **A `security definer` function reachable by `anon` bypasses RLS by
definition.** Check this after every apply, not only the first.

## 5. Database functions — no separate step

There is nothing to run beyond the migrations. All **9 functions and 2 triggers**
are created by the files above.

| Object | Kind | Created by |
|---|---|---|
| `redeem_coupon(text,text,int,text)` | function | `0002` |
| `public_reports_touch_updated_at()` | function | `0007` |
| `public_reports_updated_at_trg` | trigger on `public_reports` | `0007` |
| `plan_rank(text)` | function | `0012` |
| `merge_entitlement_from_subscriptions(uuid)` | function | `0012` |
| `claim_billing_session(text)` | function | `0012` |
| `fy_of(timestamptz,text)` | function | `0016` |
| `next_invoice_no(text,text)` | function | `0016` |
| `issue_invoice(jsonb)` | function | `0016` |
| `invoices_immutable()` | function | `0016` |
| `invoices_immutable_trg` | trigger on `invoices` | `0016` |

Execute grants are deliberately narrow — `claim_billing_session` is the only one
granted to `authenticated`; `merge_entitlement_from_subscriptions`,
`next_invoice_no` and `issue_invoice` are revoked from both `anon` and
`authenticated` and are service-key only.

**Not database functions:** `billing-lifecycle` and `billing-purge` are Netlify
scheduled functions. They register on deploy, not via SQL, and the purge stays
disarmed until `PURGE_ENABLED=1`.

---

## 6. Post-apply verification

### 6.0 First: which migrations does this database already have?

Nothing records applied migrations — there is no `schema_migrations` table. Probe
for the objects instead. Run this **before** any of the checks below, and before
running a query that assumes a column exists:

```sql
select
  to_regclass('public.entitlements')       is not null                   as m0012_entitlements,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='subscriptions'
             and column_name='user_id')                                  as m0012_user_id,
  to_regproc('public.claim_billing_session') is not null                 as m0012_fn,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='scheduled_tasks'
             and column_name='system_paused')                            as m0015_system_paused,
  to_regclass('public.invoices')           is not null                   as m0016_invoices,
  to_regproc('public.issue_invoice')       is not null                   as m0016_fn,
  to_regclass('public.billing_notice_log') is not null                   as m0017_notice_log;
```

`0013` leaves no schema trace (it is data-only) and `0014` changes policies, not
objects — check `0014` by which policies are present:

```sql
select tablename, policyname from pg_policies
 where schemaname='public' and tablename in ('subscriptions','payment_events')
 order by 1,2;
```

`anon full access` still listed → **pre-`0014`**. `subscriptions select own` /
`payment_events select own` → **`0014` applied**.

### 6.1 Object counts

Paste into the Supabase SQL Editor. On a full `0001`–`0017` apply, expect
**26 tables / 9 functions / 2 triggers / 0 RLS-disabled tables**.

```sql
-- 26 expected
select count(*) as tables from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';

-- 9 expected
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' order by 1;

-- 2 expected
select tgname, c.relname from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal;

-- 0 rows expected: anything listed has RLS off
select relname from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and relkind='r' and not relrowsecurity;
```

Expected 26 tables: `analytics_events`, `app_config`, `billing_audit_log`,
`billing_cron_runs`, `billing_identity_links`, `billing_notice_log`,
`coupon_counters`, `coupon_redemptions`, `entitlements`, `extraction_cache`,
`extractions`, `invoice_counters`, `invoice_drafts`, `invoice_emails`,
`invoice_lines`, `invoices`, `payment_events`, `pricing_config`,
`public_reports`, `rate_limit_log`, `reengagement_log`, `scheduled_tasks`,
`subscriptions`, `summary_feedback`, `usage_alerts`, `usage_records`.

On a **fresh production** project also confirm the data is empty:

```sql
select 'extractions' t, count(*) from public.extractions
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'payment_events', count(*) from public.payment_events
union all select 'invoices', count(*) from public.invoices
union all select 'usage_records', count(*) from public.usage_records;
```

### 6.2 `0013`'s orphan count is swallowed — query it explicitly

`0013_billing_backfill.sql` reports its orphan count with `raise notice`, and
neither the runner nor the one-liner in §4 attaches a notice listener. The number
the handoff tells you to read before applying `0014` will **not** appear in the
output. Get it directly:

```sql
select (select count(*) from public.subscriptions  where user_id is null) as orphan_subs,
       (select count(*) from public.payment_events where user_id is null) as orphan_events;
```

⚠️ **Precondition: `0012` must be applied first.** `user_id` does not exist until
`0012_billing_identity.sql:19-21` adds it, so on a pre-`0012` database this query
fails with:

```
ERROR: 42703: column "user_id" does not exist
```

That error means "0012 hasn't run here" — not a broken query. Confirm with the
probe in §6.0, apply `0012`, then re-run. The count is only meaningful in the
window **after `0013`, before `0014`**; before `0013` every row is unclaimed, so
the number is just "all of them".

These are genuine unclaimed guest purchases. After `0014` they are service-key
only — the intended end state, but know the number first.

### 6.3 Invoice numbering sanity

```sql
select * from public.invoice_counters order by 1;      -- one row per (series, FY)
select public.fy_of(now());                            -- FY boundary is 1 April IST
```

---

## 7. Failure modes seen or anticipated

| Symptom | Cause / fix |
|---|---|
| `getaddrinfo ENOTFOUND db.…supabase.co` | Wrong project ref, or the password contains an un-encoded `@` that split the host |
| `Refusing to migrate: current_database is "…"` | Connection string points somewhere that is not a Supabase `postgres` DB |
| `password authentication failed` | Using the pooler string, or an un-encoded special character in the password |
| Hangs on connect | Pooler port (6543) instead of Direct (5432) |
| A `0016`/`0017` file fails mid-way | That file rolled back; nothing partial landed. Fix and re-run — idempotent |
| PostgREST 404s on a new table right after migrating | Schema cache. `0013`/`0016` end with `notify pgrst, 'reload schema'`; otherwise reload from the dashboard |

## 8. Rollback

`supabase/migrations/rollback.sql` exists and is **destructive** — the runner
excludes it on purpose. It is not part of any normal flow; read it in full before
even considering it, and never point it at a database with real payment history.

## 9. Keeping `run-all.sql` honest

`run-all.sql` is **generated**, not hand-written:

```bash
npm run build:sql
```

`npm run build:sql -- --check` is the CI form. It drifted once before (its header
claimed `0001`–`0011` while the file only contained `0001`–`0009`, so fresh
databases bootstrapped from it silently lacked `rate_limit_log` and
`reengagement_log`). Regenerate it whenever a numbered migration changes.
