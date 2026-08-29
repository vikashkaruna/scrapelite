-- Server-authoritative anonymous identity and usage counters.
-- Raw guest identifiers are never stored; the server stores only a SHA-256 hash.

create table if not exists public.guest_identities (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  single_count  integer not null default 0 check (single_count >= 0),
  batch_count   integer not null default 0 check (batch_count >= 0),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists guest_identities_last_seen_idx on public.guest_identities (last_seen_at);
alter table public.guest_identities enable row level security;

create or replace function public.consume_guest_credit(
  p_token_hash text,
  p_kind text default 'single',
  p_single_limit integer default 10,
  p_batch_limit integer default 5
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_guest public.guest_identities; current_count integer; max_count integer;
begin
  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_guest_identity', 'remaining', 0);
  end if;
  insert into public.guest_identities (token_hash) values (p_token_hash) on conflict (token_hash) do nothing;
  select * into row_guest from public.guest_identities where token_hash = p_token_hash for update;
  if p_kind = 'batch' then
    current_count := row_guest.batch_count; max_count := greatest(coalesce(p_batch_limit, 5), 1);
  else
    current_count := row_guest.single_count; max_count := greatest(coalesce(p_single_limit, 10), 1);
  end if;
  if current_count >= max_count then
    update public.guest_identities set last_seen_at = now(), updated_at = now() where id = row_guest.id;
    return jsonb_build_object('allowed', false, 'reason', p_kind || '_limit_reached', 'remaining', 0, 'kind', p_kind);
  end if;
  if p_kind = 'batch' then
    update public.guest_identities set batch_count = batch_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
    current_count := row_guest.batch_count + 1;
  else
    update public.guest_identities set single_count = single_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
    current_count := row_guest.single_count + 1;
  end if;
  return jsonb_build_object('allowed', true, 'remaining', greatest(max_count - current_count, 0), 'kind', p_kind);
end;
$$;

revoke all on public.guest_identities from anon, authenticated;
revoke all on function public.consume_guest_credit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_credit(text, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
