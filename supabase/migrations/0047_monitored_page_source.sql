-- 0047_monitored_page_source.sql
--
-- Records HOW a monitored page came to be monitored.
--
-- PRD 4 asks for two things that pull in opposite directions: *"Domain mapping
-- to recommend relevant pages"* and *"User chooses monitored categories/pages"*.
-- Automatic discovery satisfies the first and, left unlabelled, quietly
-- undermines the second — a user would open their watchlist and find pages they
-- never added, with no way to tell which were theirs.
--
-- `source` keeps the distinction visible:
--   'user' — explicitly added. The default, so nothing pre-existing is
--            retroactively relabelled as something the product guessed at.
--   'auto' — discovered by crawling the target's homepage. The UI can surface
--            these as "we added these, remove any you don't want", and a user
--            removing one is removing a suggestion rather than undoing their
--            own earlier decision.
--
-- Every auto-discovered page is a recurring crawl charged to the customer, so
-- being able to see and prune them is not cosmetic.

alter table public.monitored_pages
  add column if not exists source text not null default 'user'
  check (source in ('user', 'auto'));

-- Lets the crawler find "targets that have never been discovered for" without
-- scanning every page of every watchlist.
create index if not exists monitored_pages_source_idx
  on public.monitored_pages (target_id, source);

-- Keep the 0044 posture.
do $$ begin
  execute 'alter table public.monitored_pages enable row level security';
  execute 'revoke all on public.monitored_pages from anon';
  execute 'revoke all on public.monitored_pages from authenticated';
  execute 'grant all on public.monitored_pages to service_role';
end $$;
