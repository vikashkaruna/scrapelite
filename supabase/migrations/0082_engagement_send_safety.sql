-- 0082_engagement_send_safety.sql
--
-- Makes the Prospect Engagement Engine (0081) safe to send a real message.
-- Review: docs/PROSPECT-ENGAGEMENT-ENGINE-REVIEW-AND-ROLLOUT.md (F-1 … F-8).
--
-- ── WHAT THIS ADDS, AND THE DEFECT EACH PIECE CLOSES ────────────────────────
--
--   1. engagement_suppressions — the opt-out record (F-3).
--      0081 stored an opt-out as a STATUS on one prospect row, so the same
--      person in a second campaign was still contactable, and a status can be
--      overwritten by the next transition. Consent is a fact about a PERSON on
--      a CHANNEL, not about a row in a campaign: one row per
--      (tenant, channel, normalised address), checked inside the send claim.
--      ⚠️ PER CHANNEL, deliberately (owner decision 2026-09-23). "Stop emailing
--      me" is not "stop texting me". A multi-channel opt-out is several rows,
--      written together by the unsubscribe page or the dashboard.
--
--   2. Send-claim columns on engagement_messages — F-1.
--      0081's dispatcher selected every approved message and sent it without
--      recording the send, so a second dispatch sent everything again. A send
--      is now claimed with a conditional UPDATE (status 'queued' → 'sending')
--      whose row count decides who sends — the 0063 pattern, never a
--      read-then-write. `external_message_id` is unique per provider so an
--      inbound webhook correlates to exactly one message (F-6).
--
--   3. Prospect uniqueness per campaign — dedupe was read-then-write and raced.
--
--   4. engagement_activity_log is append-only — 0081's header called it
--      "immutable" and nothing enforced it. UPDATE is refused; DELETE is not,
--      because deleting a campaign must still cascade.
--
--   5. engagement_campaigns.sender — who a campaign sends as (F-8). Validated
--      server-side against an operator allow-list of sending domains.
--
--   6. credit_ledger gains reason 'outreach' / unit 'message' so a sent
--      message can be charged (F-10). A kind that maps to a reason this CHECK
--      refuses writes nothing and bills nobody — creditWeights.test.js pins it.
--
-- Re-runnable: every statement is idempotent.

-- ── 1. engagement_suppressions ──────────────────────────────────────────────
create table if not exists public.engagement_suppressions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  channel      text not null check (channel in ('email', 'whatsapp', 'sms', 'telegram')),
  -- Normalised by suppressionModel.normalizeAddress(): lower-cased email,
  -- digits-and-leading-plus phone. Never the raw value, or "A@x.com" and
  -- "a@x.com" would be two people.
  address      text not null check (length(btrim(address)) > 0),
  reason       text not null check (reason in (
    'unsubscribe',   -- recipient used the unsubscribe page / one-click header
    'stop_keyword',  -- recipient replied STOP (SMS / WhatsApp)
    'bounce',        -- hard bounce: the address does not exist
    'complaint',     -- recipient marked it as spam
    'manual'         -- the tenant opted the contact out from the dashboard
  )),
  source       text not null default 'dashboard',
  prospect_id  uuid references public.engagement_prospects(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  -- Column list, not an expression: a PostgREST upsert arbiter must name
  -- columns (the 0058 → 0059 lesson).
  constraint engagement_suppressions_unique unique (user_id, channel, address)
);

create index if not exists engagement_suppressions_lookup_idx
  on public.engagement_suppressions (user_id, channel, address);

-- ── 2. Send claim + provider correlation on messages ────────────────────────
alter table public.engagement_messages
  add column if not exists claimed_at   timestamptz,
  add column if not exists provider     text,
  add column if not exists failure_code text,
  add column if not exists attempts     integer not null default 0;

-- 'sending' is the claim; 'skipped' is a message that will never be sent
-- (suppressed, channel not enabled, no address) — distinct from 'failed',
-- which is a provider refusing a real attempt.
alter table public.engagement_messages
  drop constraint if exists engagement_messages_status_check;
alter table public.engagement_messages
  add constraint engagement_messages_status_check check (status in (
    'draft', 'pending_approval', 'approved', 'rejected', 'queued', 'sending',
    'sent', 'delivered', 'failed', 'skipped', 'opened', 'clicked', 'replied'
  ));

create unique index if not exists engagement_messages_provider_id_uidx
  on public.engagement_messages (provider, external_message_id)
  where external_message_id is not null;

create index if not exists engagement_messages_queue_idx
  on public.engagement_messages (status, created_at)
  where status in ('queued', 'sending');

-- ── 3. One prospect per address per campaign ────────────────────────────────
-- Stored values are already normalised by the store; lower() is belt and braces
-- for rows written before this migration.
create unique index if not exists engagement_prospects_campaign_email_uidx
  on public.engagement_prospects (campaign_id, lower(email))
  where email is not null;
create unique index if not exists engagement_prospects_campaign_phone_uidx
  on public.engagement_prospects (campaign_id, phone)
  where phone is not null;

-- ── 4. The activity log is append-only ──────────────────────────────────────
create or replace function public.engagement_activity_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'engagement_activity_log is append-only'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.engagement_activity_log_immutable() from public, anon, authenticated;

drop trigger if exists engagement_activity_log_no_update on public.engagement_activity_log;
create trigger engagement_activity_log_no_update
  before update on public.engagement_activity_log
  for each row execute function public.engagement_activity_log_immutable();

-- ── 5. Who a campaign sends as ──────────────────────────────────────────────
alter table public.engagement_campaigns
  add column if not exists sender jsonb not null default '{}'::jsonb;

-- ── 6. The ledger can record a sent message ─────────────────────────────────
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_chk;
alter table public.credit_ledger add constraint credit_ledger_reason_chk check (reason in (
  'page_fetch', 'ai_call', 'enrichment', 'audit', 'monitor_check',
  'template_run', 'refund', 'grant', 'adjustment', 'outreach'
));
alter table public.credit_ledger drop constraint if exists credit_ledger_unit_chk;
alter table public.credit_ledger add constraint credit_ledger_unit_chk check (unit is null or unit in (
  'page', 'ai_call', 'enrichment', 'audit', 'monitor_check', 'run', 'message'
));

-- ── RLS: service role only, like every 0044-era table ───────────────────────
alter table public.engagement_suppressions enable row level security;
revoke all on public.engagement_suppressions from anon;
revoke all on public.engagement_suppressions from authenticated;
grant all on public.engagement_suppressions to service_role;
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'engagement_suppressions'
       and policyname = 'service full access'
  ) then
    create policy "service full access" on public.engagement_suppressions
      for all to service_role using (true) with check (true);
  end if;
end $$;
