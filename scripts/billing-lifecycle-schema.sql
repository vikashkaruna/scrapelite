-- scripts/billing-lifecycle.sql — PR3 (dunning log + admin audit trail).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.

-- ── Notice log ────────────────────────────────────────────────────────────────
-- One row per (user, notice kind, billing cycle). The unique constraint IS the
-- idempotency mechanism, and it is also the index the cron reads.
--
-- TWO DELIBERATE DIFFERENCES FROM reengagement_log (0011), both of which are
-- bugs there that must not be inherited:
--
--  1. KEYED ON user_id, NOT EMAIL. reengagement_log keys on user_email. Emails
--     change; a user who updates theirs would silently receive the entire
--     notice series a second time.
--
--  2. window_key IS ANCHORED ON THE CYCLE, NOT ON TODAY. reengagement.js
--     builds `d7:${today}`, so a permanently-inactive user matches a fresh
--     window every single day and is emailed daily forever. For billing that is
--     catastrophic: a suspended customer would receive "your data will be
--     deleted in 7 days" every morning for two months. Here window_key is the
--     period_end date of the cycle the notice belongs to, e.g.
--     'lapsed:2026-08-14', so each notice fires exactly once per subscription
--     cycle no matter how often the cron runs.
create table if not exists public.billing_notice_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null,          -- renewal_t7 | renewal_t2 | lapsed_d0 | suspend_d7 |
                                     -- suspend_d21 | deactivate_d30 | delete_d83 |
                                     -- delete_d88 | delete_d90 | downgrade_scheduled
  window_key text not null,          -- 'lapsed:2026-08-14' — the CYCLE, never today
  channel    text not null default 'email',
  sent_at    timestamptz not null default now(),
  unique (user_id, kind, window_key)
);

create index if not exists billing_notice_log_user_idx on public.billing_notice_log (user_id, sent_at desc);

alter table public.billing_notice_log enable row level security;
-- Service key only: the crons write it and nothing in the browser reads it.

-- ── Admin audit trail ─────────────────────────────────────────────────────────
-- Every manual override of the billing lifecycle. An admin can suspend an
-- account, restore one without payment, grant free time, or record money that
-- never went through the gateway — all of which need to be attributable and
-- explained. `reason` is NOT NULL on purpose: the API requires one.
create table if not exists public.billing_audit_log (
  id         bigserial primary key,
  actor      text not null,            -- admin identity from the session token
  action     text not null,            -- suspend | reactivate | comp | offline_payment |
                                       -- plan_change | invoice_resend | invoice_regenerate |
                                       -- refund
  user_id    uuid references auth.users,
  invoice_id uuid references public.invoices (id),
  reason     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_audit_log_user_idx    on public.billing_audit_log (user_id, created_at desc);
create index if not exists billing_audit_log_created_idx on public.billing_audit_log (created_at desc);

alter table public.billing_audit_log enable row level security;   -- service key only

-- ── Cron heartbeat ────────────────────────────────────────────────────────────
-- billing-purge refuses to delete anything unless billing-lifecycle has
-- succeeded recently. Without this, a dunning cron that silently stopped (a bad
-- deploy, a disabled schedule) plus a healthy purge cron would delete data from
-- users who were never warned. That combination is the single worst failure
-- mode in this whole feature, so the interlock gets its own table.
create table if not exists public.billing_cron_runs (
  job          text primary key,       -- 'billing-lifecycle' | 'billing-purge'
  last_success timestamptz,
  last_detail  jsonb not null default '{}'::jsonb
);

alter table public.billing_cron_runs enable row level security;   -- service key only

notify pgrst, 'reload schema';
