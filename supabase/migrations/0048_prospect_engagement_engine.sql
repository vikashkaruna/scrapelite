-- 0048_prospect_engagement_engine.sql
--
-- Prospect Engagement Engine: Modular, n8n-orchestrated multi-channel outreach engine.
-- Adds 5 tables:
--   1. engagement_campaigns: outreach campaign definitions, brand kits, and settings
--   2. engagement_prospects: prospect records with state machine status and engagement scoring
--   3. engagement_messages: AI-generated copy variants (A/B), approval states, and delivery status
--   4. engagement_activity_log: immutable chronological audit log of all transitions & events
--   5. engagement_sync_configs: Google Sheets and Airtable two-way sync configurations
--
-- Security: Strict RLS with service-role-only access conforming to migration 0044 standards.

-- ── 1. engagement_campaigns ─────────────────────────────────────────────────
create table if not exists public.engagement_campaigns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  workspace_id      uuid references public.workspaces(id) on delete cascade,
  name              text not null,
  description       text,
  status            text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  channel_priority  jsonb not null default '["email", "whatsapp", "sms"]'::jsonb,
  brand_kit         jsonb not null default '{}'::jsonb,
  settings          jsonb not null default '{"followup_delay_days": 4, "max_followups": 2, "require_approval": true}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists engagement_campaigns_user_idx on public.engagement_campaigns (user_id, created_at desc);

-- ── 2. engagement_prospects ─────────────────────────────────────────────────
create table if not exists public.engagement_prospects (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  campaign_id         uuid not null references public.engagement_campaigns(id) on delete cascade,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  company             text,
  role                text,
  industry            text,
  country             text,
  status              text not null default 'new' check (
    status in ('new', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'followup_due', 'converted', 'unresponsive', 'opted_out')
  ),
  channel_preference  text not null default 'auto' check (channel_preference in ('email', 'whatsapp', 'telegram', 'sms', 'auto')),
  source              text not null default 'manual' check (source in ('manual', 'datiq_extraction', 'datiq_list', 'google_sheets', 'airtable', 'csv')),
  source_id           text,
  custom_attributes   jsonb not null default '{}'::jsonb,
  engagement_score    integer not null default 0,
  last_contacted_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists engagement_prospects_campaign_idx on public.engagement_prospects (campaign_id, status);
create index if not exists engagement_prospects_user_idx on public.engagement_prospects (user_id, created_at desc);
create index if not exists engagement_prospects_email_idx on public.engagement_prospects (campaign_id, email) where email is not null;
create index if not exists engagement_prospects_phone_idx on public.engagement_prospects (campaign_id, phone) where phone is not null;

-- ── 3. engagement_messages ──────────────────────────────────────────────────
create table if not exists public.engagement_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  campaign_id         uuid not null references public.engagement_campaigns(id) on delete cascade,
  prospect_id         uuid not null references public.engagement_prospects(id) on delete cascade,
  channel             text not null check (channel in ('email', 'whatsapp', 'telegram', 'sms')),
  variant             text not null default 'A' check (variant in ('A', 'B', 'C')),
  subject             text,
  body                text not null,
  body_html           text,
  status              text not null default 'draft' check (
    status in ('draft', 'pending_approval', 'approved', 'rejected', 'queued', 'sent', 'delivered', 'failed', 'opened', 'clicked', 'replied')
  ),
  approval_status     text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  rejection_reason    text,
  guardrail_checks    jsonb not null default '{"passed": true, "violations": []}'::jsonb,
  external_message_id text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  replied_at          timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists engagement_messages_prospect_idx on public.engagement_messages (prospect_id, created_at desc);
create index if not exists engagement_messages_campaign_idx on public.engagement_messages (campaign_id, status);

-- ── 4. engagement_activity_log ──────────────────────────────────────────────
create table if not exists public.engagement_activity_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  campaign_id         uuid not null references public.engagement_campaigns(id) on delete cascade,
  prospect_id         uuid not null references public.engagement_prospects(id) on delete cascade,
  message_id          uuid references public.engagement_messages(id) on delete set null,
  event_type          text not null,
  channel             text,
  from_status         text,
  to_status           text,
  details             jsonb not null default '{}'::jsonb,
  timestamp           timestamptz not null default now()
);

create index if not exists engagement_activity_prospect_idx on public.engagement_activity_log (prospect_id, timestamp desc);
create index if not exists engagement_activity_campaign_idx on public.engagement_activity_log (campaign_id, timestamp desc);

-- ── 5. engagement_sync_configs ──────────────────────────────────────────────
create table if not exists public.engagement_sync_configs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  campaign_id         uuid not null references public.engagement_campaigns(id) on delete cascade,
  provider            text not null check (provider in ('google_sheets', 'airtable')),
  config              jsonb not null default '{}'::jsonb,
  last_synced_at      timestamptz,
  sync_status         text not null default 'idle' check (sync_status in ('idle', 'syncing', 'success', 'error')),
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists engagement_sync_campaign_idx on public.engagement_sync_configs (campaign_id, provider);

-- ── Helper trigger functions for updated_at ─────────────────────────────────
create or replace function public.engagement_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists engagement_campaigns_touch_updated_at on public.engagement_campaigns;
create trigger engagement_campaigns_touch_updated_at
  before update on public.engagement_campaigns
  for each row execute function public.engagement_touch_updated_at();

drop trigger if exists engagement_prospects_touch_updated_at on public.engagement_prospects;
create trigger engagement_prospects_touch_updated_at
  before update on public.engagement_prospects
  for each row execute function public.engagement_touch_updated_at();

drop trigger if exists engagement_messages_touch_updated_at on public.engagement_messages;
create trigger engagement_messages_touch_updated_at
  before update on public.engagement_messages
  for each row execute function public.engagement_touch_updated_at();

drop trigger if exists engagement_sync_configs_touch_updated_at on public.engagement_sync_configs;
create trigger engagement_sync_configs_touch_updated_at
  before update on public.engagement_sync_configs
  for each row execute function public.engagement_touch_updated_at();

-- ── RLS & Security ──────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_campaigns',
    'engagement_prospects',
    'engagement_messages',
    'engagement_activity_log',
    'engagement_sync_configs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);

    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = 'service full access'
    ) then
      execute format(
        'create policy "service full access" on public.%I '
        'for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;
