-- 0083_account_brand_kits.sql — the account Brand Kit, stored server-side.
--
-- Until now the account Brand Kit (Account → Brand kit: company name, tagline,
-- footer, website, contact email, accent colour) lived only in one browser's
-- localStorage, so the server could not see it and it did not follow the user
-- to another device. Engagement's "Use my account brand kit" (owner request
-- 2026-09-24) needs it on the server.
--
--   - One row per account; `kit` holds ONLY the validated text fields
--     (brandKitValidation.js). The logo stays in the browser — a 200KB data URL
--     does not belong in a row that is read on every Engagement settings load.
--   - Writes are gated to plans with white_label_pdf (Business, Agency) by the
--     function, not here: plan limits live in pricingConfig.js, not the database.
--   - RLS on, nothing granted to anon/authenticated — the 0044 pattern. The
--     browser reaches it only through /api/account-brand-kit (service key).
--
-- Re-runnable: every statement is idempotent.

create table if not exists public.account_brand_kits (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  kit         jsonb not null default '{}'::jsonb check (jsonb_typeof(kit) = 'object'),
  updated_at  timestamptz not null default now()
);

alter table public.account_brand_kits enable row level security;
revoke all on public.account_brand_kits from anon;
revoke all on public.account_brand_kits from authenticated;
grant all on public.account_brand_kits to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'account_brand_kits'
       and policyname = 'service full access'
  ) then
    create policy "service full access" on public.account_brand_kits
      for all to service_role using (true) with check (true);
  end if;
end $$;
