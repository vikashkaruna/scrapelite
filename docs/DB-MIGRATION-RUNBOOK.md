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
