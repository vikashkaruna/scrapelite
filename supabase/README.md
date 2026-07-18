# DatIQ v1.0 — Supabase Database

This folder contains every SQL script that must run on the Supabase project to bring the v1.0
release up. The scripts are idempotent, ordered by dependency, and safe to re-run on a fresh or
partially-migrated database.

## Folder layout

```
supabase/
├── README.md                          ← you are here
└── migrations/
    ├── run-all.sql                    ← single-file orchestrator (paste-and-run)
    ├── 0001_core_tables_and_billing.sql
    ├── 0002_pricing_and_coupons.sql
    ├── 0003_ai_config.sql
    ├── 0004_scheduler.sql
    ├── 0005_analytics.sql
    ├── 0006_provenance.sql
    ├── 0007_public_reports.sql
    ├── 0008_summary_feedback.sql
    ├── 0009_extraction_cache.sql      ← optional (FD2 perf)
    ├── 0010_rate_limit_log.sql        ← optional (FD3 shared limit)
    ├── 0011_reengagement_log.sql      ← optional (F49 dedup)
    └── rollback.sql                   ← DESTRUCTIVE — see warning below
```

The same scripts are mirrored in `scripts/` for source control with the rest of the codebase.

## How to run

### Quick path (recommended)

1. Open the Supabase dashboard for the production project.
2. Go to **SQL Editor** → **New query**.
3. Open `supabase/migrations/run-all.sql`, copy the entire content, paste it.
4. Click **Run** (or `Ctrl/Cmd+Enter`).
5. Wait for the green "Success" banner.
6. The final `NOTIFY pgrst, 'reload schema'` line tells PostgREST to refresh its
   schema cache so the API picks up the new tables and the `redeem_coupon` RPC immediately.

### Step-by-step path (for reviewing each change)

Run the numbered files one at a time, in order, in the SQL Editor. Each is idempotent so a
re-run is harmless.

## Verification

After the migration finishes, run the following snippet in the SQL Editor to confirm every
table exists:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'extractions',
    'usage_records', 'usage_alerts',
    'subscriptions', 'payment_events',
    'pricing_config', 'coupon_redemptions', 'coupon_counters',
    'app_config',
    'scheduled_tasks',
    'analytics_events',
    'public_reports',
    'summary_feedback',
    'extraction_cache',
    'rate_limit_log',
    'reengagement_log'
  )
order by table_name;
```

You should see **16 rows** (14 v1.0 tables + the legacy `extractions` base table — `extraction_cache`,
`rate_limit_log`, and `reengagement_log` are optional perf / dedup tables).

Also verify the `redeem_coupon` RPC is registered:

```sql
select proname from pg_proc where proname = 'redeem_coupon';
```

## RLS policies summary

| Table | RLS | Anon read | Anon write | Service-key access |
|---|---|---|---|---|
| `extractions` | ✅ | ✅ (owner-only filter) | ✅ | ✅ |
| `usage_records` | ✅ | ✅ | ✅ | ✅ |
| `usage_alerts` | ✅ | ✅ | ✅ | ✅ |
| `subscriptions` | ✅ | ✅ | ✅ | ✅ |
| `payment_events` | ✅ | ✅ | ✅ | ✅ |
| `pricing_config` | ✅ | ❌ (no anon policy) | ❌ | ✅ (service key only) |
| `coupon_redemptions` | ✅ | ❌ | ❌ | ✅ |
| `coupon_counters` | ✅ | ❌ | ❌ | ✅ |
| `app_config` | ✅ | ❌ | ❌ | ✅ |
| `scheduled_tasks` | ✅ | ✅ (owner-only) | ✅ | ✅ |
| `analytics_events` | ✅ | ✅ | ✅ | ✅ |
| `public_reports` | ✅ | ✅ | ✅ | ✅ |
| `summary_feedback` | ✅ | ✅ | ✅ | ✅ |
| `extraction_cache` | ✅ | ✅ | ❌ | ✅ |
| `rate_limit_log` | ✅ | ❌ | ❌ | ✅ |
| `reengagement_log` | ✅ | ❌ | ❌ | ✅ |

`pricing_config`, `coupon_*`, `app_config`, `rate_limit_log`, and `reengagement_log` are
**service-key only** because they back real-money charges or internal observability — anon
write would be a security hole.

## Rollback

`rollback.sql` is provided for **clean test-database teardown only**. It drops every table
and the `redeem_coupon` RPC created by the migrations.

**⚠️ DESTRUCTIVE — there is no undo.** Never run on a database with real customer data. The
recommended pattern is:

```sql
BEGIN;
\i supabase/migrations/rollback.sql
-- Inspect row counts / table list to confirm you're in the right place.
SELECT count(*) FROM public.extractions;  -- Should be the same as before
-- When satisfied:
COMMIT;
-- Or if anything looks wrong:
ROLLBACK;
```

A `pg_dump` taken immediately before the rollback is the safety net.

## Notes on each migration

### 0001 — core + billing

Adds the V2 columns to `extractions`, then creates the V5/V5c tables: `usage_records`,
`usage_alerts`, `subscriptions`, `payment_events`. All have a permissive "anon full access"
policy because the app uses anon-key writes from the browser (with service-key writes from
the Netlify Functions for protected operations).

### 0002 — pricing + coupons

`pricing_config` is the operator-editable price/coupon table the `/admin/pricing` panel writes
to (currently the admin UI only emits SQL for the operator to paste — no public write API).
`coupon_redemptions` + `coupon_counters` enforce one-per-user + maxUses at the DB level via
the `redeem_coupon` RPC, which `create-checkout.js` calls.

### 0003 — app_config

Stores the AI provider chain (provider names, model ids, order, enable flags). Read by
`netlify/functions/lib/aiProviders.js` (loadAiConfig) and written by
`netlify/functions/admin-ai-config.js` (admin-token-gated). Non-secret; keys live in Netlify
env only.

### 0004 — scheduler

`scheduled_tasks` is what the R19 `scheduled-runner` Netlify Scheduled Function reads
every hour. It stores the cadence, intent, alert email, and last-run status. Without this
table, the scheduled function will error on each run; scheduled runs that haven't fired
yet will be silently dropped.

### 0005 — analytics_events

Product-analytics event log. Append-only, no per-row indexing beyond the primary key. RLS
open because the recorded data is non-PII (no email, no user content).

### 0006 — provenance

Adds a `provenance` jsonb column to `extractions`. The Q9 metadata (source URL, field count,
avg confidence, per-field provenance details) is generated on extract and attached to new
rows. Existing rows are unaffected (column is nullable).

### 0007 — public_reports

The Q8 shareable-link feature. One row per shared extraction. `slug` is the only auth —
anyone with the URL can read. The frontend writes via anon insert, deletes via owner-only
update/delete policy. RLS intentionally open on read.

### 0008 — summary_feedback

The F06 thumbs-up / thumbs-down widget. Records rating + optional free-text comment per
extraction. Used to improve the AI model.

### 0009 — extraction_cache *(optional, for FD2 perf)*

The FD2 result cache. Server checks this table before invoking the scrape provider chain,
so repeated extractions of the same URL within the TTL cost zero provider calls. Anon
read is REQUIRED for guest users. Writes are service-key-only to prevent cache poisoning.

### 0010 — rate_limit_log *(optional, for FD3 shared limit)*

The FD3 cross-warm-container rate limit log. The primary in-process limiter lives in
`netlify/functions/lib/rateLimiter.js` and works without this table. This table is the
durable extension point for shared infra with multiple warm containers (each container
has its own in-process bucket; the table aggregates them).

### 0011 — reengagement_log *(optional, for F49 dedup)*

The F49 re-engagement email dedup log. The `reengagement.js` Netlify function writes here
so it never emails the same user twice for the same trigger (e.g. the same ISO week for
the weekly digest).

## Production migration runbook

See `docs/PRODUCTION-RELEASE-V1.0.md` for the full step-by-step production migration
runbook (config → migrate → deploy → smoke test → monitor).

## Schema cache gotcha

After running migrations, the PostgREST API may 404 the new tables for up to a few
seconds. The `NOTIFY pgrst, 'reload schema'` at the end of `run-all.sql` triggers an
immediate reload, but if the API still doesn't see a new table, trigger it manually:

```sql
NOTIFY pgrst, 'reload schema';
```

Or wait 30 seconds — the schema cache auto-reloads on a timer as a fallback.
