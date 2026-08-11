-- 0019_api_keys.sql
-- Public REST API keys (F-INT-1 — API Access, Business/Enterprise plans).
--
-- The public Developer API (docs/DatIQ-Developer-API.md) lets customers hit
-- DatIQ from their own code with a bearer token. This migration creates:
--   * api_keys       — the keys themselves, hashed, with revocation + expiry
--   * api_key_usage  — monthly counter for per-key quota enforcement
--   * increment_api_key_usage() RPC — atomic counter bump
--
-- Security model: only the SHA-256 hash of the key is stored. The plaintext
-- is shown ONCE at creation time and never persisted. A DB leak does not
-- leak usable keys.

create extension if not exists "pgcrypto";

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_hash      text not null unique,
  key_prefix    text not null,                        -- e.g. "dq_live_aB3x…"
  env           text not null check (env in ('live','test')),
  label         text,
  plan_id       text,                                  -- plan at issue time
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists api_keys_user_idx       on public.api_keys (user_id);
create index if not exists api_keys_hash_idx       on public.api_keys (key_hash);
create index if not exists api_keys_active_idx     on public.api_keys (user_id) where revoked_at is null;

alter table public.api_keys enable row level security;
-- A user can manage their own keys. The /api/* functions use the SERVICE
-- key to read/write (RLS bypassed) because the request's auth identity is
-- the key, not a Supabase user JWT.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'api_keys' and policyname = 'users own api_keys'
  ) then
    execute $POL$
      create policy "users own api_keys" on public.api_keys
        for all to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $POL$;
  end if;
end $$;

-- ── Monthly quota counter ───────────────────────────────────────────────────
-- One row per (key, month). `month` is 'YYYY-MM'. We don't need a unique
-- constraint on month format because we control writes from the service.
create table if not exists public.api_key_usage (
  key_id  uuid not null references public.api_keys(id) on delete cascade,
  month   text not null,
  count   integer not null default 0,
  primary key (key_id, month)
);

alter table public.api_key_usage enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'api_key_usage' and policyname = 'service manages usage'
  ) then
    execute 'create policy "service manages usage" on public.api_key_usage
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Atomic increment RPC ────────────────────────────────────────────────────
-- Returns the new count for (key_id, month), creating the row if needed.
-- Used by lib/apiRateLimiter.js to enforce the monthly quota without
-- read-modify-write races.
create or replace function public.increment_api_key_usage(p_key_id uuid, p_month text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.api_key_usage (key_id, month, count)
    values (p_key_id, p_month, 1)
    on conflict (key_id, month)
    do update set count = public.api_key_usage.count + 1
    returning count into new_count;
  return new_count;
end;
$$;

-- Restrict execution to the service role. (An authenticated user calling
-- this directly could inflate another user's counter, even with RLS on
-- api_key_usage, so we lock the function down.)
revoke all on function public.increment_api_key_usage(uuid, text) from public;
grant execute on function public.increment_api_key_usage(uuid, text) to service_role;
