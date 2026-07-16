#!/usr/bin/env bash
# setup-providers.sh — Bootstrap Stripe prices, Stripe webhook, and Supabase tables.
# Usage: bash scripts/setup-providers.sh
# Requires: curl, jq
# Reads credentials from .env in the project root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
ENV_FILE="$ROOT/.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*"; }
h()    { echo -e "\n${CYAN}══ $* ══${NC}"; }

# ── Load .env ──────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  err ".env not found at $ENV_FILE — copy .env.example and fill in values."
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# ── Helpers ────────────────────────────────────────────────────────────────────
require() {
  local var="$1"; local label="$2"
  if [[ -z "${!var:-}" || "${!var}" == *"..."* ]]; then
    err "$label ($var) is not set in .env — skipping this step."
    return 1
  fi
  return 0
}

update_env() {
  local key="$1"; local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
  ok "  $key=$val"
}

stripe_post() {
  local endpoint="$1"; shift
  curl -sS -X POST "https://api.stripe.com/v1/${endpoint}" \
    -u "${STRIPE_SECRET_KEY}:" \
    -H "Stripe-Version: 2024-06-20" \
    "$@"
}

stripe_get() {
  local endpoint="$1"
  curl -sS "https://api.stripe.com/v1/${endpoint}" \
    -u "${STRIPE_SECRET_KEY}:"
}

# ── Step 1: Stripe — DEFERRED to v2.0 (see docs/STRIPE-DEFERRAL.md) ────────────
# DatIQ v1.0 ships with Razorpay/INR only. USD/Stripe integration code is
# preserved in the codebase but disabled at the routing layer (paymentConfig
# getPaymentProvider() returns null for USD when no Stripe key is set, so
# /pricing falls through to the "Contact us" path for non-INR currencies).
# When USD/Stripe is reactivated, uncomment the block below.
h "Step 1: Stripe Products & Prices — DEFERRED to v2.0"

if [[ "${DATIQ_ENABLE_STRIPE:-0}" != "1" ]]; then
  warn "Stripe payment integration is deferred to v2.0 (see docs/STRIPE-DEFERRAL.md)."
  warn "DatIQ v1.0 ships with Razorpay/INR only. Set DATIQ_ENABLE_STRIPE=1 in .env to re-enable."
  warn "Skipping Stripe setup."
  # Comment in the block below + set DATIQ_ENABLE_STRIPE=1 to bootstrap Stripe products+prices.
  # if ! require STRIPE_SECRET_KEY "Stripe secret key"; then
  #   warn "Skipping Stripe setup."
  # else
else
  SITE_URL="${VITE_SITE_URL:-https://datiq.app}"
  # Prices in cents — match pricingConfig.js (current tiers as of R20)
  declare -A PLAN_PRICES=([select]=1900 [pro]=2900 [business]=7900 [agency]=29900)
  declare -A PLAN_NAMES=([select]="DatIQ Select" [pro]="DatIQ Pro" [business]="DatIQ Business" [agency]="DatIQ Agency")
  declare -A PLAN_TAGLINES=(
    [select]="For individuals & freelancers"
    [pro]="For power users & consultants"
    [business]="For teams — 1,000 extractions/month, API access"
    [agency]="Unlimited scale, your brand"
  )
  declare -A ENV_KEYS=([select]=VITE_STRIPE_PRICE_SELECT [pro]=VITE_STRIPE_PRICE_PRO [business]=VITE_STRIPE_PRICE_BUSINESS [agency]=VITE_STRIPE_PRICE_AGENCY)

  for plan in select pro business agency; do
    env_key="${ENV_KEYS[$plan]}"
    existing="${!env_key:-}"
    if [[ -n "$existing" && "$existing" != "price_..."* && "$existing" == price_* ]]; then
      ok "  $env_key already set ($existing) — skipping"
      continue
    fi

    echo "  Creating product: ${PLAN_NAMES[$plan]}..."
    PRODUCT=$(stripe_post products \
      -d "name=${PLAN_NAMES[$plan]}" \
      -d "description=${PLAN_TAGLINES[$plan]}" \
      -d "metadata[plan_id]=${plan}")
    PRODUCT_ID=$(echo "$PRODUCT" | jq -r '.id // empty')
    if [[ -z "$PRODUCT_ID" ]]; then
      err "  Failed to create product for $plan: $(echo "$PRODUCT" | jq -r '.error.message // "unknown error"')"
      continue
    fi

    echo "  Creating recurring price for $plan (\$${PLAN_PRICES[$plan]/00/}/mo)..."
    PRICE=$(stripe_post prices \
      -d "product=${PRODUCT_ID}" \
      -d "unit_amount=${PLAN_PRICES[$plan]}" \
      -d "currency=usd" \
      -d "recurring[interval]=month" \
      -d "nickname=DatIQ ${plan^} Monthly" \
      -d "metadata[plan_id]=${plan}")
    PRICE_ID=$(echo "$PRICE" | jq -r '.id // empty')
    if [[ -z "$PRICE_ID" ]]; then
      err "  Failed to create price for $plan: $(echo "$PRICE" | jq -r '.error.message // "unknown error"')"
      continue
    fi

    update_env "$env_key" "$PRICE_ID"
  done

  # ── Top-up bundle one-time prices ─────────────────────────────────────────
  echo ""
  declare -A BUNDLE_PRICES=([extractions_bundle]=900 [scheduler_addon]=500 [hubspot_addon]=1200)
  declare -A BUNDLE_NAMES=([extractions_bundle]="DatIQ Extractions Bundle" [scheduler_addon]="DatIQ Scheduler Add-on" [hubspot_addon]="DatIQ HubSpot/CRM Export")
  declare -A BUNDLE_ENV=([extractions_bundle]=VITE_STRIPE_PRICE_EXTRACTIONS_BUNDLE [scheduler_addon]=VITE_STRIPE_PRICE_SCHEDULER_ADDON [hubspot_addon]=VITE_STRIPE_PRICE_HUBSPOT_ADDON)

  for bundle in extractions_bundle scheduler_addon hubspot_addon; do
    env_key="${BUNDLE_ENV[$bundle]}"
    existing="${!env_key:-}"
    if [[ -n "$existing" && "$existing" == price_* && "$existing" != "price_..."* ]]; then
      ok "  $env_key already set ($existing) — skipping"
      continue
    fi

    echo "  Creating product+price: ${BUNDLE_NAMES[$bundle]}..."
    PRODUCT=$(stripe_post products \
      -d "name=${BUNDLE_NAMES[$bundle]}" \
      -d "metadata[bundle_id]=${bundle}")
    PRODUCT_ID=$(echo "$PRODUCT" | jq -r '.id // empty')
    if [[ -z "$PRODUCT_ID" ]]; then
      err "  Failed: $(echo "$PRODUCT" | jq -r '.error.message // "unknown error"')"
      continue
    fi

    PRICE=$(stripe_post prices \
      -d "product=${PRODUCT_ID}" \
      -d "unit_amount=${BUNDLE_PRICES[$bundle]}" \
      -d "currency=usd" \
      -d "metadata[bundle_id]=${bundle}")
    PRICE_ID=$(echo "$PRICE" | jq -r '.id // empty')
    if [[ -z "$PRICE_ID" ]]; then
      err "  Failed: $(echo "$PRICE" | jq -r '.error.message // "unknown error"')"
      continue
    fi

    update_env "$env_key" "$PRICE_ID"
  done

  # ── Step 2: Stripe — register webhook ──────────────────────────────────────
  h "Step 2: Stripe Webhook"
  WEBHOOK_URL="${SITE_URL}/.netlify/functions/payment-webhook"

  existing_whsec="${STRIPE_WEBHOOK_SECRET:-}"
  if [[ -n "$existing_whsec" && "$existing_whsec" == whsec_* && "$existing_whsec" != "whsec_..."* ]]; then
    ok "STRIPE_WEBHOOK_SECRET already set — skipping webhook creation."
  else
    echo "  Registering webhook: $WEBHOOK_URL"
    WEBHOOK=$(stripe_post webhook_endpoints \
      -d "url=${WEBHOOK_URL}" \
      -d "enabled_events[]=checkout.session.completed" \
      -d "enabled_events[]=customer.subscription.updated" \
      -d "enabled_events[]=customer.subscription.deleted" \
      -d "enabled_events[]=invoice.payment_failed" \
      -d "description=DatIQ payment webhook")
    WHSEC=$(echo "$WEBHOOK" | jq -r '.secret // empty')
    WHID=$(echo "$WEBHOOK" | jq -r '.id // empty')
    if [[ -z "$WHSEC" ]]; then
      err "  Webhook creation failed: $(echo "$WEBHOOK" | jq -r '.error.message // "unknown error"')"
    else
      ok "  Webhook created: $WHID"
      update_env "STRIPE_WEBHOOK_SECRET" "$WHSEC"
    fi
  fi
fi

# ── Step 3: Razorpay — verify credentials ──────────────────────────────────────
h "Step 3: Razorpay Credentials"

if ! require RAZORPAY_KEY_ID "Razorpay key ID" || ! require RAZORPAY_KEY_SECRET "Razorpay key secret"; then
  warn "Skipping Razorpay verification."
else
  echo "  Verifying Razorpay credentials..."
  RZP_TEST=$(curl -sS "https://api.razorpay.com/v1/orders?count=1" \
    -u "${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}" 2>&1)
  if echo "$RZP_TEST" | jq -e '.items // .error' >/dev/null 2>&1; then
    if echo "$RZP_TEST" | jq -e '.error' >/dev/null 2>&1; then
      err "  Razorpay auth failed: $(echo "$RZP_TEST" | jq -r '.error.description // .error')"
    else
      ok "  Razorpay credentials valid."
      # Sync RAZORPAY_KEY_ID → VITE_RAZORPAY_KEY_ID if not set
      if [[ -z "${VITE_RAZORPAY_KEY_ID:-}" || "${VITE_RAZORPAY_KEY_ID}" == "rzp_"*"..."* ]]; then
        update_env "VITE_RAZORPAY_KEY_ID" "$RAZORPAY_KEY_ID"
      fi
    fi
  else
    warn "  Could not verify Razorpay credentials (unexpected response)."
  fi

  echo ""
  warn "Razorpay webhook must be registered manually in the dashboard:"
  echo "  1. Go to: https://dashboard.razorpay.com/app/webhooks"
  echo "  2. Click '+ Add New Webhook'"
  echo "  3. Webhook URL: ${SITE_URL}/.netlify/functions/payment-webhook?provider=razorpay"
  echo "  4. Events: payment.captured, payment.failed, subscription.activated, subscription.cancelled"
  echo "  5. Set a Secret → paste it into RAZORPAY_WEBHOOK_SECRET in .env"
fi

# ── Step 4: Supabase SQL migrations ────────────────────────────────────────────
h "Step 4: Supabase SQL Migrations"

MIGRATIONS_SQL="$(cat <<'SQLEOF'
-- V5: Usage tracking
create table if not exists public.usage_records (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  month       text not null,
  extractions integer not null default 0,
  enrichments integer not null default 0,
  plan_id     text not null default 'free',
  updated_at  timestamptz not null default now(),
  unique(session_id, month)
);
alter table public.usage_records enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='usage_records' and policyname='anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_records for all using (true) with check (true)';
  end if;
end $$;

-- V5: Alert preferences
create table if not exists public.usage_alerts (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null unique,
  email            text not null,
  thresholds       integer[] not null default '{80,95}',
  enabled          boolean not null default true,
  last_notified_at timestamptz
);
alter table public.usage_alerts enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='usage_alerts' and policyname='anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_alerts for all using (true) with check (true)';
  end if;
end $$;

-- V5c: Payment subscriptions
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  session_id               text not null unique,
  plan_id                  text,
  status                   text,
  provider                 text,
  provider_subscription_id text,
  provider_customer_id     text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
alter table public.subscriptions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='subscriptions' and policyname='anon full access'
  ) then
    execute 'create policy "anon full access" on public.subscriptions for all using (true) with check (true)';
  end if;
end $$;

-- V5c: Payment event audit log
create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  session_id        text,
  event_type        text,
  provider          text,
  provider_event_id text,
  plan_id           text,
  amount_cents      integer,
  currency          text,
  status            text,
  created_at        timestamptz default now()
);
alter table public.payment_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='payment_events' and policyname='anon full access'
  ) then
    execute 'create policy "anon full access" on public.payment_events for all using (true) with check (true)';
  end if;
end $$;

-- V2 extractions columns (safe to run if not done yet)
alter table public.extractions add column if not exists custom_extraction jsonb;
alter table public.extractions add column if not exists domain_map        jsonb;
alter table public.extractions add column if not exists enrichments       jsonb;
SQLEOF
)"

# Write SQL to a file regardless — useful for dashboard copy-paste
SQL_FILE="$ROOT/scripts/migrations.sql"
echo "$MIGRATIONS_SQL" > "$SQL_FILE"
ok "Migration SQL written to: scripts/migrations.sql"

# Try to run via Supabase Management API if ACCESS_TOKEN provided
if require SUPABASE_ACCESS_TOKEN "Supabase Access Token" && require VITE_SUPABASE_URL "Supabase URL"; then
  # Extract project ref from URL: https://abcdefgh.supabase.co → abcdefgh
  PROJECT_REF=$(echo "$VITE_SUPABASE_URL" | sed 's|https://||' | cut -d'.' -f1)
  echo "  Running migrations on project: $PROJECT_REF"

  MIGRATION_RESULT=$(curl -sS -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$MIGRATIONS_SQL" | jq -Rs .)}")

  if echo "$MIGRATION_RESULT" | jq -e '.error // .message' >/dev/null 2>&1; then
    ERR_MSG=$(echo "$MIGRATION_RESULT" | jq -r '.error // .message // "unknown error"')
    err "  Migration failed: $ERR_MSG"
    warn "  Run scripts/migrations.sql manually in Supabase SQL Editor."
  else
    ok "  All 4 tables created (usage_records, usage_alerts, subscriptions, payment_events)."
  fi
else
  warn "SUPABASE_ACCESS_TOKEN not set — cannot run migrations automatically."
  echo "  Manual option:"
  echo "  1. Open: ${VITE_SUPABASE_URL:-https://app.supabase.com} → SQL Editor"
  echo "  2. Paste and run: scripts/migrations.sql"
  echo ""
  echo "  OR: Get your Access Token at https://app.supabase.com/account/tokens"
  echo "  Add SUPABASE_ACCESS_TOKEN= to .env and re-run this script."
fi

# ── Final summary ──────────────────────────────────────────────────────────────
h "Summary"
echo ""
echo -e "${CYAN}Stripe prices now in .env:${NC}"
for k in VITE_STRIPE_PRICE_SELECT VITE_STRIPE_PRICE_PRO VITE_STRIPE_PRICE_BUSINESS VITE_STRIPE_PRICE_AGENCY \
         VITE_STRIPE_PRICE_EXTRACTIONS_BUNDLE VITE_STRIPE_PRICE_SCHEDULER_ADDON VITE_STRIPE_PRICE_HUBSPOT_ADDON; do
  val="${!k:-}"
  if [[ -n "$val" && "$val" == price_* && "$val" != "price_..."* ]]; then
    echo "  $k=$val"
  fi
done

echo ""
echo -e "${CYAN}STRIPE_WEBHOOK_SECRET:${NC} ${STRIPE_WEBHOOK_SECRET:-(not set)}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Copy ALL updated .env vars to Netlify → Site configuration → Environment variables"
echo "     (especially STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RAZORPAY_KEY_SECRET)"
echo "  2. Register Razorpay webhook manually (see Step 3 output above)"
echo "  3. If Supabase migrations weren't auto-run: paste scripts/migrations.sql in SQL Editor"
echo "  4. Trigger a Netlify redeploy so VITE_* vars are baked into the build"
echo ""
ok "Setup complete."
