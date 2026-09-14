-- 0058_local_directory.sql — W12. Local and directory intelligence.
--
-- W9 recorded what is TRUE about a business. W12 measures whether the records
-- the business does not own agree with it: a Google Business Profile, a
-- Justdial listing, an MCA filing. When they disagree about the name, the
-- address or the phone, an engine asked "where is Acme" has several answers and
-- picks one. It does not error.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.
--
-- ── THIS IS THE FIRST TABLE SET BUILT ON D7 ───────────────────────────────
-- `audit_local_checks.subject_id` points at `audit_subjects` (0057). A local
-- check is about a BUSINESS or a LOCATION, not about a page, which is exactly
-- the case the page-shaped `audits.target_id` could never carry. Nullable, for
-- the same reason `audits.subject_id` is: a check whose subject could not be
-- resolved is degraded, not lost.
--
-- ── WHY SOURCE IDS ARE NOT ENUMERATED IN A CHECK CONSTRAINT ───────────────
-- 🔴 THIS DEPARTS FROM W10, DELIBERATELY. 0056 puts its fourteen entity types
-- in a CHECK because that vocabulary is a closed, slow-moving contract derived
-- from schema.org. The directory registry is neither: a new market is a dozen
-- new sources, and a CHECK would make each one a migration plus a deploy plus a
-- window where the API and the database disagree about what is legal — the very
-- cost 0049's header cites for widening a live enum. What IS closed is the
-- TIER, so the tier is constrained here and `directorySources.js` stays the one
-- place a source is declared. `napModel.matchDirectory` refuses an unknown
-- source id before anything reaches this table.

-- ── One observed listing ───────────────────────────────────────────────────
create table if not exists public.audit_directory_listings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,

  source_id        text not null check (length(btrim(source_id)) > 0),
  source_tier      text not null check (source_tier in
                     ('authoritative','major_aggregator','registry','vertical','social_review')),
  -- D5's three acquisition tiers. Stored per listing, because the SAME source
  -- can be read two ways and the fidelity differs: a Google profile read
  -- through the customer's own OAuth is not the same evidence as one scraped
  -- from a public page, and a reader must be able to tell them apart.
  acquisition      text not null check (acquisition in ('authorized_api','declared_url','public_listing')),

  listing_url      text,

  -- What the directory actually said. NULL means the listing did not state it,
  -- which is a different fact from "we did not look" (no row at all) and from
  -- "this source never publishes it" (the registry knows that, not the row).
  observed_name        text,
  observed_address     text,
  observed_phone       text,
  observed_postal_code text,
  observed_locality    text,
  observed_extra       jsonb not null default '{}'::jsonb,

  -- The same envelope W1 built and W9/W10 reuse. A listing nobody can drill
  -- into is indistinguishable from one somebody made up.
  evidence_json    jsonb,

  observed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- An observed listing claims somebody could go and check it, so it carries
  -- the URL that was read — except for an authorised API, where the evidence is
  -- the connection itself and there is no page.
  constraint audit_dir_listing_public_has_url check (
    acquisition = 'authorized_api' or listing_url is not null
  )
);

-- One current listing per owner per source per record. A weekly re-read
-- UPDATES what the source says; it does not stack a second opinion, or every
-- count doubles and "what does Justdial say" answers differently depending on
-- how many checks have run. That is the same defect 0056's unique edge index
-- exists to prevent.
create unique index if not exists audit_dir_listing_unique
  on public.audit_directory_listings (user_id, coalesce(truth_record_id, '00000000-0000-0000-0000-000000000000'::uuid), source_id);
create index if not exists audit_dir_listing_owner_idx
  on public.audit_directory_listings (user_id, source_tier, observed_at desc);

-- ── One NAP check run ──────────────────────────────────────────────────────
create table if not exists public.audit_local_checks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  -- D7. What this check is ABOUT.
  subject_id       uuid references public.audit_subjects(id) on delete set null,

  -- 🔴 NULLABLE, AND NULL IS NOT ZERO. A run where nothing could be read scores
  -- null and reports its coverage, because scoring it 0 would say the business
  -- is inconsistent when the truth is that we checked nothing — and would then
  -- show a phantom jump the day the customer authorises one connection.
  nap_score        numeric check (nap_score is null or (nap_score >= 0 and nap_score <= 100)),
  coverage         numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),

  checked_count    integer not null default 0 check (checked_count >= 0),
  configured_count integer not null default 0 check (configured_count >= 0),
  region           text,

  -- Set membership, so a later reader can tell "not authorised" from
  -- "authorised and unreadable" without re-deriving it from the registry.
  unchecked_sources  text[] not null default '{}',
  unreadable_sources text[] not null default '{}',

  created_at       timestamptz not null default now(),

  constraint audit_local_check_counts check (checked_count <= configured_count)
);

create index if not exists audit_local_checks_owner_idx
  on public.audit_local_checks (user_id, created_at desc);
create index if not exists audit_local_checks_subject_idx
  on public.audit_local_checks (subject_id, created_at desc) where subject_id is not null;

-- ── Per-directory match ────────────────────────────────────────────────────
create table if not exists public.audit_directory_matches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  check_id         uuid not null references public.audit_local_checks(id) on delete cascade,
  listing_id       uuid references public.audit_directory_listings(id) on delete set null,

  source_id        text not null,
  source_tier      text not null check (source_tier in
                     ('authoritative','major_aggregator','registry','vertical','social_review')),
  tier_weight      numeric not null check (tier_weight > 0 and tier_weight <= 1),

  match_score      numeric check (match_score is null or (match_score >= 0 and match_score <= 100)),
  coverage         numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),

  -- Per-field states, as the model produced them. Stored whole rather than as
  -- four columns, because the field set is the model's to grow — and because a
  -- reader asking "why is this 55" needs the states, not a re-derivation.
  fields_json      jsonb not null default '[]'::jsonb,
  mismatched       text[] not null default '{}',
  absent_fields    text[] not null default '{}',

  created_at       timestamptz not null default now()
);

create unique index if not exists audit_dir_match_unique
  on public.audit_directory_matches (check_id, source_id);
create index if not exists audit_dir_match_owner_idx
  on public.audit_directory_matches (user_id, created_at desc);

-- ── Findings ───────────────────────────────────────────────────────────────
-- Its own table, and its own lifecycle, for the reason D7 §4 records: these are
-- about a RECORD, not about an audit, and their resolution vocabulary is not
-- the recommendation queue's eight workflow states. Collapsing them would lose
-- the difference between "this listing now agrees" and "somebody did the task".
create table if not exists public.audit_local_findings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  check_id         uuid references public.audit_local_checks(id) on delete cascade,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  source_id        text,

  code             text not null check (code ~ '^LD-[0-9]{2}$'),
  severity         text not null check (severity in ('critical','high','medium','low')),
  fields           text[] not null default '{}',
  detail           text,

  resolution       text check (resolution in ('listing_updated','record_updated','not_a_conflict','wont_fix')),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A resolution with no timestamp, or a timestamp with no resolution, is half
  -- a record: the list would show it as open while a reader believed it closed.
  constraint audit_local_finding_resolution_paired check (
    (resolution is null and resolved_at is null)
    or (resolution is not null and resolved_at is not null)
  )
);

create index if not exists audit_local_findings_open_idx
  on public.audit_local_findings (user_id, created_at desc) where resolved_at is null;
create index if not exists audit_local_findings_code_idx
  on public.audit_local_findings (user_id, code);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_directory_listings enable row level security;
alter table public.audit_local_checks       enable row level security;
alter table public.audit_directory_matches  enable row level security;
alter table public.audit_local_findings     enable row level security;

drop policy if exists audit_dir_listings_service on public.audit_directory_listings;
create policy audit_dir_listings_service on public.audit_directory_listings
  for all to service_role using (true) with check (true);

drop policy if exists audit_local_checks_service on public.audit_local_checks;
create policy audit_local_checks_service on public.audit_local_checks
  for all to service_role using (true) with check (true);

drop policy if exists audit_dir_matches_service on public.audit_directory_matches;
create policy audit_dir_matches_service on public.audit_directory_matches
  for all to service_role using (true) with check (true);

drop policy if exists audit_local_findings_service on public.audit_local_findings;
create policy audit_local_findings_service on public.audit_local_findings
  for all to service_role using (true) with check (true);

revoke all on public.audit_directory_listings from anon, authenticated;
revoke all on public.audit_local_checks       from anon, authenticated;
revoke all on public.audit_directory_matches  from anon, authenticated;
revoke all on public.audit_local_findings     from anon, authenticated;

drop trigger if exists audit_dir_listings_touch on public.audit_directory_listings;
create trigger audit_dir_listings_touch
  before update on public.audit_directory_listings
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_local_findings_touch on public.audit_local_findings;
create trigger audit_local_findings_touch
  before update on public.audit_local_findings
  for each row execute function public.audit_touch_updated_at();
