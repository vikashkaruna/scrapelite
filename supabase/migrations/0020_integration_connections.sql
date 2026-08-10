-- 0020_integration_connections.sql
-- Per-user OAuth/PAT storage for third-party integrations (HubSpot, Notion,
-- Airtable, Slack, Zapier). All integrations that need to call an external
-- API on the user's behalf read their token from this table.
--
-- SECURITY: access_token and refresh_token are sensitive. v1 stores them
-- in plaintext (the only reader is the SERVICE key holder, and RLS further
-- restricts per-user visibility). v1.1 should add a pgcrypto envelope.

create table if not exists public.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('hubspot','notion','airtable','slack','zapier','google_sheets')),
  access_token  text,
  refresh_token text,
  scopes        text,
  account_id    text,
  account_label text,
  expires_at    timestamptz,
  config        jsonb,                       -- provider-specific
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists integration_connections_user_idx
  on public.integration_connections (user_id);

alter table public.integration_connections enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'integration_connections' and policyname = 'users own connections'
  ) then
    execute $POL$
      create policy "users own connections" on public.integration_connections
        for all to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $POL$;
  end if;
end $$;

-- Service role can read/write all rows (the /api/* functions use the
-- SERVICE key to do server-side work on the user's behalf).
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'integration_connections' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.integration_connections
             for all to service_role using (true) with check (true)';
  end if;
end $$;
