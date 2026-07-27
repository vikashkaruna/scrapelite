-- scripts/invoices.sql — PR2 (invoice drafts, invoices, gapless FY numbering).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Design notes that are easy to get wrong and expensive to fix later:
--
--  * MONEY IS INTEGER MINOR UNITS everywhere (paise / cents), never float.
--    Matches payment_events.amount_cents and Razorpay's own representation.
--
--  * AMOUNTS ARE SNAPSHOTTED, not recomputed. pricing_config is editable at
--    runtime and cached for only 60s, so re-deriving an old invoice from the
--    current price table would produce a different document. An issued invoice
--    must reproduce byte-for-byte forever.
--
--  * NUMBERING USES A COUNTER TABLE, NOT A SEQUENCE. Postgres sequences are
--    explicitly non-transactional: a rolled-back transaction still consumes the
--    number, leaving a gap. Gaps in a GST invoice series are exactly what an
--    auditor asks about. The row-locked UPDATE below rolls back with its
--    transaction, so the series is gapless by construction.

-- ── Invoice drafts ────────────────────────────────────────────────────────────
-- Written BEFORE the payment order is created, keyed by the provider order id.
-- This is the snapshot that lets verify-payment and the webhook both issue the
-- same invoice without trusting anything the browser sends back.
--
-- Rejected alternative: stuffing the decomposition into Razorpay `notes`. It is
-- capped at 15 keys / 256 chars per value, and — decisively — notes are partly
-- client-supplied (paymentService.js sets them in the browser), which would put
-- the client in charge of the numbers on a legal document.
create table if not exists public.invoice_drafts (
  order_id               text primary key,          -- razorpay order id / stripe session id
  provider               text not null,
  user_id                uuid references auth.users,
  session_id             text,
  email                  text,
  kind                   text not null,             -- 'plan' | 'bundle'
  plan_id                text not null,
  billing_period         text,
  qty                    integer not null default 1,
  currency               text not null,
  gross_minor            bigint not null,
  discount_minor         bigint not null default 0,
  proration_credit_minor bigint not null default 0,
  taxable_minor          bigint not null,
  tax_rate               numeric(6,4) not null default 0,
  tax_treatment          text,                      -- 'intra' | 'inter' | 'none'
  cgst_minor             bigint not null default 0,
  sgst_minor             bigint not null default 0,
  igst_minor             bigint not null default 0,
  tax_minor              bigint not null default 0,
  total_minor            bigint not null,
  coupon_code            text,
  discount_pct           numeric(6,2) not null default 0,
  period_start           timestamptz,
  period_end             timestamptz,
  place_of_supply        text,
  price_snapshot         jsonb not null,            -- the price row actually used
  buyer_snapshot         jsonb,
  supplier_snapshot      jsonb not null,
  lines                  jsonb not null default '[]'::jsonb,
  status                 text not null default 'pending',  -- pending|issued|abandoned
  invoice_id             uuid,
  created_at             timestamptz not null default now()
);
create index if not exists invoice_drafts_status_idx  on public.invoice_drafts (status, created_at);
create index if not exists invoice_drafts_session_idx on public.invoice_drafts (session_id);

alter table public.invoice_drafts enable row level security;
-- RLS on, NO policy: service key only. Drafts hold the price snapshot and are
-- never read by the browser.

-- ── Invoice counters + financial-year helper ──────────────────────────────────
create table if not exists public.invoice_counters (
  series   text   not null,
  fy       text   not null,
  last_seq bigint not null default 0,
  primary key (series, fy)
);
alter table public.invoice_counters enable row level security;   -- service key only

-- Indian financial year: 1 April – 31 March, in IST.
-- The timezone matters. 2027-03-31T23:00Z is 2027-04-01 04:30 IST, i.e. already
-- FY 27-28. Computing this in UTC books an out-of-order number in the wrong year.
create or replace function public.fy_of(ts timestamptz, tz text default 'Asia/Kolkata')
returns text language sql immutable as $$
  select case
    when extract(month from (ts at time zone tz)) >= 4
      then to_char((ts at time zone tz), 'YY') || '-' ||
           to_char(((ts at time zone tz) + interval '1 year'), 'YY')
    else to_char(((ts at time zone tz) - interval '1 year'), 'YY') || '-' ||
         to_char((ts at time zone tz), 'YY')
  end;
$$;

-- Allocate the next number in a (series, fy). Gapless and duplicate-free.
--
-- The UPDATE ... RETURNING takes a ROW LOCK held until COMMIT, so concurrent
-- issuers serialise on that single row and the second one reads the already
-- incremented value. Because the increment is part of the caller's transaction,
-- a rollback un-does it — which is precisely why this is a table and not a
-- sequence.
--
-- Never hold this lock across I/O: allocate, commit, and only then render the
-- PDF and send the email.
create or replace function public.next_invoice_no(p_series text, p_fy text)
returns text language plpgsql as $$
declare n bigint;
begin
  insert into public.invoice_counters (series, fy, last_seq)
  values (p_series, p_fy, 0)
  on conflict (series, fy) do nothing;

  update public.invoice_counters
     set last_seq = last_seq + 1
   where series = p_series and fy = p_fy
  returning last_seq into n;

  return p_series || '/' || p_fy || '/' || lpad(n::text, 6, '0');
end $$;

revoke execute on function public.next_invoice_no(text, text) from anon, authenticated;

-- ── Invoices ──────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id                     uuid primary key default gen_random_uuid(),
  invoice_no             text not null unique,
  series                 text not null default 'DTQ',   -- DTQ invoices, DTQC credit notes
  fy                     text not null,
  seq                    bigint,
  doc_type               text not null,                 -- 'tax_invoice' | 'payment_receipt' | 'credit_note'
  user_id                uuid references auth.users,
  session_id             text,
  email                  text,

  plan_id                text,
  billing_period         text,
  qty                    integer not null default 1,
  period_start           timestamptz,
  period_end             timestamptz,

  currency               text not null,
  gross_minor            bigint not null,
  discount_minor         bigint not null default 0,
  proration_credit_minor bigint not null default 0,
  taxable_minor          bigint not null,
  tax_rate               numeric(6,4) not null default 0,
  tax_treatment          text,
  cgst_minor             bigint not null default 0,
  sgst_minor             bigint not null default 0,
  igst_minor             bigint not null default 0,
  tax_minor              bigint not null default 0,
  total_minor            bigint not null,
  coupon_code            text,
  place_of_supply        text,

  supplier_snapshot      jsonb not null,   -- legal name, address, GSTIN at issue time
  buyer_snapshot         jsonb,            -- name, address, GSTIN at issue time

  provider               text,
  provider_payment_id    text,
  provider_order_id      text,

  status                 text not null default 'paid',  -- paid|refunded|partially_refunded|void
  refunded_minor         bigint not null default 0,
  credit_note_of         uuid references public.invoices (id),

  pdf_path               text,
  pdf_sha256             text,
  reconstructed          boolean not null default false, -- issued without a draft

  issued_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Idempotency: one invoice per captured payment. This is a CONSTRAINT rather
-- than a read-then-write check because verify-payment (synchronous) and the
-- payment webhook (asynchronous) genuinely race — the existing
-- read-then-write dedup in payment-webhook.js is not safe under concurrency.
create unique index if not exists invoices_provider_payment_uidx
  on public.invoices (provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists invoices_user_idx    on public.invoices (user_id, issued_at desc);
create index if not exists invoices_session_idx on public.invoices (session_id, issued_at desc);
create index if not exists invoices_order_idx   on public.invoices (provider_order_id);

alter table public.invoices enable row level security;
drop policy if exists "invoices select own" on public.invoices;
create policy "invoices select own" on public.invoices
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.invoices from authenticated, anon;
grant  select on public.invoices to authenticated;

-- ── Invoice lines ─────────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  line_no      integer not null,
  kind         text not null,          -- plan|bundle|discount|proration_credit
  description  text not null,
  hsn_sac      text,                   -- SAC 998314 for SaaS
  qty          integer not null default 1,
  unit_minor   bigint not null default 0,
  amount_minor bigint not null,        -- negative for discount / credit lines
  unique (invoice_id, line_no)
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

alter table public.invoice_lines enable row level security;
drop policy if exists "invoice_lines select own" on public.invoice_lines;
create policy "invoice_lines select own" on public.invoice_lines
  for select to authenticated using (
    exists (select 1 from public.invoices i
             where i.id = invoice_lines.invoice_id and i.user_id = auth.uid())
  );
revoke insert, update, delete on public.invoice_lines from authenticated, anon;
grant  select on public.invoice_lines to authenticated;

-- ── Immutability ──────────────────────────────────────────────────────────────
-- An issued invoice is a legal document. Only its lifecycle fields may change:
-- status, refunded_minor, the rendered PDF pointer, and user_id when an
-- unclaimed guest invoice is later adopted (NULL → set, never re-pointed).
create or replace function public.invoices_immutable()
returns trigger language plpgsql as $$
begin
  if OLD.user_id is not null and NEW.user_id is distinct from OLD.user_id then
    raise exception 'invoices.user_id is immutable once set (invoice %)', OLD.invoice_no;
  end if;

  if (NEW.invoice_no, NEW.series, NEW.fy, NEW.seq, NEW.doc_type, NEW.currency,
      NEW.gross_minor, NEW.discount_minor, NEW.proration_credit_minor,
      NEW.taxable_minor, NEW.tax_rate, NEW.tax_treatment,
      NEW.cgst_minor, NEW.sgst_minor, NEW.igst_minor, NEW.tax_minor, NEW.total_minor,
      NEW.plan_id, NEW.billing_period, NEW.qty, NEW.place_of_supply,
      NEW.supplier_snapshot, NEW.buyer_snapshot,
      NEW.provider, NEW.provider_payment_id, NEW.provider_order_id,
      NEW.period_start, NEW.period_end, NEW.issued_at, NEW.credit_note_of)
     is distinct from
     (OLD.invoice_no, OLD.series, OLD.fy, OLD.seq, OLD.doc_type, OLD.currency,
      OLD.gross_minor, OLD.discount_minor, OLD.proration_credit_minor,
      OLD.taxable_minor, OLD.tax_rate, OLD.tax_treatment,
      OLD.cgst_minor, OLD.sgst_minor, OLD.igst_minor, OLD.tax_minor, OLD.total_minor,
      OLD.plan_id, OLD.billing_period, OLD.qty, OLD.place_of_supply,
      OLD.supplier_snapshot, OLD.buyer_snapshot,
      OLD.provider, OLD.provider_payment_id, OLD.provider_order_id,
      OLD.period_start, OLD.period_end, OLD.issued_at, OLD.credit_note_of)
  then
    raise exception
      'issued invoice % is immutable; only status, refunded_minor, pdf_path, pdf_sha256 may change',
      OLD.invoice_no;
  end if;

  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists invoices_immutable_trg on public.invoices;
create trigger invoices_immutable_trg
  before update on public.invoices
  for each row execute function public.invoices_immutable();

-- ── Email dedup ───────────────────────────────────────────────────────────────
-- Second line of defence behind issue_invoice's `created` flag, so a retry or a
-- concurrent webhook can never send the customer two copies of one invoice.
create table if not exists public.invoice_emails (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind       text not null,                        -- 'issued' | 'resend' | 'reminder'
  sent_at    timestamptz not null default now(),
  primary key (invoice_id, kind)
);
alter table public.invoice_emails enable row level security;   -- service key only

-- ── issue_invoice — idempotent, gapless, race-safe ────────────────────────────
-- Order of operations matters:
--   1. Look for an existing invoice for this payment FIRST, so a retry consumes
--      no number at all.
--   2. Allocate the number INSIDE this transaction.
--   3. Catch unique_violation: a concurrent caller won the race, so return
--      their row. Our transaction rolls back — including the counter increment
--      — leaving no duplicate and no gap.
-- Returns { created: bool, invoice: {...} }. The caller MUST branch on `created`:
-- only a genuinely new invoice may render a PDF and email the customer.
-- Returning the row alone would make "issued" and "already existed"
-- indistinguishable, and the webhook would email a duplicate every retry.
create or replace function public.issue_invoice(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v      public.invoices;
  v_fy   text;
  v_no   text;
  v_ser  text := coalesce(p->>'series', 'DTQ');
  v_line jsonb;
  v_i    integer := 0;
begin
  if p->>'provider_payment_id' is not null then
    select * into v from public.invoices
     where provider = p->>'provider'
       and provider_payment_id = p->>'provider_payment_id';
    if found then
      return jsonb_build_object('created', false, 'invoice', to_jsonb(v));
    end if;
  end if;

  v_fy := public.fy_of(now());
  v_no := public.next_invoice_no(v_ser, v_fy);

  begin
    insert into public.invoices (
      invoice_no, series, fy,
      seq, doc_type, user_id, session_id, email,
      plan_id, billing_period, qty, period_start, period_end,
      currency, gross_minor, discount_minor, proration_credit_minor,
      taxable_minor, tax_rate, tax_treatment,
      cgst_minor, sgst_minor, igst_minor, tax_minor, total_minor,
      coupon_code, place_of_supply, supplier_snapshot, buyer_snapshot,
      provider, provider_payment_id, provider_order_id,
      status, credit_note_of, reconstructed
    ) values (
      v_no, v_ser, v_fy,
      (select last_seq from public.invoice_counters where series = v_ser and fy = v_fy),
      coalesce(p->>'doc_type', 'payment_receipt'),
      nullif(p->>'user_id','')::uuid, p->>'session_id', p->>'email',
      p->>'plan_id', p->>'billing_period',
      coalesce((p->>'qty')::int, 1),
      nullif(p->>'period_start','')::timestamptz, nullif(p->>'period_end','')::timestamptz,
      p->>'currency',
      coalesce((p->>'gross_minor')::bigint, 0),
      coalesce((p->>'discount_minor')::bigint, 0),
      coalesce((p->>'proration_credit_minor')::bigint, 0),
      coalesce((p->>'taxable_minor')::bigint, 0),
      coalesce((p->>'tax_rate')::numeric, 0),
      p->>'tax_treatment',
      coalesce((p->>'cgst_minor')::bigint, 0),
      coalesce((p->>'sgst_minor')::bigint, 0),
      coalesce((p->>'igst_minor')::bigint, 0),
      coalesce((p->>'tax_minor')::bigint, 0),
      coalesce((p->>'total_minor')::bigint, 0),
      p->>'coupon_code', p->>'place_of_supply',
      coalesce(p->'supplier_snapshot', '{}'::jsonb),
      p->'buyer_snapshot',
      p->>'provider', p->>'provider_payment_id', p->>'provider_order_id',
      coalesce(p->>'status', 'paid'),
      nullif(p->>'credit_note_of','')::uuid,
      coalesce((p->>'reconstructed')::boolean, false)
    ) returning * into v;
  exception when unique_violation then
    -- A concurrent caller won the race. Return THEIR row; our transaction rolls
    -- back, including the counter increment, so there is no duplicate and no gap.
    select * into v from public.invoices
     where provider = p->>'provider'
       and provider_payment_id = p->>'provider_payment_id';
    if found then
      return jsonb_build_object('created', false, 'invoice', to_jsonb(v));
    end if;
    raise;
  end;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.invoice_lines
      (invoice_id, line_no, kind, description, hsn_sac, qty, unit_minor, amount_minor)
    values (
      v.id, v_i,
      coalesce(v_line->>'kind','plan'),
      coalesce(v_line->>'description',''),
      v_line->>'hsn_sac',
      coalesce((v_line->>'qty')::int, 1),
      coalesce((v_line->>'unit_minor')::bigint, 0),
      coalesce((v_line->>'amount_minor')::bigint, 0)
    );
  end loop;

  return jsonb_build_object('created', true, 'invoice', to_jsonb(v));
end $$;

revoke execute on function public.issue_invoice(jsonb) from anon, authenticated;

notify pgrst, 'reload schema';
