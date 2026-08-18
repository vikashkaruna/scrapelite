-- 0023_consent.sql
-- Analytics-consent records and their audit trail.
--
-- Why this exists at all: a consent choice kept only in localStorage cannot
-- answer the two questions that matter when someone asks. "When did I agree,
-- and to what?" needs a durable, timestamped, policy-versioned record. "Delete
-- my analytics data" needs a key to delete BY. A browser key provides neither
-- the moment it is cleared.
--
-- ── Subject keying ───────────────────────────────────────────────────────
-- Most consent is given BEFORE signup — a visitor lands from search, answers
-- the banner, and only creates an account later, if ever. So the subject is
-- keyed on the anonymous session id (usageRepo.getSessionId), and user_id is
-- back-filled when that session later signs in. Keying on user_id alone would
-- mean no record for the majority of visitors, which is exactly the population
-- a regulator asks about.
--
-- ── Two tables, on purpose ───────────────────────────────────────────────
--   consent_records — current state. One row per subject, upserted.
--   consent_audit   — append-only history. Every change, forever.
-- A single mutable table cannot show that consent was granted in March and
-- withdrawn in August; an audit trail whose rows can be updated is not an
-- audit trail. Same reasoning as ops_audit_log in 0018.
--
-- ── Privacy of the consent record itself ─────────────────────────────────
-- No raw IP is stored. A coarse country (from Netlify's own geo context) is
-- enough to reason about which regime applies, and collecting a full IP to
-- prove someone consented to analytics would be self-defeating.
--
-- RLS is enabled with NO anon policy, deliberately: these rows are written and
-- read only by the service key via /api/consent. Same posture as
-- pricing_config — a client that could write here could forge consent.

create table if not exists public.consent_records (
  id             uuid primary key default gen_random_uuid(),
  -- 'session:<id>' before sign-in, so the natural key is stable and unique
  -- whether or not a user_id is ever attached.
  subject_key    text not null unique,
  session_id     text not null,
  user_id        uuid references auth.users(id) on delete cascade,
  analytics      text not null check (analytics in ('granted','denied')),
  policy_version text not null,
  -- GA4's User Deletion API keys on client_id. Capturing it at consent time is
  -- what makes a later Google-side erasure request possible at all; without it
  -- we could delete our own rows and nothing else.
  ga_client_id   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists consent_records_session_idx
  on public.consent_records (session_id);
create index if not exists consent_records_user_idx
  on public.consent_records (user_id)
  where user_id is not null;

create table if not exists public.consent_audit (
  id             uuid primary key default gen_random_uuid(),
  subject_key    text not null,
  session_id     text,
  -- Plain uuid, NO foreign key — two reasons, both load-bearing:
  --   1. `on delete set null` would UPDATE this row when a user is deleted,
  --      which the append-only trigger below rejects, making account deletion
  --      fail outright.
  --   2. An audit row records that consent happened. It should survive the
  --      subject's deletion, not be silently rewritten by it.
  -- consent_records keeps the real FK (on delete cascade), so the *current
  -- state* still disappears with the account.
  user_id        uuid,
  analytics      text not null check (analytics in ('granted','denied')),
  policy_version text not null,
  source         text not null check (source in ('banner','privacy_page','withdrawal','link')),
  user_agent     text,
  -- Coarse ISO country only. NEVER an IP address — see the header note.
  country        text,
  ts             timestamptz not null default now()
);

create index if not exists consent_audit_subject_time_idx
  on public.consent_audit (subject_key, ts desc);

alter table public.consent_records enable row level security;
alter table public.consent_audit   enable row level security;

-- Service-role only. There is intentionally no anon or authenticated policy:
-- every read and write goes through netlify/functions/consent.js, which
-- resolves user_id from the JWT rather than trusting the request body.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'consent_records' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.consent_records
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'consent_audit' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.consent_audit
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- consent_audit is append-only at the database level, not merely by convention.
-- A trigger is the only thing that makes "append-only" survive a future
-- handler bug or an operator with the service key doing a well-meant cleanup.
create or replace function public.consent_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'consent_audit is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists consent_audit_no_change on public.consent_audit;
create trigger consent_audit_no_change
  before update or delete on public.consent_audit
  for each row execute function public.consent_audit_immutable();
