-- 0028_scrape_consent.sql
-- Per-host scraping attestations ("I have permission to scrape this site").
--
-- ── What this is, and what it is NOT ─────────────────────────────────────
-- DatIQ honours robots.txt by default (netlify/functions/lib/complianceEngine.js).
-- When a host disallows us, the refusal stands unless the person asking has
-- told us, on the record, that they have permission for that host. This table
-- is that record. It is an OVERRIDE, not a bypass: the robots.txt check still
-- runs and still decides, and this only answers the follow-up question "is
-- there an attestation for this user and this host?".
--
-- ── Signed-in only, deliberately ─────────────────────────────────────────
-- user_id is NOT NULL, unlike 0023_consent.sql, which keys on an anonymous
-- session precisely so pre-signup visitors are covered. The opposite is right
-- here. An attestation moves responsibility for a scrape onto the person
-- making it, and a guest identity — a cookie that survives until it is
-- cleared — is nobody to move it to. A guest can re-attest infinitely and
-- cannot be held to it. Anonymous callers are refused and asked to sign in.
--
-- ── Two tables, same reasoning as 0023 ───────────────────────────────────
--   scrape_consent_records — current state. One row per (user, host).
--   scrape_consent_audit   — append-only history, trigger-enforced.
-- A mutable single table cannot show that permission was claimed in March and
-- withdrawn in August, and an audit trail whose rows can be edited is not an
-- audit trail.
--
-- RLS is enabled with NO anon and NO authenticated policy, deliberately: these
-- rows are written and read only by the service key, via
-- netlify/functions/scrape-consent.js, which resolves the user from the JWT.
-- A client that could write here could forge its own authorisation to scrape.

create table if not exists public.scrape_consent_records (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Normalised by the handler: lowercased, leading "www." stripped, so
  -- www.example.com and example.com are ONE grant. It deliberately does not
  -- extend to other subdomains — permission for a company's careers site is
  -- not permission for its API host.
  host           text not null,
  policy_version text not null,
  granted_at     timestamptz not null default now(),
  -- A self-certification should not outlive the circumstances it was made in.
  -- 180 days, then it must be renewed.
  expires_at     timestamptz not null default (now() + interval '180 days'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, host)
);

create index if not exists scrape_consent_records_lookup_idx
  on public.scrape_consent_records (user_id, host);

create table if not exists public.scrape_consent_audit (
  id             uuid primary key default gen_random_uuid(),
  -- Plain uuid, NO foreign key — the same two load-bearing reasons spelled out
  -- in 0023_consent.sql: an `on delete set null` would UPDATE this row when a
  -- user is deleted, which the append-only trigger below rejects, making
  -- account deletion fail outright; and an audit row records that an
  -- attestation was made, so it should survive its subject rather than be
  -- silently rewritten. scrape_consent_records keeps the real FK, so the
  -- CURRENT state still disappears with the account.
  user_id        uuid not null,
  host           text not null,
  action         text not null check (action in ('granted', 'withdrawn', 'expired')),
  policy_version text not null,
  source         text not null check (source in ('extract_refusal', 'settings', 'withdrawal')),
  user_agent     text,
  -- Coarse ISO country only, from Netlify's geo context. NEVER an IP address —
  -- same posture as consent_audit in 0023.
  country        text,
  ts             timestamptz not null default now()
);

create index if not exists scrape_consent_audit_user_time_idx
  on public.scrape_consent_audit (user_id, ts desc);

alter table public.scrape_consent_records enable row level security;
alter table public.scrape_consent_audit   enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'scrape_consent_records' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.scrape_consent_records
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'scrape_consent_audit' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.scrape_consent_audit
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- Append-only at the DATABASE level, not merely by convention. A trigger is the
-- only thing that makes that survive a future handler bug or an operator with
-- the service key doing a well-meant cleanup.
create or replace function public.scrape_consent_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'scrape_consent_audit is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists scrape_consent_audit_no_change on public.scrape_consent_audit;
create trigger scrape_consent_audit_no_change
  before update or delete on public.scrape_consent_audit
  for each row execute function public.scrape_consent_audit_immutable();
