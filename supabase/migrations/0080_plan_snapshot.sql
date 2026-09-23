-- 0080_plan_snapshot.sql — what a subscriber bought, held until their period ends.
--
-- WHY
-- `src/lib/pricingConfig.js` is a LIVE price list: change a number and every
-- account sees it on the next page load. That is correct for a list and wrong
-- for a subscription. The 2026-09-23 repricing cut Developer's batch and bulk
-- limits from 500 to 250; with no snapshot, a Developer subscriber three weeks
-- into a month they had already paid for would have found their list size
-- halved, with no notice. There were no paid accounts that day — which is
-- precisely why it was the right day to add this rather than the wrong one.
--
-- THE RULE, enforced in src/lib/planSnapshot.js (pure, shared client+server):
-- while the paid period is still running nothing gets worse, and improvements
-- still reach you. The PRICE is the one charged; each LIMIT is the better of
-- what was bought and what the plan now offers. On renewal the snapshot is
-- rewritten from the live table, and that is where a repricing takes effect.
--
-- ADDITIVE AND NULLABLE ON PURPOSE. Every existing row keeps a null snapshot
-- and therefore tracks the live table exactly as it does today, so this
-- migration changes no behaviour on the day it is applied. Behaviour starts
-- when `activateFromInvoice` begins writing snapshots on the next purchase.
--
-- ⚠️ NOT A REPLACEMENT FOR `invoice_drafts.price_snapshot` (0016). That one is
-- the price at the moment of CHARGE and is what the invoice is built from — it
-- is accounting, and it is immutable. This one is the plan currently in force
-- and is rewritten on every renewal. Two different questions; keep both.

alter table public.entitlements
  add column if not exists plan_snapshot jsonb,
  add column if not exists snapshot_at   timestamptz;

comment on column public.entitlements.plan_snapshot is
  'Plan as purchased: {id, name, price_usd, price_usd_annual, price_inr, price_inr_annual, limits}. '
  'Read by src/lib/planSnapshot.js while period_end is in the future. Null = track the live table.';
comment on column public.entitlements.snapshot_at is
  'When plan_snapshot was written. Diagnostic only — the protection window is period_end, not this.';

-- A partial index over the rows a grandfathering sweep would ever look at.
-- Rows with no snapshot are the overwhelming majority today and are excluded.
create index if not exists entitlements_snapshot_idx
  on public.entitlements (period_end)
  where plan_snapshot is not null;

-- ⚠️ NO RLS CHANGE. `entitlements` already has select-own for authenticated and
-- no insert/update/delete policy for anyone, so the snapshot is readable by its
-- owner and writable only through the service key. A user able to write their
-- own plan_snapshot could grant themselves any limit they liked — which is the
-- same reason the table has had no write policy since 0012.
